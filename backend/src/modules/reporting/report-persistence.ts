import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { Decimal } from '../projections.js';

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

  // Derive scoping parameters from options and optional subscriptionScope
  let customerUserId = options.customerUserId;
  let customerId = options.customerId;
  let planId = options.planId;

  if (options.subscriptionScope) {
    const scope = options.subscriptionScope;
    if (scope.customer && typeof scope.customer === 'object' && 'userId' in scope.customer) {
      customerUserId = String((scope.customer as { userId?: string }).userId);
    }
    if (scope.customerId && typeof scope.customerId === 'string') {
      customerId = String(scope.customerId);
    }
    if (scope.planId && typeof scope.planId === 'string') {
      planId = String(scope.planId);
    }
  }

  // Common subscription WHERE conditions for SQL queries
  const subConditions: Prisma.Sql[] = [];
  if (customerUserId) {
    subConditions.push(Prisma.sql`c.user_id = ${customerUserId}::uuid`);
  } else if (customerId) {
    subConditions.push(Prisma.sql`s.customer_id = ${customerId}::uuid`);
  }

  if (planId) {
    subConditions.push(Prisma.sql`s.plan_id = ${planId}::uuid`);
  }

  // 1. Subscription Counts: ACTIVE as of business date (excluding expired or not-yet-started)
  const subCountConditions: Prisma.Sql[] = [
    Prisma.sql`s.status = 'ACTIVE'`,
    Prisma.sql`s.start_date <= ${asOf}::date`,
    Prisma.sql`(s.expiry_date IS NULL OR s.expiry_date > ${asOf}::date)`,
    ...subConditions,
  ];

  const subCountWhere = Prisma.sql`WHERE ${Prisma.join(subCountConditions, ' AND ')}`;

  const [subRow] = await tx.$queryRaw<Array<{
    active_subscriptions: number | bigint | string;
    paused_subscriptions: number | bigint | string;
  }>>`
    SELECT
      COALESCE(COUNT(CASE WHEN s.is_paused = false THEN 1 END), 0)::int AS active_subscriptions,
      COALESCE(COUNT(CASE WHEN s.is_paused = true THEN 1 END), 0)::int AS paused_subscriptions
    FROM subscriptions s
    ${customerUserId ? Prisma.sql`JOIN customers c ON s.customer_id = c.id` : Prisma.empty}
    ${subCountWhere}
  `;

  // 2. Balances: Outstanding (current point-in-time) and Overdue (due_date < asOf) for confirmed invoices
  const balanceConditions: Prisma.Sql[] = [
    Prisma.sql`i.status = 'CONFIRMED'`,
    Prisma.sql`i.total > i.amount_paid`,
    ...subConditions,
  ];

  const balanceWhere = Prisma.sql`WHERE ${Prisma.join(balanceConditions, ' AND ')}`;

  const [balanceRow] = await tx.$queryRaw<Array<{
    outstanding_balance: string;
    overdue_balance: string;
    overdue_invoice_count: number | bigint | string;
  }>>`
    SELECT
      COALESCE(SUM(i.total - i.amount_paid), 0)::text AS outstanding_balance,
      COALESCE(SUM(CASE WHEN i.due_date < ${asOf}::date THEN i.total - i.amount_paid ELSE 0 END), 0)::text AS overdue_balance,
      COALESCE(COUNT(CASE WHEN i.due_date < ${asOf}::date THEN 1 END), 0)::int AS overdue_invoice_count
    FROM invoices i
    JOIN subscriptions s ON i.subscription_id = s.id
    ${customerUserId ? Prisma.sql`JOIN customers c ON s.customer_id = c.id` : Prisma.empty}
    ${balanceWhere}
  `;

  // 3. Monthly Invoices: Grouped by issue_date month for CONFIRMED and PAID invoices within [from, to]
  const invoiceConditions: Prisma.Sql[] = [
    Prisma.sql`i.status IN ('CONFIRMED', 'PAID')`,
    Prisma.sql`i.issue_date >= ${from}::date`,
    Prisma.sql`i.issue_date <= ${to}::date`,
    ...subConditions,
  ];

  const invoiceWhere = Prisma.sql`WHERE ${Prisma.join(invoiceConditions, ' AND ')}`;

  const monthlyInvoices = await tx.$queryRaw<Array<{
    month: string;
    invoiced_total: string;
  }>>`
    SELECT
      TO_CHAR(i.issue_date, 'YYYY-MM') AS month,
      COALESCE(SUM(i.total), 0)::text AS invoiced_total
    FROM invoices i
    JOIN subscriptions s ON i.subscription_id = s.id
    ${customerUserId ? Prisma.sql`JOIN customers c ON s.customer_id = c.id` : Prisma.empty}
    ${invoiceWhere}
    GROUP BY TO_CHAR(i.issue_date, 'YYYY-MM')
    ORDER BY month ASC
  `;

  // 4. Monthly Payments: Grouped by payment_date month for recorded payments within [from, to]
  const paymentConditions: Prisma.Sql[] = [
    Prisma.sql`p.payment_date >= ${from}::date`,
    Prisma.sql`p.payment_date <= ${to}::date`,
    ...subConditions,
  ];

  const paymentWhere = Prisma.sql`WHERE ${Prisma.join(paymentConditions, ' AND ')}`;

  const monthlyPayments = await tx.$queryRaw<Array<{
    month: string;
    payments_received: string;
  }>>`
    SELECT
      TO_CHAR(p.payment_date, 'YYYY-MM') AS month,
      COALESCE(SUM(p.amount), 0)::text AS payments_received
    FROM payments p
    JOIN invoices i ON p.invoice_id = i.id
    JOIN subscriptions s ON i.subscription_id = s.id
    ${customerUserId ? Prisma.sql`JOIN customers c ON s.customer_id = c.id` : Prisma.empty}
    ${paymentWhere}
    GROUP BY TO_CHAR(p.payment_date, 'YYYY-MM')
    ORDER BY month ASC
  `;

  // 5. Generate continuous monthly series from fromMonth to toMonth (including zero-activity months)
  const buckets = new Map<string, MonthlyOverviewBucket>();
  const startParts = from.slice(0, 7).split('-');
  const endParts = to.slice(0, 7).split('-');
  const startYear = parseInt(startParts[0] || '1970', 10);
  const startMonthNum = parseInt(startParts[1] || '1', 10);
  const endYear = parseInt(endParts[0] || '1970', 10);
  const endMonthNum = parseInt(endParts[1] || '1', 10);

  let curYear: number = startYear;
  let curMonth: number = startMonthNum;

  while (curYear < endYear || (curYear === endYear && curMonth <= endMonthNum)) {
    const monthKey = `${curYear}-${String(curMonth).padStart(2, '0')}`;
    buckets.set(monthKey, {
      month: monthKey,
      invoiced_total: '0.00',
      payments_received: '0.00',
    });
    curMonth++;
    if (curMonth > 12) {
      curMonth = 1;
      curYear++;
    }
  }

  // Populate monthly invoiced totals and accumulate total
  let invoicedTotalAcc = new Decimal('0.00');
  for (const row of monthlyInvoices) {
    const dec = new Decimal(row.invoiced_total || '0.00');
    invoicedTotalAcc = invoicedTotalAcc.plus(dec);
    const bucket = buckets.get(row.month);
    if (bucket) {
      bucket.invoiced_total = dec.toFixed(2);
    }
  }

  // Populate monthly payments received and accumulate total
  let paymentsReceivedAcc = new Decimal('0.00');
  for (const row of monthlyPayments) {
    const dec = new Decimal(row.payments_received || '0.00');
    paymentsReceivedAcc = paymentsReceivedAcc.plus(dec);
    const bucket = buckets.get(row.month);
    if (bucket) {
      bucket.payments_received = dec.toFixed(2);
    }
  }

  return {
    from,
    to,
    as_of: asOf,
    currency: 'INR',
    active_subscriptions: Number(subRow?.active_subscriptions ?? 0),
    paused_subscriptions: Number(subRow?.paused_subscriptions ?? 0),
    invoiced_total: invoicedTotalAcc.toFixed(2),
    payments_received: paymentsReceivedAcc.toFixed(2),
    outstanding_balance: new Decimal(balanceRow?.outstanding_balance ?? '0.00').toFixed(2),
    overdue_balance: new Decimal(balanceRow?.overdue_balance ?? '0.00').toFixed(2),
    overdue_invoice_count: Number(balanceRow?.overdue_invoice_count ?? 0),
    monthly: Array.from(buckets.values()),
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
