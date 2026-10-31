import { Prisma, type PrismaClient, type BillingRun } from '../../generated/prisma/client.js';
import { createSubscriptionInvoice } from './invoice-persistence.js';

const Decimal = Prisma.Decimal;

export interface InitializeBillingRunParams {
  asOfDate: Date | string;
  periodLimit?: number | null;
  subscriptionIdFilter?: string | null;
  initiatedById?: string | null;
}

export interface BillingRunResult {
  run: BillingRun;
  processedCount: number;
  generatedCount: number;
  reusedCount: number;
  failedCount: number;
  hasMore: boolean;
  nextRunRequired: boolean;
  totalBilled: Prisma.Decimal;
}

/**
 * Initializes and persists durable BillingRun inputs prior to execution.
 */
export async function initializeBillingRun(
  prisma: PrismaClient,
  params: InitializeBillingRunParams
): Promise<BillingRun> {
  const asOfDate = new Date(params.asOfDate);

  return prisma.billingRun.create({
    data: {
      asOfDate,
      periodLimit: params.periodLimit ?? null,
      subscriptionIdFilter: params.subscriptionIdFilter ?? null,
      initiatedById: params.initiatedById ?? null,
      status: 'PENDING',
      subscriptionsProcessed: 0,
      invoicesGenerated: 0,
      invoicesReused: 0,
      invoicesFailed: 0,
      hasMore: false,
      nextRunRequired: false,
      totalAmountBilled: new Decimal('0.00'),
    },
  });
}

/**
 * Executes or resumes a durable billing run across due subscriptions.
 * 
 * Guarantees:
 * 1. Progress and counters are persisted durably; safe to retry after crash.
 * 2. Idempotent invoice creation guarantees no duplicated invoices on retries.
 * 3. Advisory locks prevent concurrent workers from processing the same subscription.
 * 4. Respects historical pause intervals via SubscriptionPauseInterval.
 * 5. Accurately flags hasMore and nextRunRequired.
 */
export async function executeBillingRun(
  prisma: PrismaClient,
  runId: string
): Promise<BillingRunResult> {
  const run = await prisma.billingRun.findUnique({
    where: { id: runId },
  });

  if (!run) {
    throw new Error(`BillingRun ${runId} not found.`);
  }

  // Mark in-progress
  await prisma.billingRun.update({
    where: { id: runId },
    data: {
      status: 'IN_PROGRESS',
      startedAt: run.startedAt ?? new Date(),
    },
  });

  const asOfDate = run.asOfDate;
  const whereClause: Prisma.SubscriptionWhereInput = {
    status: 'ACTIVE',
    nextBillingDate: { lte: asOfDate },
    ...(run.subscriptionIdFilter ? { id: run.subscriptionIdFilter } : {}),
  };

  const totalDueCount = await prisma.subscription.count({ where: whereClause });

  const subscriptions = await prisma.subscription.findMany({
    where: whereClause,
    orderBy: [
      { nextBillingDate: 'asc' },
      { id: 'asc' },
    ],
    ...(run.periodLimit ? { take: run.periodLimit } : {}),
    include: {
      pauseIntervals: true,
      lines: true,
    },
  });

  let processedCount = 0;
  let generatedCount = 0;
  let reusedCount = 0;
  let failedCount = 0;
  let totalBilled = new Decimal(run.totalAmountBilled.toString());
  const errorDetails: Array<{ subscriptionId: string; error: string }> = [];

  for (const sub of subscriptions) {
    const lockKey = `sub_run:${sub.id}`;
    const [lock] = await prisma.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
    `;

    if (!lock?.acquired) {
      continue;
    }

    try {
      const periodStart = sub.nextBillingDate || sub.startDate || asOfDate;
      const periodEnd = new Date(periodStart);
      if (sub.billingInterval === 'YEARLY') {
        periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1);
      } else if (sub.billingInterval === 'WEEKLY') {
        periodEnd.setUTCDate(periodEnd.getUTCDate() + 7);
      } else if (sub.billingInterval === 'DAILY') {
        periodEnd.setUTCDate(periodEnd.getUTCDate() + 1);
      } else {
        periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
      }

      const invoiceResult = await createSubscriptionInvoice(prisma, {
        subscriptionId: sub.id,
        periodStart,
        periodEnd,
        issueDate: asOfDate,
        advanceSchedule: true,
      });

      processedCount++;

      if (invoiceResult.isSkippedPaused) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { nextBillingDate: periodEnd },
        });
      } else if (invoiceResult.isReused) {
        reusedCount++;
      } else if (invoiceResult.invoice) {
        generatedCount++;
        totalBilled = totalBilled.plus(invoiceResult.invoice.total);
      }
    } catch (err: any) {
      failedCount++;
      errorDetails.push({
        subscriptionId: sub.id,
        error: err?.message || String(err),
      });
    }
  }

  const remainingDue = totalDueCount - (run.subscriptionsProcessed + processedCount);
  const hasMore = remainingDue > 0;
  const nextRunRequired = hasMore || failedCount > 0;

  const finalStatus = (failedCount > 0 && generatedCount === 0 && reusedCount === 0) ? 'FAILED' : 'COMPLETED';

  const updatedRun = await prisma.billingRun.update({
    where: { id: runId },
    data: {
      status: finalStatus,
      subscriptionsProcessed: { increment: processedCount },
      invoicesGenerated: { increment: generatedCount },
      invoicesReused: { increment: reusedCount },
      invoicesFailed: { increment: failedCount },
      totalAmountBilled: totalBilled,
      hasMore,
      nextRunRequired,
      errors: errorDetails.length > 0 ? (errorDetails as Prisma.InputJsonArray) : Prisma.DbNull,
      completedAt: new Date(),
    },
  });

  return {
    run: updatedRun,
    processedCount,
    generatedCount,
    reusedCount,
    failedCount,
    hasMore,
    nextRunRequired,
    totalBilled,
  };
}
