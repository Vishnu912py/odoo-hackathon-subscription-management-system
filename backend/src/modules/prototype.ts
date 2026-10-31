import { Router, type Response } from 'express';
import { Prisma, type PrismaClient, type InvoiceStatus, type SubscriptionStatus } from '../generated/prisma/client.js';
import type { Config } from '../config.js';
import { HttpError } from '../http/errors.js';
import { validateBody, validateQuery, uuidPattern } from '../http/validation.js';
import type { MailTransport } from './accounts/mail.js';
import { authentication, actor, type Actor } from './accounts/routes.js';
import { recordPayment } from './billing/payments.js';
import { getOverviewReport } from './reporting/report-persistence.js';
import { businessDate, day, Decimal, invoiceDetail, invoiceDetailInclude, invoiceInclude, invoiceSummary,
  paymentInclude, paymentView, subscriptionDetail, subscriptionInclude, subscriptionSummary } from './projections.js';

type Query = Record<string, string | number | boolean>;
const query = (res: Response) => res.locals.query as Query;
function scope(user: Actor, q: Query): Prisma.SubscriptionWhereInput {
  if (user.role === 'CUSTOMER') {
    if (q.customer_id !== undefined) throw new HttpError(403, 'FORBIDDEN', 'Customers cannot supply customer_id filters.');
    return { customer: { userId: user.id } };
  }
  return q.customer_id ? { customerId: String(q.customer_id) } : {};
}
function paging(q: Query) {
  const page = Number(q.page ?? 1), size = Number(q.page_size ?? 20);
  if (!Number.isSafeInteger(page) || !Number.isSafeInteger((page - 1) * size)) throw new HttpError(400, 'MALFORMED_REQUEST', 'Page is too large.');
  return { skip: (page - 1) * size, take: size };
}
function meta(q: Query, total: number) {
  return { page: Number(q.page ?? 1), page_size: Number(q.page_size ?? 20), total, total_pages: Math.ceil(total / Number(q.page_size ?? 20)) };
}
function order(q: Query, fallback = 'createdAt') {
  const fields: Record<string, string> = { created_at: 'createdAt', number: 'number', next_billing_date: 'nextBillingDate', due_date: 'dueDate', payment_date: 'paymentDate' };
  return [{ [fields[String(q.sort_by)] ?? fallback]: q.sort_order === 'asc' ? 'asc' as const : 'desc' as const }, { id: 'asc' as const }];
}
function dates(q: Query) { return { ...(q.from ? { gte: new Date(String(q.from)) } : {}), ...(q.to ? { lte: new Date(String(q.to)) } : {}) }; }
export const implemented = new Set([
  'get /auth/csrf', 'get /auth/me', 'post /auth/login', 'post /auth/register', 'post /auth/logout',
  'post /auth/forgot-password', 'post /auth/reset-password', 'get /staff', 'post /staff', 'get /staff/{id}', 'patch /staff/{id}',
  'get /subscriptions', 'get /subscriptions/{id}', 'get /invoices', 'get /invoices/{id}',
  'get /payments', 'get /invoices/{id}/payments', 'post /invoices/{id}/payments', 'get /reports/overview', 'get /portal/overview',
]);

