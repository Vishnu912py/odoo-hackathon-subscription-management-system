// Explicit release acceptance/bootstrap; never invoked by builds or migrations.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db/client.js';
import { hashPassword } from '../src/modules/accounts/passwords.js';
const root = new URL('../../tmp/', import.meta.url);
const env = JSON.parse(readFileSync(new URL('hosted-env.json', root), 'utf8'));
const state = JSON.parse(readFileSync(new URL('hosted-acceptance.json', root), 'utf8'));
const origin = 'https://brightloop-subscriptions-alpha.vercel.app';
const database = createDatabase(env.DATABASE_URL), prisma = database.prisma!;
let cookie = '', csrf = '';
async function call(path: string, body?: object) {
  const response = await fetch(origin + '/api/v1' + path, { method: body ? 'POST' : 'GET', headers: { Origin: origin, Cookie: cookie, ...(body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60_000) });
  if (response.headers.getSetCookie().length) cookie = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const data = await response.json(); assert.ok(response.ok, `${path}: ${response.status}`); return data.data;
}
try {
  csrf = (await call('/auth/csrf')).csrf_token;
  if (!state.portalVerified) {
    const token = readFileSync(new URL('hosted-invitation-token.txt', root), 'utf8');
    const password = `Verified!${randomBytes(24).toString('hex')}`;
    const existing = await prisma.user.findFirst({ where: { email: 'vnnrocks@gmail.com' }, include: { customer: true } });
    if (existing) {
      assert.equal(existing.role, 'CUSTOMER'); assert.equal(existing.customer?.id, state.customer.id);
      await prisma.user.update({ where: { id: existing.id }, data: { passwordHash: await hashPassword(password) } });
    } else await call('/auth/accept-customer-invitation', { token, password });
    csrf = (await call('/auth/login', { email: 'vnnrocks@gmail.com', password })).csrf_token;
    const me = await call('/auth/me'); assert.equal(me.user.role, 'customer');
    const invoices = await call('/invoices'); assert.ok(invoices.some((invoice: {id:string}) => invoice.id === state.invoiceId));
    state.portalVerified = true;
    writeFileSync(new URL('hosted-acceptance.json', root), JSON.stringify(state));
    console.info('Received invitation link accepted; customer portal returned its persisted invoice.');
  }
  // Bootstrap the project owner's administrator login only after verifying the customer journey.
  const owner = await prisma.user.findFirstOrThrow({ where: { email: 'vnnrocks@gmail.com' } });
  await prisma.$transaction(async tx => {
    await tx.user.update({ where: { id: owner.id }, data: { role: 'ADMIN', displayName: 'Vishnu' } });
    await tx.session.deleteMany({ where: { userId: owner.id } });
  });
  cookie = ''; csrf = (await call('/auth/csrf')).csrf_token;
  await call('/auth/forgot-password', { email: 'vnnrocks@gmail.com' });
  console.info('Owner administrator created; password setup email requested.');
} finally { await database.close(); }
