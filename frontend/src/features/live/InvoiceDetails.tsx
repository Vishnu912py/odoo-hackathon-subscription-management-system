import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, errorMessage } from '../../api/client'
import type { PreparedMutation } from '../../api/client'
import type { Invoice, InvoiceResponse, PaymentInput, PaymentListResponse, PaymentResultResponse } from '../../api/schema'
import { money } from '../../api/format'
import { paymentStorageKey, readPendingPayment } from '../../api/pending-payment'

export default function InvoiceDetails({ id, userId, onClose, onChanged, onExpired }: {
  id: string; userId: string; onClose: () => void; onChanged: () => void; onExpired: () => void
}) {
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [payments, setPayments] = useState<PaymentListResponse | null>(null)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [success, setSuccess] = useState('')
  const storageKey = paymentStorageKey(userId, id)
  const [restored] = useState(() => {
    try { return { action: readPendingPayment(sessionStorage, storageKey, id), error: null as string | null } }
    catch { return { action: null, error: 'Cannot read payment recovery storage. Reconcile this invoice before recording another payment.' } }
  })
  const [pending, setPending] = useState<PreparedMutation | null>(restored.action)
  const [input, setInput] = useState<PaymentInput>(() => restored.action ? JSON.parse(restored.action.body) as PaymentInput : ({ amount: '', method: 'bank_transfer', payment_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), note: '' }))
  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      api.get<InvoiceResponse>(`/invoices/${id}`, {}, controller.signal),
      api.get<PaymentListResponse>(`/invoices/${id}/payments`, { page_size: 20 }, controller.signal),
    ]).then(([detail, history]) => {
      if (controller.signal.aborted) return
      setInvoice(detail.data); setPayments(history)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onExpired()
      else setError(failure)
    })
    return () => controller.abort()
  }, [id, revision, onExpired])
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!invoice) return
    const action = pending ?? api.prepare(`/invoices/${id}/payments`, 'POST', input, invoice.version)
    try { sessionStorage.setItem(storageKey, JSON.stringify(action)) }
    catch { setError(new ApiError(0, 'STORAGE_UNAVAILABLE', 'Payment recovery storage is unavailable. No request was sent.')); return }
    setPending(action); setBusy(true); setError(null); setSuccess('')
    try {
      const result = await api.send<PaymentResultResponse>(action)
      sessionStorage.removeItem(storageKey)
      setPending(null); setSuccess(`Payment recorded. Remaining balance: ${money(result.data.invoice.balance_due)}`)
      setInvoice({ ...invoice, ...result.data.invoice }); setRevision(value => value + 1); onChanged()
      setInput(value => ({ ...value, amount: '', note: '' }))
    } catch (failure) {
      setError(failure)
      if (failure instanceof ApiError && failure.status === 401) onExpired()
      // Network/timeouts/5xx may have committed. Keep exactly the original action for reconciliation.
      if (failure instanceof ApiError && ([412, 422, 428].includes(failure.status)
        || (failure.status === 409 && ['PAYMENT_EXCEEDS_BALANCE', 'INVALID_TRANSITION'].includes(failure.code)))) {
        setPending(null)
        sessionStorage.removeItem(storageKey)
        if (failure.status === 412) { setInvoice(null); setRevision(value => value + 1); onChanged() }
      }
    } finally { setBusy(false) }
  }
  return <section className="panel live-invoice-detail" aria-label="Invoice details">
    <div className="live-heading"><h2>{invoice?.number ?? 'Invoice details'}</h2><button onClick={onClose} disabled={busy || pending !== null}>Close details</button></div>
    {error !== null && <div role="alert" className="live-error">{errorMessage(error)}{error instanceof ApiError && error.requestId && <small> Reference: {error.requestId}</small>}</div>}
    {success && <p role="status">{success}</p>}
    {restored.error && <p role="alert" className="live-error">{restored.error}</p>}
    {!invoice ? <><p>Loading invoice…</p><button onClick={() => { setError(null); setRevision(value => value + 1) }}>Retry</button></> : <>
      <p>{invoice.customer_name} · {invoice.status} · Due {invoice.due_date}</p>
      <p><strong>Total {money(invoice.total)} · Paid {money(invoice.amount_paid)} · Balance {money(invoice.balance_due)}</strong></p>
      <div className="table-scroll"><table><thead><tr><th>Description</th><th>Quantity</th><th>Unit price</th><th>Tax</th><th>Total</th></tr></thead><tbody>
        {invoice.lines.map(line => <tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{money(line.unit_price)}</td><td>{money(line.tax_amount)}</td><td>{money(line.total)}</td></tr>)}
      </tbody></table></div>
      {!restored.error && (invoice.capabilities.can_record_payment || pending) && <form className="live-payment-form" onSubmit={submit}>
        <h3>Record a payment</h3><p>This records a receipt already received; it does not charge a card or bank account.</p>
        <fieldset disabled={busy || pending !== null}>
          <label>Amount (INR)<input required inputMode="decimal" pattern="(0|[1-9][0-9]{0,15})\.[0-9]{2}" placeholder="680.00" value={input.amount} onChange={event => setInput({ ...input, amount: event.target.value })} /></label>
          <label>Method<select value={input.method} onChange={event => setInput({ ...input, method: event.target.value as PaymentInput['method'] })}>{['bank_transfer', 'cash', 'card', 'other'].map(method => <option key={method} value={method}>{method.replaceAll('_', ' ')}</option>)}</select></label>
          <label>Payment date<input type="date" required value={input.payment_date} onChange={event => setInput({ ...input, payment_date: event.target.value })} /></label>
          <label>Note<input maxLength={2000} value={input.note ?? ''} onChange={event => setInput({ ...input, note: event.target.value })} /></label>
        </fieldset>
        {pending && !busy && <p>The result is uncertain. Retry the same action to reconcile it before starting another payment.</p>}
        <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : pending ? 'Retry same payment' : 'Record payment'}</button>
      </form>}
      <h3>Recent payments</h3>
      {payments ? <><p>Showing {payments.data.length} of {payments.meta.total} payments. Use the Payments tab for the full paginated list.</p>
        <ul>{payments.data.map(payment => <li key={payment.id}>{payment.payment_date} · {payment.method.replaceAll('_', ' ')} · {money(payment.amount)}</li>)}</ul></> : <p>Loading payment history…</p>}
    </>}
  </section>
}
