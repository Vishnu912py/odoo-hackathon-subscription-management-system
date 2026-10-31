// Explicit operator test. Never run during build or migration.
// Creates clearly labelled, persisted acceptance records in the selected app.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db/client.js';
import { hashPassword } from '../src/modules/accounts/passwords.js';
import { businessDate } from '../src/modules/projections.js';

const env = JSON.parse(readFileSync(new URL('../../tmp/hosted-env.json', import.meta.url), 'utf8'));
const origin = 'https://brightloop-subscriptions-alpha.vercel.app';
assert.equal(new URL(env.DATABASE_URL).hostname, 'aws-0-ap-south-1.pooler.supabase.com');
const database = createDatabase(env.DATABASE_URL), prisma = database.prisma!;
const stateFile = new URL('../../tmp/hosted-acceptance.json', import.meta.url);
let state: Record<string, any>;
try { state = JSON.parse(readFileSync(stateFile, 'utf8')); } catch { state = { email: `acceptance-${randomUUID()}@example.test`, password: `Test!${randomBytes(24).toString('hex')}`, marker: `Acceptance ${new Date().toISOString()}` }; }
const save = () => writeFileSync(stateFile, JSON.stringify(state));
let cookie = '', csrf = '';
async function call(path: string, method = 'GET', body?: unknown, version?: number) {
  const headers: Record<string, string> = { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) };
  if (body !== undefined) Object.assign(headers, { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() });
  if (version) headers['If-Match'] = `"${version}"`;
  const response = await fetch(origin + path, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  const cookies = response.headers.getSetCookie(); if (cookies.length) cookie = cookies.map(value => value.split(';')[0]).join('; ');
  const data = await response.json();
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
try {
  if (!state.userId) { state.userId = (await prisma.user.create({ data: { email: state.email, passwordHash: await hashPassword(state.password), role: 'ADMIN', displayName: 'Temporary acceptance administrator' } })).id; save(); }
  csrf = (await call('/api/v1/auth/csrf')).data.csrf_token;
  csrf = (await call('/api/v1/auth/login', 'POST', { email: state.email, password: state.password })).data.csrf_token;
  console.info('Hosted authenticated session established.');
  const create = async (key: string, path: string, body: object) => { if (!state[key]) { state[key] = (await call('/api/v1' + path, 'POST', body)).data; save(); } return state[key]; };
  const tax = await create('tax', '/taxes', { name: `${state.marker} GST`, rate_percent: '18.0000', is_active: true });
  const product = await create('product', '/products', { name: `${state.marker} service सेवा സേവനം`, product_type: 'service', sales_price: '1.0000', cost_price: '0.0000', tax_ids: [tax.id] });
  const term = await create('term', '/payment-terms', { name: `${state.marker} immediate`, due_days: 0, is_active: true });
  const plan = await create('plan', '/plans', { name: `${state.marker} daily`, price: '1.00', currency: 'INR', billing_interval: 'daily', minimum_quantity: '1.0000', available_from: null, available_until: null, auto_close: false, allow_early_close: true, allow_pause: true, allow_renewal: true, is_active: true, products: [{ product_id: product.id, default_quantity: '1.0000', is_addon: false, unit_price_override: null }] });
  const customer = await create('customer', '/customers', { name: `${state.marker} TEST ONLY`, billing_email: 'vnnrocks@gmail.com', billing_address: 'Synthetic acceptance record — no real charge' });
  const today = businessDate(new Date()), tomorrow = new Date(new Date(today).getTime() + 86_400_000).toISOString().slice(0, 10);
  await create('subscription', '/subscriptions', { customer_id: customer.id, plan_id: plan.id, payment_term_id: term.id, start_date: today, expiry_date: tomorrow });
  let sub = (await call(`/api/v1/subscriptions/${state.subscription.id}`)).data;
  for (const [status, action, body] of [['draft', 'quote', { validity_days: 1 }], ['quotation', 'confirm', {}], ['confirmed', 'activate', {}]] as const) {
    if (sub.status === status) sub = (await call(`/api/v1/subscriptions/${sub.id}/${action}`, 'POST', body, sub.version)).data;
  }
  if (!state.run) { state.run = (await call('/api/v1/billing-runs', 'POST', { as_of: today, subscription_id: sub.id, limit: 10 })).data; save(); }
  const maintenance = await fetch(origin + '/api/internal/billing-maintenance', { headers: { Authorization: `Bearer ${env.CRON_SECRET}` }, signal: AbortSignal.timeout(120_000) });
  assert.ok(maintenance.ok, `Maintenance ${maintenance.status}`);
  let invoices = (await call(`/api/v1/invoices?subscription_id=${sub.id}`)).data;
  assert.equal(invoices.length, 1);
  let invoice = (await call(`/api/v1/invoices/${invoices[0].id}`)).data;
  if (invoice.status === 'draft') invoice = (await call(`/api/v1/invoices/${invoice.id}/confirm`, 'POST', {}, invoice.version)).data;
  if (invoice.status !== 'paid') await call(`/api/v1/invoices/${invoice.id}/payments`, 'POST', { amount: invoice.balance_due, method: 'cash', payment_date: today, note: 'Synthetic end-to-end test; no real funds collected.' }, invoice.version);
  const settled = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
  assert.equal(settled.status, 'PAID'); assert.ok(settled.total.equals(settled.amountPaid));
  const pdf = await fetch(origin + `/api/v1/invoices/${invoice.id}/pdf`, { headers: { Cookie: cookie } });
  assert.ok(pdf.ok); const bytes = Buffer.from(await pdf.arrayBuffer()); assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
  writeFileSync(new URL('../../tmp/pdfs/hosted-invoice.pdf', import.meta.url), bytes);
  const report = await call(`/api/v1/reports/overview?from=${today}&to=${today}`); assert.ok(report.data);
  state.invoiceId = invoice.id; state.businessVerified = true; save();
  console.info('Hosted catalog → customer → lifecycle → billing → confirmation → payment → PDF → report passed, with persisted paid invoice.');
  // Close the synthetic subscription to prevent future acceptance charges.
  sub = (await call(`/api/v1/subscriptions/${sub.id}`)).data;
  if (sub.capabilities.can_close && !sub.close_effective_date) await call(`/api/v1/subscriptions/${sub.id}/close`, 'POST', { reason: 'Acceptance verification completed; synthetic record.' }, sub.version);
  if (process.argv.includes('--email') && !state.invited) { const current = (await call(`/api/v1/customers/${customer.id}`)).data; await call(`/api/v1/customers/${customer.id}/invite`, 'POST', {}, current.version); state.invited = true; save(); }
  if (process.argv.includes('--email') && !state.emailed) { invoice = (await call(`/api/v1/invoices/${invoice.id}`)).data; await call(`/api/v1/invoices/${invoice.id}/send`, 'POST', {}, invoice.version); state.emailed = true; save(); }
} finally { await database.close(); }
