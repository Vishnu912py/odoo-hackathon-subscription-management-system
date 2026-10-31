import { Router, type RequestHandler } from 'express';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../http/errors.js';
import { validateBody, validateQuery, uuidPattern } from '../../http/validation.js';
import { invalid, mutation, requireVersion, pagination, pageMeta } from '../../http/mutations.js';
import { actor } from '../accounts/routes.js';
import { Decimal, day } from '../projections.js';

// This descriptor adapter is limited to the seven enumerated catalog delegates.
// Input fields come exclusively from the validated shared schemas, never arbitrary Prisma input.
type Row = Record<string, any>;
type Tx = Prisma.TransactionClient;
type Kind = 'customers' | 'products' | 'plans' | 'taxes' | 'payment-terms' | 'quotation-templates' | 'discounts';
const specs = {
  customers: { model: 'customer', schema: 'Customer', fields: ['name', 'company_name', 'billing_email', 'billing_address'], include: {} },
  products: { model: 'product', schema: 'Product', fields: ['name', 'product_type', 'sales_price', 'cost_price', 'notes', 'is_active'], include: { taxes: true, variants: { orderBy: { id: 'asc' } } } },
  plans: { model: 'plan', schema: 'Plan', fields: ['name', 'price', 'currency', 'billing_interval', 'minimum_quantity', 'available_from', 'available_until', 'auto_close', 'allow_early_close', 'allow_pause', 'allow_renewal', 'is_active'], include: { planProducts: { orderBy: { id: 'asc' } } } },
  taxes: { model: 'tax', schema: 'Tax', fields: ['name', 'rate_percent', 'is_active'], include: {} },
  'payment-terms': { model: 'paymentTerm', schema: 'PaymentTerm', fields: ['name', 'due_days', 'is_active'], include: {} },
  'quotation-templates': { model: 'quotationTemplate', schema: 'Template', fields: ['name', 'plan_id', 'validity_days', 'is_active'], include: { lines: { orderBy: { id: 'asc' } } } },
  discounts: { model: 'discountRule', schema: 'Discount', fields: ['name', 'discount_type', 'value', 'currency', 'scope', 'minimum_purchase', 'minimum_quantity', 'valid_from', 'valid_until', 'usage_limit', 'is_active'], include: { discountProducts: true, subscriptionDiscounts: true, _count: { select: { redemptions: true } } } },
} as const;
interface Delegate {
  findMany(args: object): Promise<Row[]>; findUnique(args: object): Promise<Row | null>; count(args: object): Promise<number>;
  updateMany(args: object): Promise<{ count: number }>; update(args: object): Promise<Row>; create(args: object): Promise<Row>;
}
const repository = (tx: Tx, kind: Kind) => tx[specs[kind].model] as unknown as Delegate;
const camel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const dateFields = new Set(['available_from', 'available_until', 'valid_from', 'valid_until']);
const enumFields = new Set(['billing_interval', 'scope', 'discount_type', 'product_type']);
const decimals2 = new Set(['price', 'minimum_purchase']);
const decimals4 = new Set(['sales_price', 'cost_price', 'minimum_quantity', 'rate_percent', 'value']);
export const recordBase = (r: Row) => ({ id: r.id, version: r.version, created_at: r.createdAt.toISOString(), updated_at: r.updatedAt.toISOString() });
function fields(kind: Kind, input: Row) {
  return Object.fromEntries(specs[kind].fields.filter(f => input[f] !== undefined).map(f => [camel(f), input[f] === null ? null : dateFields.has(f) ? new Date(input[f]) : enumFields.has(f) ? input[f].toUpperCase() : input[f]]));
}
function scalarView(kind: Kind, r: Row) {
  return Object.fromEntries(specs[kind].fields.map(f => {
    const v = r[camel(f)];
    return [f, v == null ? null : dateFields.has(f) ? day(v) : enumFields.has(f) ? String(v).toLowerCase() : decimals2.has(f) ? v.toFixed(2) : decimals4.has(f) ? v.toFixed(4) : v];
  }));
}
export function variantView(v: Row) { return { ...recordBase(v), product_id: v.productId, name: v.name, attributes: v.attributes, price_adjustment: v.priceAdjustment.toFixed(4), is_active: v.isActive }; }
function view(kind: Kind, r: Row, role: string): Row {
  const result: Row = { ...recordBase(r), ...scalarView(kind, r) };
  if (kind === 'customers') result.user_id = r.userId;
  if (kind === 'products') {
    if (role !== 'ADMIN') delete result.cost_price;
    result.tax_ids = r.taxes.map((t: Row) => t.taxId).sort();
    result.variants = r.variants.map(variantView);
  }
  if (kind === 'plans') result.products = r.planProducts.map((p: Row) => ({ id: p.id, product_id: p.productId, default_quantity: p.defaultQuantity.toFixed(4), is_addon: p.isAddon, unit_price_override: p.unitPriceOverride?.toFixed(4) ?? null }));
  if (kind === 'quotation-templates') result.lines = r.lines.map((l: Row) => ({ product_id: l.productId, variant_id: l.variantId, quantity: l.quantity.toFixed(4), unit_price: l.unitPrice.toFixed(4) }));
  if (kind === 'discounts') {
    result.currency = r.discountType === 'PERCENTAGE' ? null : r.currency;
    // Legacy nullable starts mean unbounded; expose the earliest ISO calendar date.
    result.valid_from = day(r.validFrom) ?? '0001-01-01';
    result.product_ids = r.discountProducts.map((p: Row) => p.productId).sort();
    result.subscription_ids = r.subscriptionDiscounts.map((p: Row) => p.subscriptionId).sort();
    result.usage_count = r._count.redemptions;
  }
  return result;
}
export async function activeTaxes(tx: Tx, ids: string[]) {
  if (await tx.tax.count({ where: { id: { in: ids }, isActive: true } }) !== ids.length) invalid('Select active, existing tax rules.');
}
export async function selectableProduct(tx: Tx, id: string, variantId?: string | null) {
  const product = await tx.product.findUnique({ where: { id }, include: { taxes: true } });
  if (!product?.isActive) invalid('Select an active product.');
  const variant = variantId ? await tx.productVariant.findFirst({ where: { id: variantId, productId: id, isActive: true } }) : null;
  if (variantId && !variant) invalid('Select an active variant belonging to the product.');
  return { product, variant };
}
function positive(value: string, label: string) { if (!new Decimal(value).gt(0)) invalid(`${label} must be positive.`); }
function dateRange(from: string | null, until: string | null) { if (from && until && until < from) invalid('The end date cannot precede the start date.'); }
async function prepare(tx: Tx, kind: Kind, input: Row, existing: Row | null, now: Date) {
  const merged = { ...(existing ? view(kind, existing, 'ADMIN') : {}), ...input };
  const data: Row = fields(kind, input);
  if (kind === 'products' && input.tax_ids !== undefined) {
    await activeTaxes(tx, input.tax_ids);
    data.taxes = { ...(existing ? { deleteMany: {} } : {}), create: input.tax_ids.map((taxId: string) => ({ taxId })) };
  }
  if (kind === 'taxes' && input.rate_percent !== undefined && new Decimal(input.rate_percent).gt(100)) invalid('Tax rate must not exceed 100%.');
  if (kind === 'plans' && (!existing || Object.keys(input).some(k => k !== 'name' && k !== 'is_active'))) {
    positive(merged.minimum_quantity, 'Minimum quantity'); dateRange(merged.available_from, merged.available_until);
    if (new Set(merged.products.map((p: Row) => p.product_id)).size !== merged.products.length) invalid('Each plan product must appear once.');
    let total = new Decimal(0), quantity = new Decimal(0);
    for (const item of merged.products) {
      positive(item.default_quantity, 'Default quantity');
      const { product } = await selectableProduct(tx, item.product_id);
      if (!item.is_addon) { total = total.plus(new Decimal(item.default_quantity).times(item.unit_price_override ?? product.salesPrice)); quantity = quantity.plus(item.default_quantity); }
    }
    if (quantity.lt(merged.minimum_quantity)) invalid('Included quantities must satisfy the plan minimum.');
    if (!total.toDecimalPlaces(2).eq(merged.price)) invalid('Plan price must equal its included products after rounding; add-ons are excluded.');
    if (input.products !== undefined) data.planProducts = { ...(existing ? { deleteMany: {} } : {}), create: input.products.map((p: Row) => ({ productId: p.product_id, defaultQuantity: p.default_quantity, isAddon: p.is_addon, unitPriceOverride: p.unit_price_override })) };
  }
  if (kind === 'quotation-templates' && (!existing || Object.keys(input).some(k => k !== 'name' && k !== 'is_active'))) {
    const plan = await tx.plan.findUnique({ where: { id: merged.plan_id }, include: { planProducts: true } });
    if (!plan?.isActive) invalid('Select an active plan.');
    let quantity = new Decimal(0);
    for (const line of merged.lines) {
      positive(line.quantity, 'Line quantity'); await selectableProduct(tx, line.product_id, line.variant_id);
      const allowed = plan.planProducts.find(p => p.productId === line.product_id);
      if (!allowed) invalid('Template lines must belong to the selected plan.');
      if (!allowed.isAddon) quantity = quantity.plus(line.quantity);
    }
    if (quantity.lt(plan.minimumQuantity)) invalid('Template quantities do not satisfy the plan minimum.');
    if (input.lines !== undefined) data.lines = { ...(existing ? { deleteMany: {} } : {}), create: input.lines.map((l: Row) => ({ productId: l.product_id, variantId: l.variant_id, quantity: l.quantity, unitPrice: l.unit_price })) };
  }
  if (kind === 'discounts') {
    if (!existing) {
      // Persistence uses INR even for percentage rules; the public contract has no currency for percentages.
      data.currency = 'INR';
      positive(merged.value, 'Discount value'); dateRange(merged.valid_from, merged.valid_until);
      if (merged.minimum_quantity !== null) positive(merged.minimum_quantity, 'Minimum quantity');
      if ((merged.discount_type === 'fixed' && merged.currency !== 'INR') || (merged.discount_type === 'percentage' && (merged.currency !== null || new Decimal(merged.value).gt(100)))) invalid('Fixed discounts require INR; percentages require null currency and a value no greater than 100.');
      const products: string[] = merged.product_ids, subs: string[] = merged.subscription_ids;
      if (merged.scope === 'product' ? !products.length || subs.length : !subs.length || products.length) invalid('Assign targets matching the discount scope.');
      if (await tx.product.count({ where: { id: { in: products }, isActive: true } }) !== products.length || await tx.subscription.count({ where: { id: { in: subs } } }) !== subs.length) invalid('Discount targets must exist and products must be active.');
      data.discountProducts = { create: products.map(productId => ({ productId })) };
      data.subscriptionDiscounts = { create: subs.map(subscriptionId => ({ subscriptionId })) };
      data.activities = { create: { isActive: merged.is_active, effectiveFrom: now } };
    } else if (input.is_active !== undefined && input.is_active !== existing.isActive) {
      if (!await tx.discountRuleActivity.count({ where: { discountRuleId: existing.id } })) {
        await tx.discountRuleActivity.create({ data: { discountRuleId: existing.id, isActive: existing.isActive, effectiveFrom: new Date('0001-01-01'), effectiveUntil: now } });
      }
      await tx.discountRuleActivity.updateMany({ where: { discountRuleId: existing.id, effectiveUntil: null }, data: { effectiveUntil: now } });
      data.activities = { create: { isActive: input.is_active, effectiveFrom: now } };
    }
  }
  return data;
}
export const catalogOperations = Object.keys(specs).flatMap(k => [`get /${k}`, `post /${k}`, `get /${k}/{id}`, `patch /${k}/{id}`]).concat(['post /products/{id}/variants', 'patch /products/{id}/variants/{variant_id}']);
export function catalogRouter(prisma: PrismaClient, auth: { requireUser: RequestHandler; csrf: RequestHandler }, now: () => Date) {
  const router = Router();
  const guard = (kind: Kind, write = false): RequestHandler => (_req, res, next) => {
    const role = actor(res).role;
    if (role === 'CUSTOMER' || ((write && kind !== 'customers') || kind === 'discounts') && role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Your role cannot perform this operation.');
    next();
  };
  for (const name of ['id', 'variant_id']) router.param(name, (_req, _res, next, id: string) => next(uuidPattern.test(id) ? undefined : new HttpError(404, 'NOT_FOUND', 'Record not found.')));
  for (const kind of Object.keys(specs) as Kind[]) {
    const path = `/${kind}`, spec = specs[kind];
    router.get(path, auth.requireUser, guard(kind), validateQuery(path), async (_req, res) => {
      const q = res.locals.query, { page, size, skip, take } = pagination(q);
      const where = { ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}), ...(q.is_active !== undefined ? { isActive: q.is_active } : {}),
        ...(q.billing_interval ? { billingInterval: q.billing_interval.toUpperCase() } : {}), ...(q.scope ? { scope: q.scope.toUpperCase() } : {}), ...(q.plan_id ? { planId: q.plan_id } : {}) };
      const [rows, total] = await prisma.$transaction(async tx => [await repository(tx, kind).findMany({ where, include: spec.include, skip, take, orderBy: [{ createdAt: q.sort_order === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }] }), await repository(tx, kind).count({ where })] as const, { isolationLevel: 'RepeatableRead' });
      res.json({ data: rows.map(r => view(kind, r, actor(res).role)), meta: pageMeta(page, size, total) });
    });
    router.get(`${path}/:id`, auth.requireUser, guard(kind), validateQuery(`${path}/{id}`), async (req, res) => {
      const row = await repository(prisma, kind).findUnique({ where: { id: String(req.params.id) }, include: spec.include });
      if (!row) throw new HttpError(404, 'NOT_FOUND', 'Record not found.');
      res.json({ data: view(kind, row, actor(res).role) });
    });
    for (const method of ['post', 'patch'] as const) router[method](method === 'post' ? path : `${path}/:id`, auth.requireUser, guard(kind, true), auth.csrf, validateBody(`${spec.schema}${method === 'post' ? 'Input' : 'Update'}`), async (req, res) => {
      await mutation(prisma, req, res, method === 'post' ? 201 : 200, method === 'patch', async tx => {
        const repo = repository(tx, kind), id = String(req.params.id ?? '');
        let old: Row | null = null;
        if (method === 'patch') {
          if (!(await repo.updateMany({ where: { id }, data: { version: { increment: 0 } } })).count) throw new HttpError(404, 'NOT_FOUND', 'Record not found.');
          old = await repo.findUnique({ where: { id }, include: spec.include }); requireVersion(req, old!.version);
        }
        const data = await prepare(tx, kind, req.body, old, now());
        const row = old ? await repo.update({ where: { id }, data: { ...data, version: { increment: 1 } }, include: spec.include }) : await repo.create({ data, include: spec.include });
        return view(kind, row, actor(res).role);
      });
    });
  }
  for (const method of ['post', 'patch'] as const) router[method](method === 'post' ? '/products/:id/variants' : '/products/:id/variants/:variant_id', auth.requireUser, guard('products', true), auth.csrf, validateBody(method === 'post' ? 'VariantInput' : 'VariantUpdate'), async (req, res) => {
    await mutation(prisma, req, res, method === 'post' ? 201 : 200, method === 'patch', async tx => {
      const productId = String(req.params.id), id = String(req.params.variant_id ?? '');
      if (!(await tx.product.updateMany({ where: { id: productId, isActive: true }, data: { version: { increment: 1 } } })).count) invalid('Select an active product.');
      if (method === 'patch') {
        const variant = await tx.productVariant.findFirst({ where: { id, productId } });
        if (!variant) throw new HttpError(404, 'NOT_FOUND', 'Variant not found for this product.');
        requireVersion(req, variant.version);
      }
      const data = Object.fromEntries(Object.entries(req.body).map(([k, v]) => [camel(k), v])) as Prisma.ProductVariantUncheckedCreateInput;
      return variantView(method === 'post' ? await tx.productVariant.create({ data: { ...data, productId } }) : await tx.productVariant.update({ where: { id }, data: { ...data, version: { increment: 1 } } }));
    });
  });
  return router;
}
