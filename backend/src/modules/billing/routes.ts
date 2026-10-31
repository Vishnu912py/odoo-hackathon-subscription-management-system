import { Router, type RequestHandler } from 'express';
import type { PrismaClient, BillingRun, InvoiceEmailOutbox } from '../../generated/prisma/client.js';
import type { Config } from '../../config.js';
import { HttpError } from '../../http/errors.js';
import { mutation, requireVersion, conflict, invalid } from '../../http/mutations.js';
import { validateBody, validateQuery, uuidPattern } from '../../http/validation.js';
import { actor } from '../accounts/routes.js';
import { requireMail } from '../accounts/mail.js';
import { businessDate, day, invoiceDetail, invoiceDetailInclude } from '../projections.js';
import { invoicePdf } from './pdf.js';

export const billingOperations = ['get /billing-runs', 'post /billing-runs/{id}/retry', 'get /invoices/{id}/deliveries', 'post /invoices/{id}/deliveries/{delivery_id}/retry', 'post /billing-runs', 'get /billing-runs/{id}', 'get /invoices/{id}/pdf',
  ...['confirm', 'cancel', 'send'].map(action => `post /invoices/{id}/${action}`)];

export function billingRunView(run: BillingRun) {
  const errors = Array.isArray(run.errors) ? run.errors as Array<Record<string, unknown>> : [];
  return { id: run.id, status: run.status === 'PENDING' ? 'queued' : run.status === 'IN_PROGRESS' ? 'running'
    : run.status === 'FAILED' ? 'failed' : run.invoicesFailed ? 'completed_with_errors' : 'completed',
    as_of: day(run.asOfDate), created_count: run.invoicesGenerated, reused_count: run.invoicesReused,
    failed_count: run.invoicesFailed, has_more: run.hasMore, next_run_required: run.nextRunRequired,
    created_at: run.createdAt.toISOString(), finished_at: run.completedAt?.toISOString() ?? null,
    errors: errors.map(e => ({ subscription_id: e.subscriptionId, period_start: e.periodStart ?? day(run.asOfDate),
      code: 'BILLING_FAILED', message: 'Period could not be billed. Correct its configuration and retry billing.' })) };
}

function deliveryView(job: InvoiceEmailOutbox) {
  return { id: job.id, invoice_id: job.invoiceId, recipient: job.recipientEmail, status: job.status.toLowerCase(), attempts: job.attempts,
    last_attempt_at: job.lastAttemptAt?.toISOString() ?? null, sent_at: job.sentAt?.toISOString() ?? null,
    error: job.error, created_at: job.createdAt.toISOString() };
}

