import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { createRequire } from 'node:module';
import { createDatabase } from '../../src/db/client.js';
import { createApp } from '../../src/app.js';
import { loadContract } from '../../src/contracts.js';

const origin = 'http://localhost:5173';
const invoiceId = '00000000-0000-4000-8000-000000000200';
const subscriptionId = '00000000-0000-4000-8000-000000000100';
const backend = fileURLToPath(new URL('../../', import.meta.url));
const validator = new Ajv2020({ strict: false, allErrors: true });
createRequire(import.meta.url)('ajv-formats')(validator);
const schemas = (loadContract() as unknown as { components: object }).components;
validator.addSchema({ $id: 'contract', components: schemas });
function contract(name: string, body: unknown) {
  const validate = validator.compile({ $ref: `contract#/components/schemas/${name}` });
  assert.ok(validate(body), JSON.stringify(validate.errors));
}

test('prototype v1 against real PostgreSQL in a newly created isolated schema', { timeout: 120_000 }, async t => {
  assert.ok(process.env.DATABASE_URL, 'Set DATABASE_URL to a local development database; tests create their own schema.');
  const url = new URL(process.env.DATABASE_URL);
  assert.ok(['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname), 'Integration tests require local PostgreSQL.');
  const schema = `prototype_test_${randomUUID().replaceAll('-', '')}`;
  url.searchParams.set('schema', schema);
  const connection = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await connection.connect();
  await connection.query(`CREATE SCHEMA "${schema}"`);
  const database = createDatabase(url.toString()), prisma = database.prisma!;
  const env = { ...process.env, DATABASE_URL: url.toString(), DIRECT_URL: url.toString(), NODE_ENV: 'test', ALLOW_DEV_SEED: 'true', DEMO_PASSWORD: 'BrightloopDemo!2026' };
  const run = (script: string, args: string[]) => execFileSync(process.execPath, [script, ...args], { cwd: backend, env, windowsHide: true, stdio: 'pipe', timeout: 40_000 });
  const seed = () => run('node_modules/tsx/dist/cli.mjs', ['prisma/seed.ts']);
  try {
    run('node_modules/prisma/build/index.js', ['migrate', 'deploy']);
    seed(); seed();
    const app = createApp({ nodeEnv: 'test', host: '127.0.0.1', port: 3000, frontendOrigin: origin }, { database, now: () => new Date('2026-10-31T12:00:00Z') });
    async function login(email: string) {
      const agent = request.agent(app);
      const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
      contract('CsrfResponse', csrf.body);
      const result = await agent.post('/api/v1/auth/login').set('Origin', origin).set('X-CSRF-Token', csrf.body.data.csrf_token)
        .send({ email, password: 'BrightloopDemo!2026' }).expect(200);
      contract('SessionResponse', result.body);
      assert.notEqual(result.body.data.csrf_token, csrf.body.data.csrf_token);
      assert.match(String(result.headers['set-cookie']), /HttpOnly/);
      return { agent, token: result.body.data.csrf_token as string, oldToken: csrf.body.data.csrf_token as string };
    }
    const admin = await login('ADMIN@brightloop.io');
    const staff = await login('staff@brightloop.io');
    const customer = await login('billing@acmestudio.com');
    await t.test('migration/seed, readiness and contract-shaped database reads', async () => {
      assert.equal(await prisma.user.count(), 3);
      assert.equal(await prisma.invoice.count(), 1);
      await admin.agent.get('/health/ready').expect(200);
      for (const [path, name] of [
        ['/auth/me', 'SessionResponse'], ['/subscriptions', 'SubscriptionSummaryListResponse'], [`/subscriptions/${subscriptionId}`, 'SubscriptionResponse'],
        ['/invoices', 'InvoiceSummaryListResponse'], [`/invoices/${invoiceId}`, 'InvoiceResponse'], ['/payments', 'PaymentListResponse'],
        [`/invoices/${invoiceId}/payments`, 'PaymentListResponse'], ['/reports/overview?from=2026-10-01&to=2026-10-31', 'OverviewResponse'],
      ]) { const response = await admin.agent.get('/api/v1' + path).expect(200); contract(name!, response.body); }
      const report = await admin.agent.get('/api/v1/reports/overview?from=2026-10-01&to=2026-10-31').expect(200);
      assert.equal(report.body.data.invoiced_total, '1180.00'); assert.equal(report.body.data.payments_received, '500.00'); assert.equal(report.body.data.outstanding_balance, '680.00');
      const subscriptions = await admin.agent.get('/api/v1/subscriptions').expect(200);
      assert.equal(subscriptions.body.data[0].estimated_total, '1180.00');
    });
    await t.test('auth, CSRF, signup escalation and customer ownership fail closed', async () => {
      await request(app).get('/api/v1/invoices').expect(401);
      await customer.agent.get('/api/v1/invoices?customer_id=00000000-0000-4000-8000-000000000010').expect(403);
      await customer.agent.get('/api/v1/reports/overview?from=2026-10-01&to=2026-10-31').expect(403);
      await customer.agent.get('/api/v1/portal/overview?from=2026-10-01&to=2026-10-31').expect(200);
      await customer.agent.post(`/api/v1/invoices/${invoiceId}/payments`).set('Origin', origin).set('X-CSRF-Token', customer.token).send({}).expect(403);
      const anonymous = request.agent(app), csrf = (await anonymous.get('/api/v1/auth/csrf')).body.data.csrf_token;
      await anonymous.post('/api/v1/auth/register').set('Origin', origin).set('X-CSRF-Token', csrf).send({ email: 'other@example.test', display_name: 'Other', password: 'Password!123', role: 'admin' }).expect(422);
      const registered = await anonymous.post('/api/v1/auth/register').set('Origin', origin).set('X-CSRF-Token', csrf).send({ email: 'other@example.test', display_name: 'Other', password: 'BrightloopDemo!2026' }).expect(201);
      contract('UserResponse', registered.body);
      const other = await login('other@example.test');
      assert.equal((await other.agent.get('/api/v1/invoices').expect(200)).body.data.length, 0);
      await other.agent.get(`/api/v1/invoices/${invoiceId}`).expect(404);
      await other.agent.get(`/api/v1/invoices/${invoiceId}/payments`).expect(404);
      await other.agent.get(`/api/v1/subscriptions/${subscriptionId}`).expect(404);
      await admin.agent.post('/api/v1/auth/logout').set('Origin', origin).set('X-CSRF-Token', admin.oldToken).send({}).expect(403);
      await admin.agent.post('/api/v1/auth/logout').set('X-CSRF-Token', admin.token).send({}).expect(403);
      await other.agent.post('/api/v1/auth/logout').set('Origin', origin).set('X-CSRF-Token', other.token).send({}).expect(204);
      await other.agent.get('/api/v1/auth/me').expect(401);
    });
    const body = { amount: '680.00', method: 'bank_transfer', payment_date: '2026-10-31', note: 'Final payment' };
    const pay = (key: string, version: string, payload: object = body, id = invoiceId) => staff.agent.post(`/api/v1/invoices/${id}/payments`)
      .set('Origin', origin).set('X-CSRF-Token', staff.token).set('Idempotency-Key', key).set('If-Match', version).send(payload);
    await t.test('validation and versions reject invalid payments without consuming idempotency keys', async () => {
      const key = randomUUID();
      await pay(key, '"1"', { ...body, amount: '681.00' }).expect(409);
      await pay(key, '"1"', { ...body, amount: '0.00' }).expect(422);
      await pay(key, '"1"', { ...body, amount: '1.001' }).expect(422);
      await pay(key, '"1"', { ...body, payment_date: '2026-11-01' }).expect(422);
      await pay(key, '"2"').expect(412);
      assert.equal(await prisma.idempotencyRecord.count(), 0);
      assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).amountPaid.toFixed(2), '500.00');
    });
    await t.test('final payment, replay after paid status, reporting and reseed preserve financial state', async () => {
      const key = randomUUID();
      const first = await pay(key, '"1"').expect(201); contract('PaymentResultResponse', first.body);
      assert.equal(first.body.data.invoice.status, 'paid'); assert.equal(first.body.data.invoice.balance_due, '0.00');
      const replay = await pay(key, '"1"').expect(201); assert.deepEqual(replay.body, first.body);
      await pay(key, '"1"', { ...body, note: 'Different request' }).expect(409);
      await pay(randomUUID(), '"1"').expect(412);
      assert.equal(await prisma.payment.count({ where: { invoiceId } }), 2);
      seed();
      const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } }); assert.equal(invoice.status, 'PAID'); assert.equal(invoice.amountPaid.toFixed(2), '1180.00');
      const report = await staff.agent.get('/api/v1/reports/overview?from=2026-10-01&to=2026-10-31').expect(200);
      assert.equal(report.body.data.payments_received, '1180.00'); assert.equal(report.body.data.outstanding_balance, '0.00');
      assert.equal(report.body.data.monthly[0].payments_received, '1180.00');
    });
    await t.test('concurrent independent payments cannot overpay an invoice', async () => {
      const id = randomUUID();
      await prisma.invoice.create({ data: { id, subscriptionId, number: 'INV-CONCURRENCY', status: 'CONFIRMED', periodStart: new Date('2026-11-01'), periodEnd: new Date('2026-12-01'),
        issueDate: new Date('2026-10-31'), dueDate: new Date('2026-11-15'), customerNameSnapshot: 'Acme', billingEmailSnapshot: 'billing@acmestudio.com', subtotal: '100.00', total: '100.00' } });
      const responses = await Promise.all([pay(randomUUID(), '"1"', { ...body, amount: '80.00' }, id), pay(randomUUID(), '"1"', { ...body, amount: '80.00' }, id)]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 412]);
      assert.equal(await prisma.payment.count({ where: { invoiceId: id } }), 1);
      assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id } })).amountPaid.toFixed(2), '80.00');
    });
    await t.test('concurrent identical requests create one payment and can be replayed', async () => {
      const id = randomUUID(), key = randomUUID();
      await prisma.invoice.create({ data: { id, subscriptionId, number: 'INV-REPLAY', status: 'CONFIRMED', periodStart: new Date('2026-12-01'), periodEnd: new Date('2027-01-01'),
        issueDate: new Date('2026-10-31'), dueDate: new Date('2026-11-15'), customerNameSnapshot: 'Acme', billingEmailSnapshot: 'billing@acmestudio.com', subtotal: '100.00', total: '100.00' } });
      const payload = { ...body, amount: '50.00' };
      const results = await Promise.all([pay(key, '"1"', payload, id), pay(key, '"1"', payload, id)]);
      assert.ok(results.some(r => r.status === 201));
      assert.ok(results.every(r => r.status === 201 || (r.status === 409 && r.body.error.code === 'REQUEST_IN_PROGRESS')));
      const replay = await pay(key, '"1"', payload, id).expect(201);
      assert.deepEqual(replay.body, results.find(r => r.status === 201)!.body);
      assert.equal(await prisma.payment.count({ where: { invoiceId: id } }), 1);
      assert.equal((await prisma.invoice.findUniqueOrThrow({ where: { id } })).amountPaid.toFixed(2), '50.00');
    });
    await t.test('query allowlists, pagination, inclusive dates, and disabled accounts', async () => {
      await staff.agent.get('/api/v1/invoices?unexpected=x').expect(400);
      await staff.agent.get('/api/v1/invoices?page_size=101').expect(400);
      const empty = await staff.agent.get('/api/v1/invoices?page=999').expect(200); assert.equal(empty.body.data.length, 0); assert.equal(empty.body.meta.total, 3);
      await staff.agent.get('/api/v1/reports/overview?from=2026-10-01&to=2026-11-01').expect(422);
      await prisma.user.update({ where: { email: 'staff@brightloop.io' }, data: { isActive: false } });
      await staff.agent.get('/api/v1/invoices').expect(403);
      await request(app).post('/api/v1/auth/login').send({}).expect(403);
    });
  } finally {
    await database.close();
    // Only this run's random, explicitly created schema is removed. Public/application data is untouched.
    assert.match(schema, /^prototype_test_[a-f0-9]{32}$/);
    await connection.query(`DROP SCHEMA "${schema}" CASCADE`);
    await connection.end();
  }
});
