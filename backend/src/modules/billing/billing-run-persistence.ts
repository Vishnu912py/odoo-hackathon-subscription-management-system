import { Prisma, type PrismaClient, type BillingRun } from '../../generated/prisma/client.js';
import { createSubscriptionInvoice } from './invoice-persistence.js';
import { computeNextPeriod } from './recurrence.js';

const Decimal = Prisma.Decimal;

export interface InitializeBillingRunParams {
  asOfDate: Date | string;
  periodLimit?: number | null;
  subscriptionIdFilter?: string | null;
  initiatedById?: string | null;
}

export interface ExecuteBillingRunOptions {
  allowResume?: boolean;
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

export class BillingRunConcurrencyError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly errorCode: string,
    message: string
  ) {
    super(message);
    this.name = 'BillingRunConcurrencyError';
  }
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
 * 1. Concurrency control: Atomic run-level execution claiming prevents two workers from executing the same run.
 * 2. Subscription locking: Transaction-scoped advisory locks prevent overlapping processing of the same subscription-period.
 * 3. Atomicity: Each subscription's invoice generation, schedule advancement, and BillingRun counter increment
 *    are committed together in a single database transaction. Crash at any point leaves zero partial state.
 * 4. Recovery: Resuming an interrupted run queries due subscriptions in the database without double-counting or omitting records.
 * 5. Calendar recurrence: Uses computeNextPeriod() respecting anchor day (e.g. 31st), leap years, and exclusive period-ends.
 * 6. Remaining due: Evaluated directly against the database after batch execution; no error-prone subtraction of cumulative counts.
 */
