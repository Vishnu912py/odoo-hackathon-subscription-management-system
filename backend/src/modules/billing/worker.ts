import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Config } from '../../config.js';
import { databaseConnectionUrl } from '../../db/connection.js';
import { gmailTransport, type MailTransport } from '../accounts/mail.js';
import { businessDate, invoiceDetail, invoiceDetailInclude } from '../projections.js';
import { reconcileSubscriptions } from '../subscriptions/state.js';
import { BillingRunConcurrencyError, executeBillingRun } from './billing-run-persistence.js';

// Persist the scheduled run once per business date. A crash before/after execution
// leaves either PENDING/IN_PROGRESS work or a completed durable result.
export async function processBilling(prisma: PrismaClient, config: Config, now = new Date()) {
  const today = businessDate(now);
  await reconcileSubscriptions(prisma, today, {});
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('billing-scheduler', 0))::text`;
    const existing = await tx.billingRun.findMany({ where: { initiatedById: null, asOfDate: new Date(today), subscriptionIdFilter: null } });
    const failedIds = existing.flatMap(run => Array.isArray(run.errors) ? run.errors.flatMap(error => error && typeof error === 'object' && 'subscriptionId' in error && typeof error.subscriptionId === 'string' ? [error.subscriptionId] : []) : []);
    const pending = existing.some(run => ['PENDING', 'IN_PROGRESS'].includes(run.status));
    const newlyDue = !pending && await tx.subscription.count({ where: { status: { in: ['ACTIVE', 'CLOSED'] }, nextBillingDate: { lte: new Date(today) }, id: { notIn: failedIds } } });
    if (!existing.length || newlyDue) await tx.billingRun.create({ data: { asOfDate: new Date(today), periodLimit: 100 } });
  });
  const runs = await prisma.billingRun.findMany({ where: { status: { in: ['PENDING', 'IN_PROGRESS'] } }, orderBy: { createdAt: 'asc' }, take: 10 });
  for (const run of runs) {
    try {
      await executeBillingRun(prisma, run.id, { allowResume: true, ...(config.databaseUrl ? { connectionString: databaseConnectionUrl(config.databaseUrl) } : {}) });
    } catch (error) {
      if (!(error instanceof BillingRunConcurrencyError)) throw error;
    }
  }
  return { runs_processed: runs.length };
}

// Claim under a row lock; retain the lock through the bounded provider request.
// Ambiguous provider acceptance can still duplicate delivery after a crash;
// idempotent HTTP retries themselves never create another outbox job.
export async function deliverInvoices(prisma: PrismaClient, config: Config, transport: MailTransport = gmailTransport(config), maximum = 5) {
  if (!config.mail) return;
  for (let i = 0; i < maximum; i++) {
    const found = await prisma.$transaction(async tx => {
      const candidate = await tx.invoiceEmailOutbox.findFirst({ where: { status: { in: ['PENDING', 'FAILED'] },
        OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 300_000) } }] }, orderBy: { createdAt: 'asc' } });
      if (!candidate) return false;
      const claim = await tx.invoiceEmailOutbox.updateMany({ where: { id: candidate.id, status: candidate.status, lastAttemptAt: candidate.lastAttemptAt }, data: { lastAttemptAt: new Date() } });
      if (!claim.count) return true;
      const job = await tx.invoiceEmailOutbox.findUniqueOrThrow({ where: { id: candidate.id }, include: { invoice: { include: invoiceDetailInclude } } });
      await tx.invoice.updateMany({ where: { id: job.invoiceId }, data: { version: { increment: 0 } } });
      job.invoice = await tx.invoice.findUniqueOrThrow({ where: { id: job.invoiceId }, include: invoiceDetailInclude });
      if (!['CONFIRMED', 'PAID'].includes(job.invoice.status)) {
        await tx.invoiceEmailOutbox.update({ where: { id: job.id }, data: { status: 'CANCELLED', error: 'Invoice no longer deliverable.' } }); return true;
      }
      const invoice = invoiceDetail(job.invoice, 'ADMIN', businessDate(new Date()));
      try {
        await transport({ to: job.recipientEmail, subject: `Brightloop invoice ${invoice.number}`,
          text: [`Invoice ${invoice.number}`, `Customer: ${invoice.customer_name}`, `Status: ${invoice.status}`,
            `Period: ${invoice.period_start} to ${invoice.period_end} (exclusive)`, `Due: ${invoice.due_date}`,
            ...invoice.lines.map(line => `${line.description}: ${line.quantity} x INR ${line.unit_price}; discount ${line.discount_amount}; tax ${line.tax_amount}; total ${line.total}`),
            `Total: INR ${invoice.total}`, `Paid: INR ${invoice.amount_paid}`, `Balance: INR ${invoice.balance_due}`,
            `Sign in to view and print your invoice: ${config.frontendOrigin}`].join('\n') });
        await tx.invoiceEmailOutbox.update({ where: { id: job.id }, data: { status: 'SENT', attempts: { increment: 1 }, lastAttemptAt: new Date(), sentAt: new Date(), error: null } });
        await tx.invoice.update({ where: { id: job.invoiceId }, data: { sentAt: new Date(), version: { increment: 1 } } });
      } catch {
        await tx.invoiceEmailOutbox.update({ where: { id: job.id }, data: { status: 'FAILED', attempts: { increment: 1 }, lastAttemptAt: new Date(), error: 'Email delivery failed; retry scheduled.' } });
      }
      return true;
    }, { timeout: 15_000 });
    if (!found) break;
  }
}
