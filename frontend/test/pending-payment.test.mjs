import test from 'node:test'
import assert from 'node:assert/strict'
import { paymentStorageKey, readPendingPayment } from '../src/api/pending-payment.ts'

test('pending payment survives remount/reload with the original key, body and version', () => {
  const action = { path: '/invoices/invoice-1/payments', method: 'POST', key: '00000000-0000-4000-8000-000000000789', version: 3,
    body: JSON.stringify({ amount: '680.00', method: 'bank_transfer', payment_date: '2026-10-31' }) }
  const key = paymentStorageKey('user-a', 'invoice-1')
  const storage = new Map([[key, JSON.stringify(action)]])
  const read = { getItem: k => storage.get(k) ?? null }
  assert.deepEqual(readPendingPayment(read, key, 'invoice-1'), action)
  assert.equal(readPendingPayment(read, paymentStorageKey('user-b', 'invoice-1'), 'invoice-1'), null)
  assert.throws(() => readPendingPayment(read, key, 'invoice-2'))
})

test('malformed saved payment blocks new actions instead of silently discarding recovery data', () => {
  assert.throws(() => readPendingPayment({ getItem: () => '{broken' }, 'key', 'invoice-1'))
  assert.throws(() => readPendingPayment({ getItem: () => '{}' }, 'key', 'invoice-1'))
})
