import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { Decimal, day } from '../projections.js';

export interface MonthlyOverviewBucket {
  month: string;
  invoiced_total: string;
  payments_received: string;
}

export interface OverviewReportData {
  from: string;
  to: string;
  as_of: string;
  currency: 'INR';
  active_subscriptions: number;
  paused_subscriptions: number;
  invoiced_total: string;
  payments_received: string;
  outstanding_balance: string;
  overdue_balance: string;
  overdue_invoice_count: number;
  monthly: MonthlyOverviewBucket[];
  revenue_basis: 'invoiced_excluding_cancelled';
}

export interface ReportFilterOptions {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  asOf: string; // YYYY-MM-DD (Asia/Kolkata business date)
  planId?: string | undefined;
  customerId?: string | undefined;
  customerUserId?: string | undefined;
  subscriptionScope?: Prisma.SubscriptionWhereInput | undefined;
}

/**
 * Execute report aggregation queries inside a single database transaction.
 *
 * Implements D4: Database-side aggregation for active/paused subscriptions,
 * outstanding & overdue balances, invoiced totals, and payments received,
 * with customer isolation and monthly series bucketing.
 */
async function executeReportQueries(
  tx: Prisma.TransactionClient,
  options: ReportFilterOptions
): Promise<OverviewReportData> {
  const { from, to, asOf } = options;

  if (from > to) {
    throw new Error(`Invalid report date range: from (${from}) must be less than or equal to to (${to}).`);
  }

  // Derive scoping parameters enforcing customer isolation
  const subscriptionWhere: Prisma.SubscriptionWhereInput = {
    ...(options.subscriptionScope ?? {}),
  };

  if (options.customerUserId) {
    subscriptionWhere.customer = { userId: options.customerUserId };
  } else if (options.customerId) {
    subscriptionWhere.customerId = options.customerId;
  }

  if (options.planId) {
    subscriptionWhere.planId = options.planId;
  }

  // 1. Subscription Counts: ACTIVE as of business date (excluding expired or not-yet-started)
  const asOfDate = new Date(asOf);
  const currentSubWhere: Prisma.SubscriptionWhereInput = {
    ...subscriptionWhere,
    status: 'ACTIVE',
    startDate: { lte: asOfDate },
    OR: [
      { expiryDate: null },
      { expiryDate: { gt: asOfDate } },
    ],
  };

  const activeCount = await tx.subscription.count({
    where: { ...currentSubWhere, isPaused: false },
  });

  const pausedCount = await tx.subscription.count({
    where: { ...currentSubWhere, isPaused: true },
  });

  // 2. Balances: Outstanding (current point-in-time) and Overdue (due_date < asOf) for confirmed invoices
  const confirmedInvoices = await tx.invoice.findMany({
    where: {
      subscription: subscriptionWhere,
      status: 'CONFIRMED',
    },
    select: {
      dueDate: true,
      total: true,
      amountPaid: true,
    },
  });

  let outstanding = new Decimal(0);
  let overdue = new Decimal(0);
  let overdueCount = 0;

  for (const inv of confirmedInvoices) {
    const balance = inv.total.minus(inv.amountPaid);
    if (balance.gt(0)) {
      outstanding = outstanding.plus(balance);
      if (day(inv.dueDate)! < asOf) {
        overdue = overdue.plus(balance);
        overdueCount++;
      }
    }
  }

  // 3. Monthly Invoices: Grouped by issue_date month for CONFIRMED and PAID invoices within [from, to]
  const invoices = await tx.invoice.findMany({
    where: {
      subscription: subscriptionWhere,
      status: { in: ['CONFIRMED', 'PAID'] },
      issueDate: {
        gte: new Date(from),
        lte: new Date(to),
      },
    },
    select: {
      issueDate: true,
      total: true,
    },
  });

  // 4. Monthly Payments: Grouped by payment_date month for recorded payments within [from, to]
  const payments = await tx.payment.findMany({
    where: {
      invoice: { subscription: subscriptionWhere },
      paymentDate: {
        gte: new Date(from),
        lte: new Date(to),
      },
    },
    select: {
      paymentDate: true,
      amount: true,
    },
  });

  // 5. Generate continuous monthly series from fromMonth to toMonth (including zero-activity months)
  const buckets = new Map<string, { month: string; invoiced_total: Prisma.Decimal; payments_received: Prisma.Decimal }>();
  const cursor = new Date(`${from.slice(0, 7)}-01`);
  while (day(cursor)!.slice(0, 7) <= to.slice(0, 7)) {
    const month = day(cursor)!.slice(0, 7);
    buckets.set(month, { month, invoiced_total: new Decimal(0), payments_received: new Decimal(0) });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  let invoicedTotal = new Decimal(0);
  for (const inv of invoices) {
    invoicedTotal = invoicedTotal.plus(inv.total);
    const m = day(inv.issueDate)!.slice(0, 7);
    const bucket = buckets.get(m);
    if (bucket) {
      bucket.invoiced_total = bucket.invoiced_total.plus(inv.total);
    }
  }

  let paymentsReceived = new Decimal(0);
  for (const p of payments) {
    paymentsReceived = paymentsReceived.plus(p.amount);
    const m = day(p.paymentDate)!.slice(0, 7);
    const bucket = buckets.get(m);
    if (bucket) {
      bucket.payments_received = bucket.payments_received.plus(p.amount);
    }
  }

  return {
    from,
    to,
    as_of: asOf,
    currency: 'INR',
    active_subscriptions: activeCount,
    paused_subscriptions: pausedCount,
    invoiced_total: invoicedTotal.toFixed(2),
    payments_received: paymentsReceived.toFixed(2),
    outstanding_balance: outstanding.toFixed(2),
    overdue_balance: overdue.toFixed(2),
    overdue_invoice_count: overdueCount,
    monthly: Array.from(buckets.values()).map(b => ({
      month: b.month,
      invoiced_total: b.invoiced_total.toFixed(2),
      payments_received: b.payments_received.toFixed(2),
    })),
    revenue_basis: 'invoiced_excluding_cancelled',
  };
}

/**
 * Public reporting persistence function.
 *
 * Ensures all report queries execute within a single RepeatableRead transaction
 * snapshot, preserving consistent point-in-time metrics.
 */
export async function getOverviewReport(
  db: PrismaClient | Prisma.TransactionClient,
  options: ReportFilterOptions
): Promise<OverviewReportData> {
  if ('$transaction' in db && typeof db.$transaction === 'function') {
    return await db.$transaction(
      async (tx) => executeReportQueries(tx, options),
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead }
    );
  }
  return await executeReportQueries(db as Prisma.TransactionClient, options);
}
