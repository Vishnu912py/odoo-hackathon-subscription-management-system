import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import pg from 'pg';
import request from 'supertest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createDatabase } from '../../src/db/client.js';
import { createApp } from '../../src/app.js';
import { loadContract } from '../../src/contracts.js';
import { boundary, validateExpiry } from '../../src/modules/subscriptions/calendar.js';
import { createSubscriptionInvoice } from '../../src/modules/billing/invoice-persistence.js';
import { initializeBillingRun, executeBillingRun } from '../../src/modules/billing/billing-run-persistence.js';
import { deliverInvoices, processBilling } from '../../src/modules/billing/worker.js';
import { gmailTransport, type AuthMessage } from '../../src/modules/accounts/mail.js';
import { loadConfig } from '../../src/config.js';
import { invoicePdf } from '../../src/modules/billing/pdf.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { browserAcceptance } from '../browser/acceptance.js';

const origin = process.env.BROWSER_ORIGIN ?? 'http://localhost:5173';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const validator = new Ajv2020({ strict: false, allErrors: true });
createRequire(import.meta.url)('ajv-formats')(validator);
validator.addSchema({ $id: 'contract', components: (loadContract() as unknown as { components: object }).components });
function contract(name: string, body: unknown) {
  const validate = validator.compile({ $ref: `contract#/components/schemas/${name}` });
  assert.ok(validate(body), JSON.stringify(validate.errors));
}
test('V3 original recurrence boundaries', () => {
  assert.equal(boundary('2026-01-31', 'MONTHLY', '2026-02-01'), '2026-02-28');
  assert.equal(boundary('2026-01-31', 'MONTHLY', '2026-03-01'), '2026-03-31');
  assert.equal(boundary('2024-02-29', 'YEARLY', '2028-02-01'), '2028-02-29');
  assert.equal(boundary('2026-10-31', 'WEEKLY', '2026-11-01'), '2026-11-07');
  assert.equal(boundary('2026-10-31', 'DAILY', '2026-11-01'), '2026-11-01');
  assert.throws(() => validateExpiry('2026-01-31', '2026-03-30', 'MONTHLY', false));
  assert.throws(() => validateExpiry('2026-01-31', null, 'MONTHLY', true));
});

