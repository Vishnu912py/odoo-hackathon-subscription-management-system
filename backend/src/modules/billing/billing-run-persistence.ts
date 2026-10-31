import pg from 'pg';
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
  connectionString?: string;
  lockClient?: pg.Client;
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
 * Concurrency & Recovery Architecture:
 * 1. Session-Level Advisory Lock: Acquired on a dedicated PostgreSQL connection (pg.Client)
 *    via `pg_try_advisory_lock(hashtextextended('billing_run:' || runId, 0))`.
 *    The lock is held continuously across the entire execution life-cycle of the billing run,
 *    preventing any second worker from executing concurrently.
 * 2. Strict allowResume Protection: Even with `allowResume: true`, a competing worker CANNOT
 *    bypass an active worker's session lock; it is immediately rejected with 409 RUN_IN_PROGRESS.
 * 3. Abandoned vs Active Discrimination: If an earlier worker crashed or disconnected,
 *    PostgreSQL automatically frees the session-level advisory lock when the socket terminates.
 *    A subsequent worker is able to acquire the session lock and detect that `status === 'IN_PROGRESS'`.
 *    With `allowResume: true`, it safely resumes; without it, it instructs the operator to resume.
 * 4. Atomic Per-Subscription Commits: Each subscription's invoice generation, schedule advancement,
 *    and BillingRun progress counters are committed together inside an interactive transaction.
 * 5. Remaining Due Accuracy: Evaluates `hasMore` directly against PostgreSQL due subscriptions.
 */
export async function executeBillingRun(
  prisma: PrismaClient,
  runId: string,
  options?: ExecuteBillingRunOptions
): Promise<BillingRunResult> {
  let lockClient: pg.Client | null = options?.lockClient ?? null;
  let ownsLockClient = false;
  const lockKey = `billing_run:${runId}`;

  if (!lockClient) {
    const connectionString =
      options?.connectionString ||
      process.env.DIRECT_URL ||
      process.env.DATABASE_URL ||
      'postgresql://brightloop:brightloop_test_password@localhost:5432/subscription_management_test?schema=public';
    lockClient = new pg.Client({ connectionString });
    await lockClient.connect();
    ownsLockClient = true;
  }

  let lockAcquired = false;

  try {
    // 1. Acquire session-level advisory lock on dedicated connection
    const lockRes = await lockClient.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [lockKey]
    );
    lockAcquired = lockRes.rows[0]?.acquired ?? false;

    if (!lockAcquired) {
      throw new BillingRunConcurrencyError(
        409,
        'RUN_IN_PROGRESS',
        `BillingRun ${runId} is currently being executed by another active worker.`
      );
    }

    // 2. Fetch and validate current BillingRun state in database
    const initialRun = await prisma.billingRun.findUnique({
      where: { id: runId },
    });
    if (!initialRun) {
      throw new Error(`BillingRun ${runId} not found.`);
    }

    if (initialRun.status === 'COMPLETED') {
      throw new BillingRunConcurrencyError(400, 'RUN_ALREADY_COMPLETED', `BillingRun ${runId} has already completed.`);
    }

    if (initialRun.status === 'IN_PROGRESS' && !options?.allowResume) {
      throw new BillingRunConcurrencyError(
        409,
        'RUN_IN_PROGRESS',
        `BillingRun ${runId} was previously marked IN_PROGRESS. Specify allowResume: true to resume an abandoned run.`
      );
    }

    if (initialRun.status !== 'IN_PROGRESS') {
      await prisma.billingRun.update({
        where: { id: runId },
        data: {
          status: 'IN_PROGRESS',
          startedAt: initialRun.startedAt ?? new Date(),
        },
      });
    }

    const asOfDate = initialRun.asOfDate;
    const whereClause: Prisma.SubscriptionWhereInput = {
      status: 'ACTIVE',
      nextBillingDate: { lte: asOfDate },
      ...(initialRun.subscriptionIdFilter ? { id: initialRun.subscriptionIdFilter } : {}),
    };

    // 3. Fetch candidate due subscriptions for this batch
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

    // 4. Process each subscription in its own atomic transaction
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
          const subLockKey = `sub_run:${sub.id}:${periodStartStr}`;
          const [subLock] = await tx.$queryRaw<{ acquired: boolean }[]>`
            SELECT pg_try_advisory_xact_lock(hashtextextended(${subLockKey}, 0)) AS acquired
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

    // 5. Query PostgreSQL directly for true remaining due count
    const remainingDueCount = await prisma.subscription.count({
      where: whereClause,
    });
    const hasMore = remainingDueCount > 0;
    const nextRunRequired = hasMore || batchFailed > 0;

    // 6. Re-read durable counters from database
    const latestRun = await prisma.billingRun.findUniqueOrThrow({
      where: { id: runId },
    });

    let finalStatus: string;
    let completedAtDate: Date | null = null;

    if (hasMore) {
      // Due subscriptions remain: keep run resumable in IN_PROGRESS state
      finalStatus = 'IN_PROGRESS';
      completedAtDate = null;
    } else if (latestRun.invoicesFailed > 0 && latestRun.invoicesGenerated === 0 && latestRun.invoicesReused === 0) {
      // Batch complete but all invoices failed: mark FAILED
      finalStatus = 'FAILED';
      completedAtDate = new Date();
    } else {
      // Batch complete with successful/reused invoices: mark COMPLETED
      finalStatus = 'COMPLETED';
      completedAtDate = new Date();
    }

    const updatedRun = await prisma.billingRun.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        hasMore,
        nextRunRequired,
        completedAt: completedAtDate,
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
  } finally {
    if (lockAcquired && lockClient) {
      try {
        await lockClient.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [lockKey]);
      } catch {
        // Ignore unlock errors during cleanup
      }
    }
    if (ownsLockClient && lockClient) {
      await lockClient.end().catch(() => {});
    }
  }
}
