import type { PreparedMutation } from './client'

// Financial action metadata only, never passwords, cookies or CSRF tokens.
export function paymentStorageKey(userId: string, invoiceId: string) { return `brightloop.payment.v1:${userId}:${invoiceId}` }
export function readPendingPayment(storage: Pick<Storage, 'getItem'>, key: string, invoiceId: string): PreparedMutation | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  const value = JSON.parse(raw) as PreparedMutation
  if (value.method !== 'POST' || value.path !== `/invoices/${invoiceId}/payments` || typeof value.body !== 'string'
    || !/^[a-f0-9-]{36}$/i.test(value.key) || !Number.isInteger(value.version) || value.version! < 1) {
    throw new Error('Stored payment action is invalid. Reconcile the invoice before clearing browser session storage.')
  }
  const body = JSON.parse(value.body)
  if (!body || typeof body !== 'object' || typeof body.amount !== 'string' || typeof body.method !== 'string' || typeof body.payment_date !== 'string') throw new Error('Stored payment body is invalid.')
  return Object.freeze(value)
}