test('V3 catalog and lifecycle through HTTP with real isolated PostgreSQL', { timeout: 180_000 }, async t => {
  assert.ok(process.env.DATABASE_URL);
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname));
  const schema = `v3_test_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  const connection = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await connection.connect(); await connection.query(`CREATE SCHEMA "${schema}"`);
  const database = createDatabase(url.toString()), prisma = database.prisma!;
  const backend = fileURLToPath(new URL('../../', import.meta.url));
  const env = { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), NODE_ENV: 'test', ALLOW_DEV_SEED: 'true', DEMO_PASSWORD: 'BrightloopDemo!2026' };
  const run = (script: string, args: string[]) => execFileSync(process.execPath, [script, ...args], { cwd: backend, env, windowsHide: true, stdio: 'pipe', timeout: 40_000 });
  try {
    run('node_modules/prisma/build/index.js', ['migrate', 'deploy']);
    run('node_modules/tsx/dist/cli.mjs', ['prisma/seed.ts']);
    let today = '2026-10-31';
    const config = { nodeEnv: 'test' as const, host: '127.0.0.1', port: 3000, frontendOrigin: origin, databaseUrl: url.toString(),
      mail: { clientId: 'test', clientSecret: 'test', refreshToken: 'test', sender: 'test@example.test', encryptionKey: 'a'.repeat(64) } };
    const authMessages: AuthMessage[] = [];
    const realRecipient = process.env.REAL_EMAIL_TEST_TO;
    const transport = async (message: AuthMessage) => {
      authMessages.push(message);
      if (realRecipient && message.to === realRecipient) await gmailTransport(loadConfig())({ ...message,
        subject: `[Acceptance test] ${message.subject}`, text: `This is an authorized Brightloop test. The synthetic account and links are removed after verification; no action or payment is needed.\n\n${message.text}` });
    };
    const app = createApp(config, { database, now: () => new Date(today + 'T12:00:00Z'), mailTransport: transport });
    async function login(email: string) {
      const agent = request.agent(app), csrf = await agent.get('/api/v1/auth/csrf').expect(200);
      const result = await agent.post('/api/v1/auth/login').set('Origin', origin).set('X-CSRF-Token', csrf.body.data.csrf_token).send({ email, password: 'BrightloopDemo!2026' }).expect(200);
      return { agent, token: result.body.data.csrf_token as string };
    }
    const admin = await login('admin@brightloop.io'), staff = await login('staff@brightloop.io'), customer = await login('billing@acmestudio.com');
    const write = (who: typeof admin, method: 'post' | 'patch', path: string, body: object, version?: number, key = randomUUID()) => {
      const req = who.agent[method]('/api/v1' + path).set('Origin', origin).set('X-CSRF-Token', who.token).set('Idempotency-Key', key);
      if (version !== undefined) req.set('If-Match', `"${version}"`);
      return req.send(body);
    };
    const create = async (path: string, body: object, name: string) => {
      const response = await write(admin, 'post', path, body).expect(201); contract(name + 'Response', response.body); return response.body.data;
    };
    let product: any, plan: any, template: any, term: any, addon: any, variant: any;
    await t.test('catalog CRUD, response contracts, role redaction, versions and replay', async () => {
      const tax = await create('/taxes', { name: 'GST 18', rate_percent: '18.0000', is_active: true }, 'Tax');
      term = await create('/payment-terms', { name: 'Net 14', due_days: 14, is_active: true }, 'PaymentTerm');
      product = await create('/products', { name: 'V3 Base', product_type: 'service', sales_price: '100.0000', cost_price: '25.0000', tax_ids: [tax.id] }, 'Product');
      addon = await create('/products', { name: 'V3 Add-on', product_type: 'service', sales_price: '20.0000', cost_price: '2.0000', tax_ids: [] }, 'Product');
      variant = await create(`/products/${product.id}/variants`, { name: 'Premium', attributes: { tier: 'premium' }, price_adjustment: '10.0000' }, 'Variant');
      const pv = (await write(admin, 'patch', `/products/${product.id}/variants/${variant.id}`, { name: 'Premium updated' }, variant.version).expect(200)).body.data;
      contract('VariantResponse', { data: pv });
      await write(admin, 'patch', `/products/${addon.id}/variants/${variant.id}`, { name: 'Wrong parent' }, pv.version).expect(404);
      plan = await create('/plans', { name: 'V3 Monthly', price: '100.00', currency: 'INR', billing_interval: 'monthly', minimum_quantity: '1.0000', available_from: null, available_until: null,
        auto_close: false, allow_early_close: true, allow_pause: true, allow_renewal: true, is_active: true,
        products: [{ product_id: product.id, default_quantity: '1.0000', is_addon: false, unit_price_override: null }, { product_id: addon.id, default_quantity: '1.0000', is_addon: true, unit_price_override: null }] }, 'Plan');
      template = await create('/quotation-templates', { name: 'V3 Template', plan_id: plan.id, validity_days: 5, is_active: true, lines: [{ product_id: product.id, variant_id: variant.id, quantity: '1.0000', unit_price: '111.0000' }] }, 'Template');
      const discount = await create('/discounts', { name: 'V3 percentage', discount_type: 'percentage', value: '5.0000', currency: null, scope: 'product', product_ids: [product.id], subscription_ids: [], minimum_purchase: null, minimum_quantity: null, valid_from: today, valid_until: null, usage_limit: 10, is_active: true }, 'Discount');
      const archived = await write(admin, 'patch', '/discounts/' + discount.id, { is_active: false }, 1).expect(200); contract('DiscountResponse', archived.body);
      assert.equal(await prisma.discountRuleActivity.count({ where: { discountRuleId: discount.id } }), 2);
      await write(admin, 'patch', '/discounts/' + discount.id, { value: '10.0000' }, 2).expect(422);
      await write(admin, 'patch', '/taxes/' + tax.id, { rate_percent: '20.0000' }, 1).expect(422);
      await write(admin, 'patch', '/payment-terms/' + term.id, { due_days: 30 }, 1).expect(422);
      const createdCustomer = await write(staff, 'post', '/customers', { name: 'Manual Customer', billing_email: 'billing@acmestudio.com' }).expect(201);
      contract('CustomerResponse', createdCustomer.body); assert.equal(createdCustomer.body.data.user_id, null);
      const customerKey = randomUUID(), path = '/customers/' + createdCustomer.body.data.id;
      const edited = await write(staff, 'patch', path, { name: 'Updated customer' }, 1, customerKey).expect(200);
      const replay = await write(staff, 'patch', path, { name: 'Updated customer' }, 1, customerKey).expect(200); assert.deepEqual(replay.body, edited.body);
      await write(staff, 'patch', path, { name: 'Different' }, 1, customerKey).expect(409);
      await write(staff, 'patch', path, { name: 'Stale' }, 1).expect(412);
      await write(staff, 'patch', path, { name: 'Missing precondition' }).expect(428);
      for (const [resource, name] of [['customers', 'Customer'], ['products', 'Product'], ['plans', 'Plan'], ['taxes', 'Tax'], ['payment-terms', 'PaymentTerm'], ['quotation-templates', 'Template'], ['discounts', 'Discount']]) {
        const list = await admin.agent.get('/api/v1/' + resource).expect(200); contract(name + 'ListResponse', list.body);
        contract(name + 'Response', (await admin.agent.get('/api/v1/' + resource + '/' + list.body.data[0].id).expect(200)).body);
        await customer.agent.get('/api/v1/' + resource).expect(403);
      }
      const staffProduct = await staff.agent.get('/api/v1/products/' + product.id).expect(200);
      assert.equal(staffProduct.body.data.cost_price, undefined);
      await staff.agent.get('/api/v1/discounts').expect(403);
      await write(staff, 'post', '/products', {}).expect(403);
      await write(admin, 'post', '/taxes', { name: 'Too much', rate_percent: '101.0000', is_active: true }).expect(422);
      await admin.agent.get('/api/v1/products?unexpected=true').expect(400);
      const version = (await admin.agent.get('/api/v1/products/' + product.id)).body.data.version;
      const races = await Promise.all([write(admin, 'patch', '/products/' + product.id, { notes: 'One' }, version), write(admin, 'patch', '/products/' + product.id, { notes: 'Two' }, version)]);
      assert.deepEqual(races.map(r => r.status).sort(), [200, 412]);
    });
    const input = (overrides = {}) => ({ customer_id: id(10), plan_id: plan.id, payment_term_id: term.id, start_date: today, expiry_date: '2027-10-31', ...overrides });
    const sub = async (overrides = {}) => create('/subscriptions', input(overrides), 'Subscription');
    const action = async (row: any, name: string, body = {}, who = staff) => {
      const result = await write(who, 'post', `/subscriptions/${row.id}/${name}`, body, row.version).expect(200);
      contract('SubscriptionResponse', result.body); return result.body.data;
    };
    const active = async (overrides = {}) => action(await action(await action(await sub(overrides), 'quote'), 'confirm'), 'activate');
    let agreement: any;
    await t.test('draft authoring, final variant prices, validation and snapshots', async () => {
      await write(customer, 'post', '/subscriptions', input()).expect(403);
      await write(staff, 'post', '/subscriptions', input({ expiry_date: '2027-10-30' })).expect(422);
      let incomplete = await sub({ lines: [] });
      await write(staff, 'post', `/subscriptions/${incomplete.id}/quote`, {}, incomplete.version).expect(422);
      incomplete = (await write(staff, 'patch', '/subscriptions/' + incomplete.id, { lines: [{ product_id: product.id, variant_id: variant.id, quantity: '2.0000' }] }, incomplete.version).expect(200)).body.data;
      assert.equal(incomplete.lines[0].unit_price, '110.0000'); assert.equal(incomplete.estimated_total, '259.60');
      let templated = await sub({ template_id: template.id }); assert.equal(templated.lines[0].unit_price, '111.0000');
      templated = await action(templated, 'quote'); assert.equal(templated.quotation_valid_until, '2026-11-05');
      agreement = await action(templated, 'confirm');
      assert.equal(agreement.payment_due_days, 14);
      await write(admin, 'patch', '/plans/' + plan.id, { allow_pause: false }, plan.version).expect(200);
      agreement = await action(agreement, 'activate'); assert.equal(agreement.next_billing_date, today);
      assert.equal(agreement.policy_snapshot.allow_pause, true); assert.equal(agreement.capabilities.can_pause, true);
      assert.equal(await prisma.invoice.count({ where: { subscriptionId: agreement.id } }), 0);
      await write(staff, 'patch', '/subscriptions/' + agreement.id, { start_date: today }, agreement.version).expect(409);
      await write(staff, 'post', `/subscriptions/${agreement.id}/confirm`, {}, agreement.version).expect(409);
      const events = await customer.agent.get(`/api/v1/subscriptions/${agreement.id}/events`).expect(200); contract('EventListResponse', events.body);
      assert.equal(events.body.data.length, 4); assert.equal(events.body.data[0].details, undefined);
      await write(admin, 'patch', '/plans/' + plan.id, { allow_pause: true }, plan.version + 1).expect(200);
      const manual = await prisma.customer.create({ data: { name: 'Another', billingEmail: 'another@example.test' } });
      const other = await sub({ customer_id: manual.id });
      for (const suffix of ['', '/events', '/available-addons']) await customer.agent.get(`/api/v1/subscriptions/${other.id}${suffix}`).expect(404);
      await write(customer, 'post', `/subscriptions/${other.id}/pause`, { reason: 'No' }, other.version).expect(404);
    });
    await t.test('catch-up rejection, scheduled pause/resume and original month-end anchor', async () => {
      today = '2026-11-01';
      const rejected = await write(customer, 'post', `/subscriptions/${agreement.id}/pause`, { reason: 'Holiday' }, agreement.version).expect(409);
      assert.equal(rejected.body.error.code, 'BILLING_CATCHUP_REQUIRED');
      await createSubscriptionInvoice(prisma, { subscriptionId: agreement.id, periodStart: '2026-10-31', periodEnd: '2026-11-30', advanceSchedule: true });
      agreement = await action(agreement, 'pause', { reason: 'Holiday' }, customer);
      assert.equal(agreement.pause_effective_date, '2026-11-30'); assert.equal(agreement.is_paused, false);
      await write(customer, 'post', `/subscriptions/${agreement.id}/pause`, { reason: 'Again' }, agreement.version).expect(409);
      today = '2026-11-30';
      agreement = (await customer.agent.get('/api/v1/subscriptions/' + agreement.id).expect(200)).body.data;
      assert.equal(agreement.is_paused, true);
      today = '2026-12-01';
      agreement = await action(agreement, 'resume', {}, customer);
      assert.equal(agreement.resume_effective_date, '2026-12-31'); assert.equal(agreement.is_paused, true);
      assert.equal(agreement.next_billing_date, '2026-12-31');
      today = '2026-12-31';
      agreement = (await customer.agent.get('/api/v1/subscriptions/' + agreement.id).expect(200)).body.data;
      assert.equal(agreement.is_paused, false); assert.equal(agreement.pause_effective_date, null);
      const interval = await prisma.subscriptionPauseInterval.findFirstOrThrow({ where: { subscriptionId: agreement.id } });
      assert.equal(interval.startDate.toISOString().slice(0, 10), '2026-11-30'); assert.equal(interval.endDate!.toISOString().slice(0, 10), '2026-12-31');
    });
    await t.test('versioned add-ons, policy refusal, renew and close at a boundary', async () => {
      today = '2026-10-31';
      let r = await active();
      const available = await customer.agent.get(`/api/v1/subscriptions/${r.id}/available-addons`).expect(200);
      contract('AddonOptionResponse', { data: available.body.data[0] }); assert.equal(available.body.data[0].enabled, false);
      r = await action(r, 'addons', { product_id: addon.id, variant_id: null, quantity: '2.0000', enabled: true }, customer);
      assert.equal(r.recurring_subtotal, '140.00');
      await write(customer, 'post', `/subscriptions/${r.id}/addons`, { product_id: product.id, variant_id: null, quantity: '1.0000', enabled: true }, r.version).expect(422);
      await createSubscriptionInvoice(prisma, { subscriptionId: r.id, periodStart: today, periodEnd: '2026-11-30', advanceSchedule: true });
      today = '2026-11-01';
      r = await action(r, 'addons', { product_id: addon.id, variant_id: null, quantity: '1.0000', enabled: false }, customer);
      assert.equal(r.recurring_subtotal, '140.00');
      await write(customer, 'post', `/subscriptions/${r.id}/addons`, { product_id: addon.id, variant_id: null, quantity: '3.0000', enabled: true }, r.version).expect(409);
      r = await action(r, 'renew', { new_expiry_date: '2028-10-31' }, customer); assert.equal(r.expiry_date, '2028-10-31');
      r = await action(r, 'close', { reason: 'Finished' }, customer); assert.equal(r.status, 'active'); assert.equal(r.close_effective_date, '2026-11-30');
      today = '2026-11-30'; r = (await customer.agent.get('/api/v1/subscriptions/' + r.id).expect(200)).body.data;
      assert.equal(r.status, 'closed'); assert.equal(r.next_billing_date, null);
      await write(customer, 'post', `/subscriptions/${r.id}/renew`, { new_expiry_date: '2029-10-31' }, r.version).expect(409);
      today = '2026-10-31';
      const p = (await admin.agent.get('/api/v1/plans/' + plan.id)).body.data;
      await write(admin, 'patch', '/plans/' + plan.id, { allow_pause: false }, p.version).expect(200);
      const denied = await active(); await write(customer, 'post', `/subscriptions/${denied.id}/pause`, { reason: 'No' }, denied.version).expect(409);
      await write(admin, 'patch', '/plans/' + plan.id, { allow_pause: true }, p.version + 1).expect(200);
    });
    await t.test('expiry materializes while historical debt remains recoverable', async () => {
      today = '2026-10-31';
      const p = (await admin.agent.get('/api/v1/plans/' + plan.id)).body.data;
      await write(admin, 'patch', '/plans/' + plan.id, { auto_close: true }, p.version).expect(200);
      let r = await active({ expiry_date: '2026-11-30' });
      today = '2026-11-30'; r = (await admin.agent.get('/api/v1/subscriptions/' + r.id).expect(200)).body.data;
      assert.equal(r.status, 'closed'); assert.equal(r.next_billing_date, '2026-10-31');
      const run = await initializeBillingRun(prisma, { asOfDate: today, subscriptionIdFilter: r.id });
      const result = await executeBillingRun(prisma, run.id, { connectionString: url.toString() });
      assert.equal(result.generatedCount, 1); assert.equal(result.failedCount, 0); assert.equal(result.hasMore, false);
      assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: r.id } })).nextBillingDate, null);
      await assert.rejects(createSubscriptionInvoice(prisma, { subscriptionId: r.id, periodStart: '2026-11-30', periodEnd: '2026-12-31' }));
      assert.equal(await prisma.invoice.count({ where: { subscriptionId: r.id } }), 1);
    });
    await t.test('integrated billing, draft confirmation, delivery, PDF, payment and cancellation', async () => {
      today = '2026-10-31';
      const subscription = await active();
      const body = { as_of: today, limit: 100, subscription_id: subscription.id }, key = randomUUID();
      await write(customer, 'post', '/billing-runs', body).expect(403);
      await write(staff, 'post', '/billing-runs', body).expect(403);
      await write(admin, 'post', '/billing-runs', { ...body, as_of: '2026-11-01' }).expect(422);
      const queued = await write(admin, 'post', '/billing-runs', body, undefined, key).expect(202);
      contract('BillingRunResponse', queued.body);
      assert.deepEqual((await write(admin, 'post', '/billing-runs', body, undefined, key).expect(202)).body, queued.body);
      await executeBillingRun(prisma, queued.body.data.id, { connectionString: url.toString() });
      const run = await admin.agent.get('/api/v1/billing-runs/' + queued.body.data.id).expect(200);
      contract('BillingRunResponse', run.body); assert.equal(run.body.data.created_count, 1);
      contract('BillingRunListResponse', (await admin.agent.get('/api/v1/billing-runs').expect(200)).body);
      await staff.agent.get('/api/v1/billing-runs').expect(403);
      await write(admin, 'post', `/billing-runs/${queued.body.data.id}/retry`, {}).expect(409);
      const list = await admin.agent.get('/api/v1/invoices').query({ subscription_id: subscription.id }).expect(200);
      let invoice = list.body.data[0]; assert.equal(invoice.status, 'draft'); assert.equal(invoice.issue_date, today); assert.equal(invoice.due_date, '2026-11-14');
      await write(customer, 'post', `/invoices/${invoice.id}/confirm`, {}, invoice.version).expect(403);
      await write(staff, 'post', `/invoices/${invoice.id}/payments`, { amount: invoice.total, method: 'cash', payment_date: today, note: null }, invoice.version).expect(409);
      const confirmKey = randomUUID(), initialVersion = invoice.version;
      const confirmed = await write(staff, 'post', `/invoices/${invoice.id}/confirm`, {}, initialVersion, confirmKey).expect(200);
      contract('InvoiceResponse', confirmed.body); invoice = confirmed.body.data;
      assert.deepEqual((await write(staff, 'post', `/invoices/${invoice.id}/confirm`, {}, initialVersion, confirmKey).expect(200)).body, confirmed.body);
      const pdf = await customer.agent.get(`/api/v1/invoices/${invoice.id}/pdf`).expect(200).expect('Content-Type', /application\/pdf/);
      assert.ok(Buffer.isBuffer(pdf.body)); assert.equal(pdf.body.subarray(0, 4).toString(), '%PDF');
      mkdirSync(new URL('../../../tmp/pdfs/', import.meta.url), { recursive: true });
      writeFileSync(new URL('../../../tmp/pdfs/invoice-verification.pdf', import.meta.url), pdf.body);
      writeFileSync(new URL('../../../tmp/pdfs/invoice-multilingual.pdf', import.meta.url), await invoicePdf({ ...invoice,
        customer_name: 'Brightloop ग्राहक മലയാളം தமிழ் తెలుగు ಕನ್ನಡ বাংলা ગુજરાતી ਪੰਜਾਬੀ ଓଡ଼ିଆ',
        billing_address: 'भारत · കേരളം · சென்னை\nExample customer address',
        lines: invoice.lines.map((line: any) => ({ ...line, description: 'Monthly service सेवा സേവനം சேவை సేవ ಸೇವೆ সেবা સેવા ਸੇਵਾ ସେବା' })) }));
      const sendKey = randomUUID();
      const sent = await write(staff, 'post', `/invoices/${invoice.id}/send`, {}, invoice.version, sendKey).expect(202); contract('SendResultResponse', sent.body);
      await write(staff, 'post', `/invoices/${invoice.id}/send`, {}, invoice.version, sendKey).expect(202);
      assert.equal(await prisma.invoiceEmailOutbox.count({ where: { invoiceId: invoice.id } }), 1);
      await deliverInvoices(prisma, config, async () => { throw new Error('Injected provider failure'); });
      assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).sentAt, null);
      const deliveries = await staff.agent.get(`/api/v1/invoices/${invoice.id}/deliveries`).expect(200);
      contract('InvoiceDeliveryListResponse', deliveries.body); assert.equal(deliveries.body.data[0].status, 'failed');
      await customer.agent.get(`/api/v1/invoices/${invoice.id}/deliveries`).expect(403);
      const retryKey = randomUUID(), retryPath = `/invoices/${invoice.id}/deliveries/${sent.body.data.delivery_id}/retry`;
      const retried = await write(staff, 'post', retryPath, {}, undefined, retryKey).expect(202); contract('InvoiceDeliveryResponse', retried.body);
      assert.deepEqual((await write(staff, 'post', retryPath, {}, undefined, retryKey).expect(202)).body, retried.body);
      const messages: string[] = [];
      await deliverInvoices(prisma, config, async message => { messages.push(message.text); });
      await deliverInvoices(prisma, config, async message => { messages.push(message.text); });
      assert.equal(messages.length, 1); assert.ok(messages[0]!.includes(invoice.total));
      invoice = (await staff.agent.get('/api/v1/invoices/' + invoice.id).expect(200)).body.data;
      assert.ok(invoice.sent_at);
      const receipt = await write(staff, 'post', `/invoices/${invoice.id}/payments`, { amount: invoice.total, method: 'cash', payment_date: today, note: 'Integrated receipt' }, invoice.version).expect(201);
      assert.equal(receipt.body.data.invoice.status, 'paid');
      await write(staff, 'post', `/invoices/${invoice.id}/cancel`, { reason: 'Paid cannot cancel' }, receipt.body.data.invoice.version).expect(409);
      const otherCustomer = await prisma.customer.create({ data: { name: 'Private', billingEmail: 'private@example.test' } });
      const privateSub = await active({ customer_id: otherCustomer.id });
      const privateInvoice = await createSubscriptionInvoice(prisma, { subscriptionId: privateSub.id, periodStart: today, periodEnd: '2026-11-30', initialStatus: 'DRAFT', advanceSchedule: true });
      await customer.agent.get(`/api/v1/invoices/${privateInvoice.invoice.id}/pdf`).expect(404);
      const cancelled = await write(staff, 'post', `/invoices/${privateInvoice.invoice.id}/cancel`, { reason: 'Duplicate agreement' }, 1).expect(200);
      assert.equal(cancelled.body.data.balance_due, '0.00');
      const retry = await createSubscriptionInvoice(prisma, { subscriptionId: privateSub.id, periodStart: today, periodEnd: '2026-11-30' });
      assert.equal(retry.isReused, true); assert.equal(retry.invoice.status, 'CANCELLED');
    });
    await t.test('verified customer invitation, single use and owned plans', async () => {
      const profile = await create('/customers', { name: 'Invited customer', billing_email: 'invited@example.test' }, 'Customer');
      await write(customer, 'post', `/customers/${profile.id}/invite`, {}, profile.version).expect(403);
      const key = randomUUID();
      await write(staff, 'post', `/customers/${profile.id}/invite`, {}, profile.version, key).expect(202);
      await write(staff, 'post', `/customers/${profile.id}/invite`, {}, profile.version, key).expect(202);
      assert.equal(await prisma.customerPortalInvitation.count({ where: { customerId: profile.id } }), 1);
      const message = authMessages.find(message => message.to === 'invited@example.test')!;
      const token = /#invite=([a-f0-9]{64})/.exec(message.text)![1]!;
      const anonymous = request.agent(app), csrf = (await anonymous.get('/api/v1/auth/csrf')).body.data.csrf_token;
      const accept = () => anonymous.post('/api/v1/auth/accept-customer-invitation').set('Origin', origin).set('X-CSRF-Token', csrf).send({ token, password: 'BrightloopDemo!2026' });
      await accept().expect(200); await accept().expect(422);
      const invited = await login('invited@example.test');
      assert.equal((await prisma.customer.findUniqueOrThrow({ where: { id: profile.id } })).userId, (await invited.agent.get('/api/v1/auth/me')).body.data.user.id);
      contract('PlanOptionListResponse', (await invited.agent.get('/api/v1/portal/plans').expect(200)).body);
      assert.equal((await invited.agent.get('/api/v1/invoices')).body.meta.total, 0);
      await write(staff, 'post', `/customers/${profile.id}/invite`, {}, profile.version + 1).expect(409);
    });
    await t.test('failed billing finishes, retains its cursor, and retries once after repair', async () => {
      const sub = await active();
      await prisma.subscriptionLine.updateMany({ where: { subscriptionId: sub.id }, data: { effectiveFrom: new Date('2026-11-01') } });
      const queued = (await write(admin, 'post', '/billing-runs', { as_of: today, subscription_id: sub.id, limit: 10 }).expect(202)).body.data;
      await executeBillingRun(prisma, queued.id, { connectionString: url.toString() });
      const failed = (await admin.agent.get(`/api/v1/billing-runs/${queued.id}`).expect(200)).body.data;
      assert.equal(failed.status, 'failed'); assert.equal(failed.has_more, false); assert.equal(failed.next_run_required, true);
      assert.equal(await prisma.invoice.count({ where: { subscriptionId: sub.id } }), 0);
      assert.equal((await prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } })).nextBillingDate!.toISOString().slice(0, 10), today);
      await prisma.subscriptionLine.updateMany({ where: { subscriptionId: sub.id }, data: { effectiveFrom: new Date(today) } });
      const key = randomUUID(), path = `/billing-runs/${queued.id}/retry`;
      const retried = await write(admin, 'post', path, {}, undefined, key).expect(202);
      assert.deepEqual((await write(admin, 'post', path, {}, undefined, key).expect(202)).body, retried.body);
      await Promise.allSettled([executeBillingRun(prisma, retried.body.data.id, { connectionString: url.toString() }), executeBillingRun(prisma, retried.body.data.id, { connectionString: url.toString() })]);
      assert.equal(await prisma.invoice.count({ where: { subscriptionId: sub.id } }), 1);
    });
    await t.test('automatic billing picks up subscriptions activated after the daily pass', async () => {
      await processBilling(prisma, config, new Date(today + 'T12:00:00Z'));
      const late = await active();
      await processBilling(prisma, config, new Date(today + 'T13:00:00Z'));
      assert.equal(await prisma.invoice.count({ where: { subscriptionId: late.id } }), 1);
    });
    if (realRecipient) await t.test('authorized real invitation, password reset and invoice emails', async () => {
      const profile = await create('/customers', { name: 'Authorized email acceptance test', billing_email: realRecipient }, 'Customer');
      await write(staff, 'post', `/customers/${profile.id}/invite`, {}, profile.version).expect(202);
      const invitation = authMessages.find(message => message.to === realRecipient && message.subject.includes('invitation'))!;
      assert.ok(invitation);
      assert.equal(await prisma.authEmailJob.count({ where: { sentAt: null, encryptedMessage: { not: null } } }), 0, 'Provider must accept invitation');
      const anonymous = request.agent(app), csrf = (await anonymous.get('/api/v1/auth/csrf')).body.data.csrf_token;
      const post = (path: string, body: object) => anonymous.post(`/api/v1/auth/${path}`).set('Origin', origin).set('X-CSRF-Token', csrf).send(body);
      await post('accept-customer-invitation', { token: /#invite=([a-f0-9]{64})/.exec(invitation.text)![1], password: 'BrightloopDemo!2026' }).expect(200);
      await post('forgot-password', { email: realRecipient }).expect(202);
      const reset = authMessages.find(message => message.to === realRecipient && message.subject.includes('Reset'))!;
      assert.ok(reset);
      assert.equal(await prisma.authEmailJob.count({ where: { sentAt: null, encryptedMessage: { not: null } } }), 0, 'Provider must accept reset');
      await post('reset-password', { token: /#reset=([a-f0-9]{64})/.exec(reset.text)![1], password: 'BrightloopVerified!2026' }).expect(200);
      const sub = await active({ customer_id: profile.id });
      const result = await createSubscriptionInvoice(prisma, { subscriptionId: sub.id, periodStart: today, periodEnd: '2026-11-30' });
      const queued = await write(staff, 'post', `/invoices/${result.invoice.id}/send`, {}, result.invoice.version).expect(202);
      await deliverInvoices(prisma, config, transport);
      const delivered = await prisma.invoiceEmailOutbox.findUniqueOrThrow({ where: { id: queued.body.data.delivery_id } });
      assert.equal(delivered.status, 'SENT', 'Provider must accept invoice');
      console.info('Gmail accepted all three authorized test messages. Invitation and reset tokens worked and synthetic records are removed.');
    });
    if (process.env.E2E_PLAYWRIGHT_MODULE) await t.test('rendered browser journey and 5000-record page timings', { timeout: 180_000 }, async () => { await browserAcceptance(app, prisma, config); });
  } finally {
    await database.close();
    assert.match(schema, /^v3_test_[a-f0-9]{32}$/);
    await connection.query(`DROP SCHEMA "${schema}" CASCADE`); await connection.end();
  }
});