export function prototypeRouter(prisma: PrismaClient | undefined, config: Config, now: () => Date = () => new Date(), transport?: MailTransport) {
  const router = Router();
  if (!prisma) {
    for (const operation of implemented) {
      const [method, path] = operation.split(' ') as ['get' | 'post' | 'patch', string];
      router[method](path.replace('{id}', ':id'), () => { throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Configure PostgreSQL before using this feature.'); });
    }
    return router;
  }
  const auth = authentication(prisma, config, transport);
  router.use(auth.router);
  router.param('id', (_req, _res, next, id: string) => {
    if (!uuidPattern.test(id)) return next(new HttpError(404, 'NOT_FOUND', 'Record not found.'));
    next();
  });
  router.get('/subscriptions', auth.requireUser, validateQuery('/subscriptions'), async (_req, res) => {
    const q = query(res), user = actor(res);
    const where: Prisma.SubscriptionWhereInput = { ...scope(user, q),
      ...(q.plan_id ? { planId: String(q.plan_id) } : {}),
      ...(q.status ? { status: String(q.status).toUpperCase() as SubscriptionStatus } : {}),
      ...(q.is_paused !== undefined ? { isPaused: q.is_paused === true } : {}),
      ...(q.q ? { OR: [{ number: { contains: String(q.q), mode: 'insensitive' } },
        { customer: { name: { contains: String(q.q), mode: 'insensitive' } } }, { plan: { name: { contains: String(q.q), mode: 'insensitive' } } }] } : {}),
    };
    const [rows, total] = await prisma.$transaction([prisma.subscription.findMany({ where, include: subscriptionInclude, ...paging(q), orderBy: order(q) }),
      prisma.subscription.count({ where })], { isolationLevel: 'RepeatableRead' });
    res.json({ data: rows.map(row => subscriptionSummary(row, businessDate(now()))), meta: meta(q, total) });
  });
  router.get('/subscriptions/:id', auth.requireUser, validateQuery('/subscriptions/{id}'), async (req, res) => {
    const row = await prisma.subscription.findFirst({ where: { id: String(req.params.id), ...scope(actor(res), {}) }, include: subscriptionInclude });
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Subscription not found.');
    res.json({ data: subscriptionDetail(row, businessDate(now())) });
  });
  router.get('/invoices', auth.requireUser, validateQuery('/invoices'), async (_req, res) => {
    const q = query(res), user = actor(res), today = businessDate(now());
    const conditions: Prisma.InvoiceWhereInput[] = [{ subscription: scope(user, q) },
      ...(q.subscription_id ? [{ subscriptionId: String(q.subscription_id) }] : []),
      ...(q.status ? [{ status: String(q.status).toUpperCase() as InvoiceStatus }] : []),
      ...(q.from || q.to ? [{ issueDate: dates(q) }] : []),
      ...(q.q ? [{ OR: [{ number: { contains: String(q.q), mode: 'insensitive' as const } }, { customerNameSnapshot: { contains: String(q.q), mode: 'insensitive' as const } }] }] : []),
    ];
    const overdue: Prisma.InvoiceWhereInput = { status: 'CONFIRMED', dueDate: { lt: new Date(today) }, amountPaid: { lt: prisma.invoice.fields.total } };
    if (q.overdue !== undefined) conditions.push(q.overdue ? overdue : { NOT: overdue });
    const where = { AND: conditions };
    const [rows, total] = await prisma.$transaction([prisma.invoice.findMany({ where, include: invoiceInclude, ...paging(q), orderBy: order(q) }),
      prisma.invoice.count({ where })], { isolationLevel: 'RepeatableRead' });
    res.json({ data: rows.map(row => invoiceSummary(row, user.role, today)), meta: meta(q, total) });
  });
  router.get('/invoices/:id', auth.requireUser, validateQuery('/invoices/{id}'), async (req, res) => {
    const row = await prisma.invoice.findFirst({ where: { id: String(req.params.id), subscription: scope(actor(res), {}) }, include: invoiceDetailInclude });
    if (!row) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found.');
    res.json({ data: invoiceDetail(row, actor(res).role, businessDate(now())) });
  });
  for (const path of ['/payments', '/invoices/:id/payments']) {
    router.get(path, auth.requireUser, validateQuery(path.replace(':id', '{id}')), async (req, res) => {
      const q = query(res), user = actor(res), customerScope = scope(user, q);
      if (req.params.id) {
        const invoice = await prisma.invoice.findFirst({ where: { id: String(req.params.id), subscription: customerScope }, select: { id: true } });
        if (!invoice) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found.');
      }
      const where: Prisma.PaymentWhereInput = { invoice: { subscription: customerScope },
        ...(req.params.id || q.invoice_id ? { invoiceId: String(req.params.id ?? q.invoice_id) } : {}),
        ...(q.from || q.to ? { paymentDate: dates(q) } : {}),
        ...(q.q ? { invoice: { subscription: customerScope, number: { contains: String(q.q), mode: 'insensitive' } } } : {}),
      };
      const [rows, total] = await prisma.$transaction([prisma.payment.findMany({ where, include: paymentInclude, ...paging(q), orderBy: order(q, req.params.id ? 'paymentDate' : 'createdAt') }),
        prisma.payment.count({ where })], { isolationLevel: 'RepeatableRead' });
      res.json({ data: rows.map(paymentView), meta: meta(q, total) });
    });
  }
  router.post('/invoices/:id/payments', auth.requireUser, auth.staff, auth.csrf, validateQuery('/invoices/{id}'), validateBody('PaymentInput'),
    async (req, res) => { await recordPayment(prisma, req, res, businessDate(now())); });

  for (const path of ['/reports/overview', '/portal/overview']) {
    router.get(path, auth.requireUser, validateQuery(path), async (_req, res) => {
      const user = actor(res), q = query(res), today = businessDate(now());
      if ((path.startsWith('/reports') && user.role === 'CUSTOMER') || (path.startsWith('/portal') && user.role !== 'CUSTOMER')) throw new HttpError(403, 'FORBIDDEN', 'This report is not available for your role.');
      const from = String(q.from), to = String(q.to);
      if (to > today || (Date.parse(to) - Date.parse(from)) / 86_400_000 >= 366) throw new HttpError(422, 'VALIDATION_ERROR', 'Reports cover at most 366 days and cannot end in the future.');
      const subscriptions: Prisma.SubscriptionWhereInput = { ...scope(user, q), ...(q.plan_id ? { planId: String(q.plan_id) } : {}) };
      const data = await getOverviewReport(prisma, {
        from,
        to,
        asOf: today,
        planId: q.plan_id ? String(q.plan_id) : undefined,
        subscriptionScope: subscriptions,
        customerUserId: user.role === 'CUSTOMER' ? user.id : undefined,
        customerId: user.role !== 'CUSTOMER' && q.customer_id ? String(q.customer_id) : undefined,
      });
      res.json({ data });
    });
  }
  return router;
}