export function billingRouter(prisma: PrismaClient, auth: { requireUser: RequestHandler; staff: RequestHandler; csrf: RequestHandler }, config: Config, now: () => Date) {
  const router = Router();
  const admin: RequestHandler = (_req, res, next) => {
    if (actor(res).role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Administrator access required.');
    next();
  };
  router.param('id', (_req, _res, next, id: string) => {
    if (!uuidPattern.test(id)) throw new HttpError(404, 'NOT_FOUND', 'Record not found.'); next();
  });
  router.get('/billing-runs', auth.requireUser, admin, validateQuery('/billing-runs'), async (_req, res) => {
    const q = res.locals.query, page = Number(q.page ?? 1), size = Number(q.page_size ?? 20);
    const where = q.q ? { id: uuidPattern.test(String(q.q)) ? String(q.q) : '00000000-0000-4000-8000-000000000000' } : {};
    const [rows, total] = await prisma.$transaction([prisma.billingRun.findMany({ where, skip: (page - 1) * size, take: size,
      orderBy: [{ createdAt: q.sort_order === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }] }), prisma.billingRun.count({ where })]);
    res.json({ data: rows.map(billingRunView), meta: { page, page_size: size, total, total_pages: Math.ceil(total / size) } });
  });
  router.post('/billing-runs/:id/retry', auth.requireUser, admin, auth.csrf, validateBody('EmptyInput'), async (req, res) => {
    await mutation(prisma, req, res, 202, false, async tx => {
      const previous = await tx.billingRun.findUnique({ where: { id: String(req.params.id) } });
      if (!previous) throw new HttpError(404, 'NOT_FOUND', 'Billing run not found.');
      if (!['FAILED', 'COMPLETED'].includes(previous.status) || (previous.status === 'COMPLETED' && !previous.invoicesFailed && !previous.nextRunRequired)) conflict('INVALID_TRANSITION', 'Only finished runs with failed or remaining periods can be retried.');
      return billingRunView(await tx.billingRun.create({ data: { asOfDate: previous.asOfDate, periodLimit: previous.periodLimit,
        subscriptionIdFilter: previous.subscriptionIdFilter, initiatedById: actor(res).id } }));
    });
  });
  router.get('/invoices/:id/deliveries', auth.requireUser, auth.staff, validateQuery('/invoices/{id}/deliveries'), async (req, res) => {
    const invoiceId = String(req.params.id), q = res.locals.query, page = Number(q.page ?? 1), size = Number(q.page_size ?? 20);
    if (!await prisma.invoice.findUnique({ where: { id: invoiceId } })) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found.');
    const [rows, total] = await prisma.$transaction([prisma.invoiceEmailOutbox.findMany({ where: { invoiceId }, skip: (page - 1) * size, take: size,
      orderBy: [{ createdAt: q.sort_order === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }] }), prisma.invoiceEmailOutbox.count({ where: { invoiceId } })]);
    res.json({ data: rows.map(deliveryView), meta: { page, page_size: size, total, total_pages: Math.ceil(total / size) } });
  });
  router.post('/invoices/:id/deliveries/:delivery_id/retry', auth.requireUser, auth.staff, auth.csrf, validateBody('EmptyInput'), async (req, res) => {
    if (!uuidPattern.test(String(req.params.delivery_id))) throw new HttpError(404, 'NOT_FOUND', 'Delivery not found.');
    await mutation(prisma, req, res, 202, false, async tx => {
      requireMail(config);
      const where = { id: String(req.params.delivery_id), invoiceId: String(req.params.id) };
      await tx.invoiceEmailOutbox.updateMany({ where, data: { attempts: { increment: 0 } } });
      const job = await tx.invoiceEmailOutbox.findFirst({ where, include: { invoice: true } });
      if (!job) throw new HttpError(404, 'NOT_FOUND', 'Delivery not found.');
      if (job.status !== 'FAILED' || !['CONFIRMED', 'PAID'].includes(job.invoice.status)) conflict('INVALID_TRANSITION', 'Only failed deliveries for confirmed or paid invoices can be retried.');
      return deliveryView(await tx.invoiceEmailOutbox.update({ where: { id: job.id }, data: { status: 'PENDING', lastAttemptAt: null, error: null } }));
    });
  });
  router.post('/billing-runs', auth.requireUser, admin, auth.csrf, validateBody('BillingRunInput'), async (req, res) => {
    await mutation(prisma, req, res, 202, false, async tx => {
      if (req.body.as_of > businessDate(now())) invalid('Billing cannot run in the future.');
      if (req.body.subscription_id && !await tx.subscription.findUnique({ where: { id: req.body.subscription_id } })) throw new HttpError(404, 'NOT_FOUND', 'Subscription not found.');
      return billingRunView(await tx.billingRun.create({ data: { asOfDate: new Date(req.body.as_of), periodLimit: req.body.limit,
        subscriptionIdFilter: req.body.subscription_id, initiatedById: actor(res).id } }));
    });
  });
  router.get('/billing-runs/:id', auth.requireUser, admin, validateQuery('/billing-runs/{id}'), async (req, res) => {
    const row = await prisma.billingRun.findUnique({ where: { id: String(req.params.id) } });
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Billing run not found.');
    res.json({ data: billingRunView(row) });
  });
  router.get('/invoices/:id/pdf', auth.requireUser, validateQuery('/invoices/{id}/pdf'), async (req, res) => {
    const user = actor(res);
    const row = await prisma.invoice.findFirst({ where: { id: String(req.params.id),
      ...(user.role === 'CUSTOMER' ? { subscription: { customer: { userId: user.id } } } : {}) }, include: invoiceDetailInclude });
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found.');
    const pdf = await invoicePdf(invoiceDetail(row, user.role, businessDate(now())));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', `inline; filename="invoice-${row.id}.pdf"`);
    res.type('application/pdf').send(pdf);
  });
  for (const action of ['confirm', 'cancel', 'send']) {
    router.post(`/invoices/:id/${action}`, auth.requireUser, auth.staff, auth.csrf,
      validateBody(action === 'cancel' ? 'ReasonInput' : 'EmptyInput'), async (req, res) => {
        await mutation(prisma, req, res, action === 'send' ? 202 : 200, true, async tx => {
          const id = String(req.params.id);
          await tx.invoice.updateMany({ where: { id }, data: { version: { increment: 0 } } });
          const row = await tx.invoice.findUnique({ where: { id }, include: invoiceDetailInclude });
          if (!row) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found.');
          requireVersion(req, row.version);
          if (action === 'send') {
            requireMail(config);
            if (!['CONFIRMED', 'PAID'].includes(row.status)) conflict('INVALID_TRANSITION', 'Only confirmed or paid invoices can be emailed.');
            const job = await tx.invoiceEmailOutbox.create({ data: { invoiceId: id, recipientEmail: row.billingEmailSnapshot, idempotencyKey: req.get('Idempotency-Key')! } });
            return { delivery_id: job.id, invoice_id: id, status: 'queued', recipient: job.recipientEmail };
          }
          if (action === 'confirm' && row.status !== 'DRAFT') conflict('INVALID_TRANSITION', 'Only draft invoices can be confirmed.');
          if (action === 'cancel' && (!['DRAFT', 'CONFIRMED'].includes(row.status) || !row.amountPaid.isZero())) conflict('INVALID_TRANSITION', 'Only unpaid draft or confirmed invoices can be cancelled.');
          const updated = await tx.invoice.update({ where: { id }, data: { version: { increment: 1 },
            status: action === 'cancel' ? 'CANCELLED' : row.total.isZero() ? 'PAID' : 'CONFIRMED',
            ...(action === 'cancel' ? { cancelledAt: now() } : {}) }, include: invoiceDetailInclude });
          await tx.subscriptionEvent.create({ data: { subscriptionId: row.subscriptionId, actorUserId: actor(res).id,
            eventType: `invoice_${action}`, details: { invoice_id: id, ...(action === 'cancel' ? { reason: req.body.reason } : {}) } } });
          return invoiceDetail(updated, actor(res).role, businessDate(now()));
        });
      });
  }
  return router;
}