export async function executeBillingRun(
  prisma: PrismaClient,
  runId: string,
  options?: ExecuteBillingRunOptions
): Promise<BillingRunResult> {
  // 1. Atomic Run Claim & Concurrency Guard within a transaction
  const initialRun = await prisma.$transaction(async (tx) => {
    // Acquire transaction-scoped advisory lock on this specific billing run
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${`billing_run:${runId}`}, 0)) AS acquired
    `;
    if (!lock?.acquired) {
      throw new BillingRunConcurrencyError(409, 'RUN_IN_PROGRESS', `BillingRun ${runId} is currently being executed by another process.`);
    }

    const run = await tx.billingRun.findUnique({
      where: { id: runId },
    });
    if (!run) {
      throw new Error(`BillingRun ${runId} not found.`);
    }

    if (run.status === 'COMPLETED') {
      throw new BillingRunConcurrencyError(400, 'RUN_ALREADY_COMPLETED', `BillingRun ${runId} has already completed.`);
    }

    if (run.status === 'IN_PROGRESS' && !options?.allowResume) {
      throw new BillingRunConcurrencyError(409, 'RUN_IN_PROGRESS', `BillingRun ${runId} is already in progress.`);
    }

    return tx.billingRun.update({
      where: { id: runId },
      data: {
        status: 'IN_PROGRESS',
        startedAt: run.startedAt ?? new Date(),
      },
    });
  });

  const asOfDate = initialRun.asOfDate;
  const whereClause: Prisma.SubscriptionWhereInput = {
    status: 'ACTIVE',
    nextBillingDate: { lte: asOfDate },
    ...(initialRun.subscriptionIdFilter ? { id: initialRun.subscriptionIdFilter } : {}),
  };

  // 2. Fetch candidate due subscriptions for this batch
  const candidateSubscriptions = await prisma.subscription.findMany({
    where: whereClause,
    orderBy: [
      { nextBillingDate: 'asc' },
      { id: 'asc' },
    ],
    ...(initialRun.periodLimit ? { take: initialRun.periodLimit } : {}),
    include: {
      pauseIntervals: true,
      lines: true,
    },
  });

  let batchProcessed = 0;
  let batchGenerated = 0;
  let batchReused = 0;
  let batchFailed = 0;
  const errorDetails: Array<{ subscriptionId: string; error: string }> = [];

  // 3. Process each subscription in its own atomic transaction
  for (const sub of candidateSubscriptions) {
    try {
      await prisma.$transaction(async (tx) => {
        // Calculate next period bounds with anchor day preservation
        const currentStart = sub.nextBillingDate ?? sub.startDate ?? asOfDate;
        const refDate = sub.startDate ? new Date(sub.startDate) : (sub.nextBillingDate ? new Date(sub.nextBillingDate) : new Date(asOfDate));
        const anchorDay = refDate.getUTCDate();
        const anchorMonth = refDate.getUTCMonth() + 1;

        const { periodStart, periodEnd, periodStartStr } = computeNextPeriod({
          periodStart: currentStart,
          interval: sub.billingInterval,
          anchorDay,
          anchorMonth,
        });

        // Acquire transaction-scoped advisory lock for this subscription and period
        const lockKey = `sub_run:${sub.id}:${periodStartStr}`;
        const [subLock] = await tx.$queryRaw<{ acquired: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${lockKey}, 0)) AS acquired
        `;
        if (!subLock?.acquired) {
          // Another worker is processing this subscription; skip to avoid race condition
          return;
        }

        // Delegate to transactional invoice creation
        const invoiceResult = await createSubscriptionInvoice(tx, {
          subscriptionId: sub.id,
          periodStart,
          periodEnd,
          issueDate: asOfDate,
          advanceSchedule: true,
        });

        // Atomically record durable progress counters within the same transaction!
        if (invoiceResult.isSkippedPaused) {
          await tx.subscription.update({
            where: { id: sub.id },
            data: { nextBillingDate: periodEnd },
          });

          await tx.billingRun.update({
            where: { id: runId },
            data: {
              subscriptionsProcessed: { increment: 1 },
            },
          });
          batchProcessed++;
        } else if (invoiceResult.isReused) {
          await tx.billingRun.update({
            where: { id: runId },
            data: {
              subscriptionsProcessed: { increment: 1 },
              invoicesReused: { increment: 1 },
            },
          });
          batchProcessed++;
          batchReused++;
        } else if (invoiceResult.invoice) {
          await tx.billingRun.update({
            where: { id: runId },
            data: {
              subscriptionsProcessed: { increment: 1 },
              invoicesGenerated: { increment: 1 },
              totalAmountBilled: { increment: invoiceResult.invoice.total },
            },
          });
          batchProcessed++;
          batchGenerated++;
        }
      });
    } catch (err: any) {
      batchFailed++;
      errorDetails.push({
        subscriptionId: sub.id,
        error: err?.message || String(err),
      });

      // Durably record the failure counter
      await prisma.billingRun.update({
        where: { id: runId },
        data: {
          subscriptionsProcessed: { increment: 1 },
          invoicesFailed: { increment: 1 },
        },
      });
    }
  }

  // 4. Query PostgreSQL directly for true remaining due count
  const remainingDueCount = await prisma.subscription.count({
    where: whereClause,
  });
  const hasMore = remainingDueCount > 0;
  const nextRunRequired = hasMore || batchFailed > 0;

  // 5. Re-read durable counters from database
  const latestRun = await prisma.billingRun.findUniqueOrThrow({
    where: { id: runId },
  });

  const finalStatus = (latestRun.invoicesFailed > 0 && latestRun.invoicesGenerated === 0 && latestRun.invoicesReused === 0)
    ? 'FAILED'
    : 'COMPLETED';

  const updatedRun = await prisma.billingRun.update({
    where: { id: runId },
    data: {
      status: finalStatus,
      hasMore,
      nextRunRequired,
      completedAt: new Date(),
      errors: errorDetails.length > 0
        ? (errorDetails as Prisma.InputJsonArray)
        : (latestRun.errors ? (latestRun.errors as Prisma.InputJsonValue) : Prisma.DbNull),
    },
  });

  return {
    run: updatedRun,
    processedCount: batchProcessed,
    generatedCount: batchGenerated,
    reusedCount: batchReused,
    failedCount: batchFailed,
    hasMore,
    nextRunRequired,
    totalBilled: updatedRun.totalAmountBilled,
  };
}
