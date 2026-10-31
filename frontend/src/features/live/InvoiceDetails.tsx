import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError } from '../../api/client'
import type { PreparedMutation } from '../../api/client'
import type { Invoice, InvoiceResponse, PaymentInput, PaymentListResponse, PaymentResultResponse } from '../../api/schema'
import { money } from '../../api/format'
import { paymentStorageKey, readPendingPayment } from '../../api/pending-payment'
import { FormAlert, FormSuccess } from './FormFeedback'

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
    try {
      return { action: readPendingPayment(sessionStorage, storageKey, id), error: null as string | null }
    } catch {
      return { action: null, error: 'Cannot read payment recovery storage. Reconcile this invoice before recording another payment.' }
    }
  })

  const [pending, setPending] = useState<PreparedMutation | null>(restored.action)
  const [input, setInput] = useState<PaymentInput>(() =>
    restored.action
      ? JSON.parse(restored.action.body) as PaymentInput
      : ({
          amount: '',
          method: 'bank_transfer',
          payment_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()),
          note: '',
        })
  )

  useEffect(() => {
    const controller = new AbortController()
    void Promise.all([
      api.get<InvoiceResponse>(`/invoices/${id}`, {}, controller.signal),
      api.get<PaymentListResponse>(`/invoices/${id}/payments`, { page_size: 20 }, controller.signal),
    ]).then(([detail, history]) => {
      if (controller.signal.aborted) return
      setInvoice(detail.data)
      setPayments(history)
    }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onExpired()
      else setError(failure)
    })
    return () => controller.abort()
  }, [id, revision, onExpired])

  const amountFormatValid = /^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/.test(input.amount.trim())
  const canSubmitPayment = Boolean(invoice && (amountFormatValid || pending) && input.payment_date && !busy)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!invoice) return
    const action = pending ?? api.prepare(`/invoices/${id}/payments`, 'POST', input, invoice.version)

    try {
      sessionStorage.setItem(storageKey, JSON.stringify(action))
    } catch {
      setError(new ApiError(0, 'STORAGE_UNAVAILABLE', 'Payment recovery storage is unavailable. No request was sent.'))
      return
    }

    setPending(action)
    setBusy(true)
    setError(null)
    setSuccess('')

    try {
      const result = await api.send<PaymentResultResponse>(action)
      sessionStorage.removeItem(storageKey)
      setPending(null)
      setSuccess(`Payment recorded successfully. Remaining balance: ${money(result.data.invoice.balance_due)}`)
      setInvoice({ ...invoice, ...result.data.invoice })
      setRevision(value => value + 1)
      onChanged()
      setInput(value => ({ ...value, amount: '', note: '' }))
    } catch (failure) {
      setError(failure)
      if (failure instanceof ApiError && failure.status === 401) onExpired()
      if (
        failure instanceof ApiError &&
        ([412, 422, 428].includes(failure.status) ||
          (failure.status === 409 && ['PAYMENT_EXCEEDS_BALANCE', 'INVALID_TRANSITION'].includes(failure.code)))
      ) {
        setPending(null)
        sessionStorage.removeItem(storageKey)
        if (failure.status === 412) {
          setInvoice(null)
          setRevision(value => value + 1)
          onChanged()
        }
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel live-invoice-detail" aria-label="Invoice details">
      <div className="section-header-row">
        <div>
          <span className="eyebrow">INVOICE DETAIL</span>
          <h2>{invoice?.number ?? 'Loading invoice…'}</h2>
        </div>
        <button
          className="secondary-button"
          onClick={onClose}
          disabled={busy || pending !== null}
        >
          ✕ Close details
        </button>
      </div>

      {success && <FormSuccess message={success} />}
      {error !== null && <FormAlert error={error} />}
      {restored.error && <div className="live-alert live-alert-error" role="alert">{restored.error}</div>}

      {!invoice ? (
        <div className="loading-state" role="status">
          <p>Loading invoice records…</p>
          <button
            className="secondary-button"
            onClick={() => {
              setError(null)
              setRevision(v => v + 1)
            }}
          >
            Retry request
          </button>
        </div>
      ) : (
        <>
          <div className="invoice-meta-banner">
            <div>
              <strong>Customer:</strong> {invoice.customer_name}
            </div>
            <div>
              <strong>Status:</strong>{' '}
              <span className={`status-badge ${invoice.status.toLowerCase()}`}>
                {invoice.status}
                {invoice.is_overdue ? ' · Overdue' : ''}
              </span>
            </div>
            <div>
              <strong>Issue Date:</strong> {invoice.issue_date}
            </div>
            <div>
              <strong>Due Date:</strong> {invoice.due_date}
            </div>
          </div>

          <div className="stats-grid invoice-stats">
            <article className="stat-card">
              <div className="stat-top">Total Amount</div>
              <div className="stat-value">{money(invoice.total)}</div>
            </article>
            <article className="stat-card">
              <div className="stat-top">Amount Paid</div>
              <div className="stat-value">{money(invoice.amount_paid)}</div>
            </article>
            <article className="stat-card">
              <div className="stat-top">Balance Due</div>
              <div className="stat-value">{money(invoice.balance_due)}</div>
            </article>
          </div>

          {/* Capabilities inspection */}
          <div className="capabilities-bar" aria-label="Invoice permissions">
            <span className="capabilities-label">Permitted actions:</span>
            {invoice.capabilities.can_record_payment && <span className="cap-tag allowed">✓ Record payment</span>}
            {invoice.capabilities.can_confirm && <span className="cap-tag allowed">✓ Confirm</span>}
            {invoice.capabilities.can_cancel && <span className="cap-tag allowed">✓ Cancel</span>}
            {invoice.capabilities.can_send && <span className="cap-tag allowed">✓ Send email</span>}
            {invoice.capabilities.can_print && <span className="cap-tag allowed">✓ Print PDF</span>}
            {!invoice.capabilities.can_record_payment &&
             !invoice.capabilities.can_confirm &&
             !invoice.capabilities.can_cancel &&
             !invoice.capabilities.can_send &&
             !invoice.capabilities.can_print && (
              <span className="cap-tag readonly">Read-only view · No state changes permitted</span>
            )}
          </div>

          <h3>Line Items</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Quantity</th>
                  <th>Unit price</th>
                  <th>Tax</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map(line => (
                  <tr key={line.id}>
                    <td>{line.description}</td>
                    <td>{line.quantity}</td>
                    <td>{money(line.unit_price)}</td>
                    <td>{money(line.tax_amount)}</td>
                    <td className="font-semibold">{money(line.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* PAYMENT RECORDING: ONLY IF CAPABLE OR RECONCILING PENDING */}
          {!restored.error && (invoice.capabilities.can_record_payment || pending) && (
            <div className="panel payment-record-box">
              <h3>Record Payment Receipt</h3>
              <p className="field-hint">
                Record an offline payment (bank transfer, cash, card) already received for this invoice. This does not charge a card or execute a bank wire.
              </p>

              <form className="live-payment-form" onSubmit={submit} noValidate>
                <fieldset disabled={busy || pending !== null}>
                  <div className="form-group">
                    <label htmlFor="payment-amount">Amount (INR, exact decimal)</label>
                    <input
                      id="payment-amount"
                      required
                      inputMode="decimal"
                      pattern="(0|[1-9][0-9]{0,15})\.[0-9]{2}"
                      placeholder="e.g. 680.00"
                      value={input.amount}
                      aria-invalid={input.amount.length > 0 && !amountFormatValid}
                      onChange={event => setInput({ ...input, amount: event.target.value })}
                    />
                    {input.amount.length > 0 && !amountFormatValid && (
                      <small className="field-hint field-hint-error">Amount must have two decimal places (e.g. 680.00).</small>
                    )}
                  </div>

                  <div className="form-group">
                    <label htmlFor="payment-method">Payment Method</label>
                    <select
                      id="payment-method"
                      value={input.method}
                      onChange={event => setInput({ ...input, method: event.target.value as PaymentInput['method'] })}
                    >
                      <option value="bank_transfer">Bank transfer</option>
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                      <option value="other">Other</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="payment-date">Payment Date</label>
                    <input
                      id="payment-date"
                      type="date"
                      required
                      value={input.payment_date}
                      onChange={event => setInput({ ...input, payment_date: event.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="payment-note">Note (optional)</label>
                    <input
                      id="payment-note"
                      maxLength={2000}
                      placeholder="Transaction reference, receipt number, etc."
                      value={input.note ?? ''}
                      onChange={event => setInput({ ...input, note: event.target.value })}
                    />
                  </div>
                </fieldset>

                {pending && !busy && (
                  <div className="retry-banner" role="alert">
                    <p>
                      The previous attempt resulted in an uncertain network state. The original idempotency key is preserved in browser storage. Click below to reconcile with the exact same key:
                    </p>
                  </div>
                )}

                <div className="payment-submit-row">
                  <button
                    type="submit"
                    className="primary-button"
                    disabled={!canSubmitPayment}
                  >
                    {busy ? 'Recording payment…' : pending ? 'Retry same payment' : 'Record payment'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="recent-payments-section">
            <h3>Payment Transactions</h3>
            {payments ? (
              payments.data.length === 0 ? (
                <p className="field-hint">No payments have been recorded for this invoice yet.</p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Method</th>
                        <th>Amount</th>
                        <th>Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.data.map(p => (
                        <tr key={p.id}>
                          <td>{p.payment_date}</td>
                          <td>{p.method.replaceAll('_', ' ')}</td>
                          <td className="font-semibold">{money(p.amount)}</td>
                          <td>{p.note || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <p>Loading payment history…</p>
            )}
          </div>
        </>
      )}
    </section>
  )
}
