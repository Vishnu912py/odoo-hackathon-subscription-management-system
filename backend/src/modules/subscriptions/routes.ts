import { randomUUID } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../http/errors.js';
import { validateBody, validateQuery, uuidPattern } from '../../http/validation.js';
import { mutation, invalid, conflict, requireVersion, pagination, pageMeta } from '../../http/mutations.js';
import { actor, type Actor } from '../accounts/routes.js';
import { activeTaxes, selectableProduct } from '../catalog/routes.js';
import { businessDate, day, Decimal, subscriptionDetail, subscriptionInclude, type SubscriptionRow } from '../projections.js';
import { computeNextPeriod } from '../billing/recurrence.js';
import { boundary, validateExpiry } from './calendar.js';

type Tx = Prisma.TransactionClient;
type LineInput = { product_id: string; variant_id: string | null; quantity: string; unit_price?: string; tax_ids?: string[] };
const planInclude = { planProducts: true } satisfies Prisma.PlanInclude;
type Plan = Prisma.PlanGetPayload<{ include: typeof planInclude }>;
const notFound = () => new HttpError(404, 'NOT_FOUND', 'Subscription not found.');
async function owned(tx: Tx, id: string, user: Actor) {
  const r = await tx.subscription.findFirst({ where: { id, ...(user.role === 'CUSTOMER' ? { customer: { userId: user.id } } : {}) }, include: subscriptionInclude });
  if (!r) throw notFound();
  return r;
}
async function planAndTerm(tx: Tx, planId: string, termId: string) {
  const plan = await tx.plan.findUnique({ where: { id: planId }, include: planInclude });
  const term = await tx.paymentTerm.findUnique({ where: { id: termId } });
  if (!plan?.isActive || !term?.isActive) invalid('Select an active plan and payment term.');
  return { plan, term };
}
async function makeLines(tx: Tx, plan: Plan, inputs: LineInput[], start: string) {
  const lines: Prisma.SubscriptionLineUncheckedCreateWithoutSubscriptionInput[] = [];
  let total = new Decimal(0);
  for (const input of inputs) {
    if (!new Decimal(input.quantity).gt(0)) invalid('Line quantity must be positive.');
    const configured = plan.planProducts.find(p => p.productId === input.product_id);
    if (!configured) invalid('Line product must belong to the selected plan.');
    const { product, variant } = await selectableProduct(tx, input.product_id, input.variant_id);
    const price = input.unit_price !== undefined ? new Decimal(input.unit_price) : new Decimal(configured.unitPriceOverride ?? product.salesPrice).plus(variant?.priceAdjustment ?? 0);
    if (price.lt(0) || price.gte('100000000000000') || price.times(input.quantity).gte('10000000000000000')) invalid('Line amounts exceed supported monetary bounds.');
    const taxes = input.tax_ids ?? product.taxes.map(t => t.taxId);
    await activeTaxes(tx, taxes);
    const subtotal = price.times(input.quantity).toDecimalPlaces(2);
    const rules = await tx.tax.findMany({ where: { id: { in: taxes } } });
    total = total.plus(subtotal).plus(rules.reduce((sum, t) => sum.plus(subtotal.times(t.ratePercent).div(100).toDecimalPlaces(2)), new Decimal(0)));
    if (total.gte('10000000000000000')) invalid('Recurring total exceeds supported monetary bounds.');
    lines.push({ productId: product.id, variantId: variant?.id ?? null, description: (variant ? `${product.name} (${variant.name})` : product.name).slice(0, 200),
      quantity: input.quantity, unitPrice: price, effectiveFrom: new Date(start), logicalLineId: randomUUID(), taxes: { create: taxes.map(taxId => ({ taxId })) } });
  }
  return lines;
}
async function validateAgreement(tx: Tx, row: SubscriptionRow) {
  if (!row.startDate || !row.paymentTermId) invalid('A start date and payment term are required.');
  const { plan, term } = await planAndTerm(tx, row.planId, row.paymentTermId);
  const start = day(row.startDate)!;
  validateExpiry(start, day(row.expiryDate), plan.billingInterval, plan.autoClose);
  if ((plan.availableFrom && start < day(plan.availableFrom)!) || (plan.availableUntil && start > day(plan.availableUntil)!)) invalid('Start date is outside plan availability.');
  const inputs = row.lines.map(l => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.quantity.toFixed(4), unit_price: l.unitPrice.toFixed(4), tax_ids: l.taxes.map(t => t.taxId) }));
  await makeLines(tx, plan, inputs, start);
  const quantity = row.lines.filter(l => plan.planProducts.some(p => p.productId === l.productId && !p.isAddon)).reduce((sum, l) => sum.plus(l.quantity), new Decimal(0));
  if (!inputs.length || quantity.lt(plan.minimumQuantity)) invalid('Included line quantities must satisfy the plan minimum before quoting or confirming.');
  return { plan, term };
}
async function event(tx: Tx, id: string, user: Actor, type: string, previous: string | null, next: string, now: Date, details: Prisma.InputJsonObject = {}) {
  await tx.subscriptionEvent.create({ data: { subscriptionId: id, actorUserId: user.id, eventType: type, previousStatus: previous?.toLowerCase() ?? null, newStatus: next.toLowerCase(), occurredAt: now, details } });
}
async function effectiveBoundary(tx: Tx, r: SubscriptionRow, today: string, catchup = true) {
  if (!r.startDate) invalid('Subscription has no recurrence anchor.');
  let effective = boundary(day(r.startDate)!, r.billingInterval, today);
  if (effective === today && await tx.invoice.count({ where: { subscriptionId: r.id, periodStart: new Date(effective) } })) {
    effective = computeNextPeriod({ periodStart: effective, interval: r.billingInterval, anchorDay: r.startDate.getUTCDate(), anchorMonth: r.startDate.getUTCMonth() + 1 }).periodEndStr;
  }
  if (catchup && r.nextBillingDate && day(r.nextBillingDate)! < today) {
    const paused = await tx.subscriptionPauseInterval.findFirst({ where: { subscriptionId: r.id, startDate: { lte: r.nextBillingDate }, OR: [{ endDate: null }, { endDate: { gte: new Date(effective) } }] } });
    if (!paused) conflict('BILLING_CATCHUP_REQUIRED', 'Bill earlier due periods before changing this subscription.');
  }
  return effective;
}
const actions = { quote: 'QuoteInput', confirm: 'EmptyInput', activate: 'EmptyInput', pause: 'ReasonInput', resume: 'EmptyInput', renew: 'RenewInput', close: 'ReasonInput', addons: 'AddonInput' };
export const subscriptionOperations = ['post /subscriptions', 'patch /subscriptions/{id}', 'get /subscriptions/{id}/events', 'get /subscriptions/{id}/available-addons', ...Object.keys(actions).map(a => `post /subscriptions/{id}/${a}`)];
export function subscriptionRouter(prisma: PrismaClient, auth: { requireUser: RequestHandler; staff: RequestHandler; csrf: RequestHandler }, now: () => Date) {
  const router = Router();
  router.param('id', (_req, _res, next, id: string) => next(uuidPattern.test(id) ? undefined : notFound()));
  router.post('/subscriptions', auth.requireUser, auth.staff, auth.csrf, validateBody('SubscriptionInput'), async (req, res) => {
    await mutation(prisma, req, res, 201, false, async tx => {
      const b = req.body, { plan } = await planAndTerm(tx, b.plan_id, b.payment_term_id);
      if (!await tx.customer.findUnique({ where: { id: b.customer_id } })) invalid('Select an existing customer.');
      validateExpiry(b.start_date, b.expiry_date, plan.billingInterval, plan.autoClose);
      const template = b.template_id ? await tx.quotationTemplate.findFirst({ where: { id: b.template_id, planId: plan.id, isActive: true }, include: { lines: true } }) : null;
      if (b.template_id && !template) invalid('Select an active template for this plan.');
      const inputs: LineInput[] = b.lines ?? (template ? template.lines.map(l => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.quantity.toFixed(4), unit_price: l.unitPrice.toFixed(4) })) : plan.planProducts.filter(p => !p.isAddon).map(p => ({ product_id: p.productId, variant_id: null, quantity: p.defaultQuantity.toFixed(4) })));
      const row = await tx.subscription.create({ data: { number: `SUB-${randomUUID()}`, customerId: b.customer_id, planId: plan.id, templateId: template?.id ?? null, paymentTermId: b.payment_term_id,
        currency: plan.currency, billingInterval: plan.billingInterval, startDate: new Date(b.start_date), expiryDate: b.expiry_date ? new Date(b.expiry_date) : null,
        lines: { create: await makeLines(tx, plan, inputs, b.start_date) } }, include: subscriptionInclude });
      await event(tx, row.id, actor(res), 'created', null, row.status, now());
      return subscriptionDetail(row, businessDate(now()), actor(res).role);
    });
  });
  router.patch('/subscriptions/:id', auth.requireUser, auth.staff, auth.csrf, validateBody('SubscriptionUpdate'), async (req, res) => {
    const id = String(req.params.id);
    await mutation(prisma, req, res, 200, true, async tx => {
      await tx.subscription.updateMany({ where: { id }, data: { version: { increment: 0 } } });
      const r = await owned(tx, id, actor(res)); requireVersion(req, r.version);
      if (r.status !== 'DRAFT') conflict('INVALID_TRANSITION', 'Only drafts can be edited.');
      const b = req.body, changingPlan = b.plan_id !== undefined && b.plan_id !== r.planId;
      if (changingPlan && b.lines === undefined) invalid('Changing plan requires replacement lines.');
      const { plan } = await planAndTerm(tx, b.plan_id ?? r.planId, b.payment_term_id ?? r.paymentTermId);
      const start = b.start_date ?? day(r.startDate), expiry = b.expiry_date === undefined ? day(r.expiryDate) : b.expiry_date;
      validateExpiry(start, expiry, plan.billingInterval, plan.autoClose);
      const lines = b.lines === undefined ? undefined : await makeLines(tx, plan, b.lines, start);
      if (lines) await tx.subscriptionLine.deleteMany({ where: { subscriptionId: id } });
      else if (b.start_date) await tx.subscriptionLine.updateMany({ where: { subscriptionId: id }, data: { effectiveFrom: new Date(start) } });
      const row = await tx.subscription.update({ where: { id }, data: { planId: plan.id, paymentTermId: b.payment_term_id ?? r.paymentTermId, currency: plan.currency, billingInterval: plan.billingInterval,
        startDate: new Date(start), expiryDate: expiry ? new Date(expiry) : null, ...(changingPlan ? { templateId: null } : {}), ...(lines ? { lines: { create: lines } } : {}), version: { increment: 1 } }, include: subscriptionInclude });
      await event(tx, id, actor(res), 'updated', r.status, row.status, now());
      return subscriptionDetail(row, businessDate(now()), actor(res).role);
    }, async tx => { await owned(tx, id, actor(res)); });
  });
  for (const [action, schema] of Object.entries(actions)) router.post(`/subscriptions/:id/${action}`, auth.requireUser,
    ...(['quote', 'confirm', 'activate'].includes(action) ? [auth.staff] : []), auth.csrf, validateBody(schema), async (req, res) => {
      const id = String(req.params.id), user = actor(res), today = businessDate(now());
      await mutation(prisma, req, res, 200, true, async tx => {
        await tx.subscription.updateMany({ where: { id }, data: { version: { increment: 0 } } });
        const r = await owned(tx, id, user); requireVersion(req, r.version);
        const data: Prisma.SubscriptionUpdateInput = { version: { increment: 1 } };
        const details: Record<string, Prisma.InputJsonValue> = {};
        if (action === 'quote' || action === 'confirm' || action === 'activate') {
          const expected = { quote: 'DRAFT', confirm: 'QUOTATION', activate: 'CONFIRMED' }[action];
          if (r.status !== expected) conflict('INVALID_TRANSITION', `Cannot ${action} this subscription in its current state.`);
          if (action === 'quote') {
            await validateAgreement(tx, r);
            const template = r.templateId ? await tx.quotationTemplate.findUnique({ where: { id: r.templateId } }) : null;
            const expires = new Date(today); expires.setUTCDate(expires.getUTCDate() + (req.body.validity_days ?? template?.validityDays ?? 7));
            data.status = 'QUOTATION'; data.quotationValidUntil = expires;
          } else if (action === 'confirm') {
            if (!r.quotationValidUntil || day(r.quotationValidUntil)! < today) conflict('QUOTATION_EXPIRED', 'The quotation has expired.');
            const { plan, term } = await validateAgreement(tx, r);
            Object.assign(data, { status: 'CONFIRMED', currency: plan.currency, billingInterval: plan.billingInterval, recurrenceAnchorDay: r.startDate!.getUTCDate(),
              autoCloseSnapshot: plan.autoClose, allowEarlyCloseSnapshot: plan.allowEarlyClose, allowPauseSnapshot: plan.allowPause, allowRenewalSnapshot: plan.allowRenewal, dueDaysSnapshot: term.dueDays });
          } else Object.assign(data, { status: 'ACTIVE', nextBillingDate: r.startDate });
        } else {
          if (r.status !== 'ACTIVE' || r.closeEffectiveDate) conflict('INVALID_TRANSITION', 'This action requires an active subscription without pending closure.');
          const expired = r.expiryDate && day(r.expiryDate)! <= today;
          if (action !== 'renew' && action !== 'close' && expired) conflict('INVALID_TRANSITION', 'The agreement has expired.');
          if (action === 'renew') {
            if (!(r.allowRenewalSnapshot ?? r.plan.allowRenewal) || !r.expiryDate) conflict('POLICY_DENIED', 'This subscription cannot be renewed.');
            const expiry = req.body.new_expiry_date;
            validateExpiry(day(r.startDate)!, expiry, r.billingInterval, r.autoCloseSnapshot ?? r.plan.autoClose);
            if (expiry <= day(r.expiryDate)! || expiry <= today) invalid('New expiry must be later than both the current expiry and today.');
            Object.assign(data, { expiryDate: new Date(expiry), nextBillingDate: r.nextBillingDate ?? r.expiryDate });
          } else {
            const effective = await effectiveBoundary(tx, r, today, action !== 'resume');
            if (effective > '9999-12-31') invalid('Recurrence exceeds supported dates.');
            if (r.expiryDate && effective >= day(r.expiryDate)! && action !== 'close') conflict('INVALID_TRANSITION', 'There is no unstarted period before expiry.');
            details.effective_date = effective;
            if (action === 'pause') {
              if (!(r.allowPauseSnapshot ?? r.plan.allowPause)) conflict('POLICY_DENIED', 'Plan policy does not allow pausing.');
              if (r.pauseEffectiveDate || r.isPaused) conflict('INVALID_TRANSITION', 'Pause is already scheduled or effective.');
              await tx.subscriptionPauseInterval.create({ data: { subscriptionId: id, startDate: new Date(effective), reason: req.body.reason } });
              Object.assign(data, { pauseEffectiveDate: new Date(effective), resumeEffectiveDate: null, isPaused: effective <= today, pausedAt: effective <= today ? new Date(effective) : null });
            } else if (action === 'resume') {
              if (!(r.allowPauseSnapshot ?? r.plan.allowPause) || !r.isPaused || r.resumeEffectiveDate) conflict('INVALID_TRANSITION', 'Resume requires an effective pause without a pending resume.');
              const interval = await tx.subscriptionPauseInterval.findFirst({ where: { subscriptionId: id, endDate: null } });
              if (!interval || effective < day(interval.startDate)!) conflict('INVALID_TRANSITION', 'Resume cannot precede the paused boundary.');
              await tx.subscriptionPauseInterval.update({ where: { id: interval.id }, data: { endDate: new Date(effective) } });
              Object.assign(data, { resumeEffectiveDate: effective > today ? new Date(effective) : null, pauseEffectiveDate: effective > today ? r.pauseEffectiveDate : null,
                isPaused: effective > today, pausedAt: effective > today ? r.pausedAt : null, nextBillingDate: new Date(effective) });
            } else if (action === 'close') {
              if (!(r.allowEarlyCloseSnapshot ?? r.plan.allowEarlyClose)) conflict('POLICY_DENIED', 'Plan policy does not allow early closure.');
              Object.assign(data, { closeEffectiveDate: new Date(effective), ...(effective <= today ? { status: 'CLOSED', closedAt: new Date(effective), isPaused: false, nextBillingDate: null } : {}) });
            } else {
              if (!new Decimal(req.body.quantity).gt(0)) invalid('Add-on quantity must be positive.');
              const { plan } = await planAndTerm(tx, r.planId, r.paymentTermId!);
              if (!plan.planProducts.some(p => p.productId === req.body.product_id && p.isAddon)) invalid('Select an add-on permitted by this plan.');
              const matches = r.lines.filter(l => l.productId === req.body.product_id);
              if (matches.some(l => day(l.effectiveFrom)! > today || l.effectiveUntil && day(l.effectiveUntil)! > today)) conflict('INVALID_TRANSITION', 'This add-on already has a pending change.');
              const live = matches.filter(l => !l.effectiveUntil);
              if (!req.body.enabled && !live.length) conflict('INVALID_TRANSITION', 'This add-on is already disabled.');
              if (live.some(l => day(l.effectiveFrom) === effective)) conflict('INVALID_TRANSITION', 'This add-on was already changed at this boundary.');
              await tx.subscriptionLine.updateMany({ where: { id: { in: live.map(l => l.id) } }, data: { effectiveUntil: new Date(effective) } });
              if (req.body.enabled) {
                const [line] = await makeLines(tx, plan, [req.body], effective);
                await tx.subscriptionLine.create({ data: { ...line!, subscriptionId: id, logicalLineId: live[0]?.logicalLineId ?? randomUUID() } });
              }
              const future = subscriptionDetail(await owned(tx, id, user), effective, user.role);
              if (new Decimal(future.estimated_total).gte('10000000000000000')) invalid('Recurring total exceeds supported monetary bounds.');
            }
          }
        }
        const row = await tx.subscription.update({ where: { id }, data, include: subscriptionInclude });
        await event(tx, id, user, action, r.status, row.status, now(), details);
        return subscriptionDetail(row, today, user.role);
      }, async tx => { await owned(tx, id, user); });
    });
  router.get('/subscriptions/:id/events', auth.requireUser, validateQuery('/subscriptions/{id}/events'), async (req, res) => {
    const id = String(req.params.id); await owned(prisma, id, actor(res));
    const q = res.locals.query, { page, size, skip, take } = pagination(q);
    const where = { subscriptionId: id, ...(q.q ? { eventType: { contains: String(q.q), mode: 'insensitive' as const } } : {}) };
    const [rows, total] = await prisma.$transaction([prisma.subscriptionEvent.findMany({ where, skip, take, orderBy: [{ occurredAt: q.sort_order === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }] }), prisma.subscriptionEvent.count({ where })], { isolationLevel: 'RepeatableRead' });
    res.json({ data: rows.map(e => ({ id: e.id, subscription_id: id, actor_user_id: e.actorUserId, event_type: e.eventType, previous_status: e.previousStatus?.toLowerCase() ?? null,
      new_status: e.newStatus?.toLowerCase() ?? null, occurred_at: e.occurredAt.toISOString(), summary: `Subscription ${e.eventType.replaceAll('_', ' ')}`.slice(0, 200) })), meta: pageMeta(page, size, total) });
  });
  router.get('/subscriptions/:id/available-addons', auth.requireUser, validateQuery('/subscriptions/{id}/available-addons'), async (req, res) => {
    const r = await owned(prisma, String(req.params.id), actor(res)), today = businessDate(now());
    const products = await prisma.planProduct.findMany({ where: { planId: r.planId, isAddon: true, product: { isActive: true } }, include: { product: { include: { variants: { where: { isActive: true }, orderBy: { id: 'asc' } } } } }, orderBy: { id: 'asc' } });
    res.json({ data: products.map(p => {
      const lines = r.lines.filter(l => l.productId === p.productId && day(l.effectiveFrom)! <= today && (!l.effectiveUntil || day(l.effectiveUntil)! > today));
      return { product_id: p.productId, name: p.product.name, unit_price: (p.unitPriceOverride ?? p.product.salesPrice).toFixed(4),
        variants: p.product.variants.map(v => ({ id: v.id, name: v.name, price_adjustment: v.priceAdjustment.toFixed(4) })), enabled: !!lines.length,
        quantity: lines.reduce((sum, l) => sum.plus(l.quantity), new Decimal(0)).toFixed(4) };
    }) });
  });
  return router;
}
