import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage, type PreparedMutation } from '../../api/client'
import { money } from '../../api/format'
import type {
  InvoiceSummaryListResponse,
  QuoteInput,
  ReasonInput,
  RenewInput,
  Subscription,
  SubscriptionResponse,
} from '../../api/schema'
import './subscriptions.css'
import SubscriptionAddons from './SubscriptionAddons'
import CreateSubscription from './CreateSubscription'
import RecordHistory from '../live/RecordHistory'

interface Props {
  id: string
  role: 'admin' | 'staff' | 'customer'
  onClose: () => void
  onChanged: () => void
  onSelectInvoice: (invoiceId: string) => void
  onExpired: () => void
}

type ActiveAction = 'quote' | 'confirm' | 'activate' | 'pause' | 'resume' | 'renew' | 'close' | null

export default function SubscriptionDetails({
  id,
  role,
  onClose,
  onChanged,
  onSelectInvoice,
  onExpired,
}: Props) {
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [invoices, setInvoices] = useState<InvoiceSummaryListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [editing, setEditing] = useState(false)
  const [invoicePage, setInvoicePage] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<PreparedMutation | null>(null)

  // Dialog state for actions requiring user parameters
  const [activeAction, setActiveAction] = useState<ActiveAction>(null)
  const [validityDays, setValidityDays] = useState(30)
  const [reason, setReason] = useState('')
  const [newExpiryDate, setNewExpiryDate] = useState('')

  useEffect(() => {
    const controller = new AbortController()

    Promise.all([
      api.get<SubscriptionResponse>(`/subscriptions/${id}`, {}, controller.signal),
      api.get<InvoiceSummaryListResponse>('/invoices', { subscription_id: id, page: invoicePage }, controller.signal),
    ])
      .then(([subRes, invRes]) => {
        if (controller.signal.aborted) return
        setSubscription(subRes.data)
        setInvoices(invRes)
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError && failure.status === 401) {
          onExpired()
          return
        }
        setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [id, revision, invoicePage, onExpired])

  async function executeLifecycleMutation(
    path: string,
    body: QuoteInput | ReasonInput | RenewInput | Record<string, never>,
    successMessage: string
  ) {
    if (!subscription) return
    setBusy(true)
    setError(null)
    setSuccess(null)

    const action: PreparedMutation = pendingAction ?? api.prepare(path, 'POST', body, subscription.version)
    setPendingAction(action)
    try {
      await api.send<SubscriptionResponse>(action)
      setPendingAction(null)
      setSuccess(successMessage)
      setActiveAction(null)
      setReason('')
      setLoading(true)
      setRevision(r => r + 1)
      onChanged()
    } catch (failure) {
      if (failure instanceof ApiError) {
        if (failure.status >= 400 && failure.status < 500 && failure.code !== 'REQUEST_IN_PROGRESS') setPendingAction(null)
        if (failure.status === 401) {
          onExpired()
          return
        }
        if (failure.status === 501) {
          setError('This lifecycle action is not implemented yet on the backend (HTTP 501 NOT IMPLEMENTED). The request was prepared and validated per the OpenAPI contract.')
          return
        }
      }
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  function handleActionSubmit(e: FormEvent) {
    e.preventDefault()
    if (!subscription) return

    if (activeAction === 'quote') {
      void executeLifecycleMutation(
        `/subscriptions/${id}/quote`,
        { validity_days: validityDays },
        `Quotation issued with ${validityDays} days validity.`
      )
    } else if (activeAction === 'pause') {
      if (!reason.trim()) {
        setError('Please provide a reason for pausing the subscription.')
        return
      }
      void executeLifecycleMutation(
        `/subscriptions/${id}/pause`,
        { reason: reason.trim() },
        'Pause scheduled for the eligible billing boundary.'
      )
    } else if (activeAction === 'close') {
      if (!reason.trim()) {
        setError('Please provide a reason for closing the subscription.')
        return
      }
      void executeLifecycleMutation(
        `/subscriptions/${id}/close`,
        { reason: reason.trim() },
        'Closure scheduled for the eligible billing boundary.'
      )
    } else if (activeAction === 'renew') {
      if (!newExpiryDate) {
        setError('Please select a new expiry date.')
        return
      }
      void executeLifecycleMutation(
        `/subscriptions/${id}/renew`,
        { new_expiry_date: newExpiryDate },
        `Subscription renewed through ${newExpiryDate}.`
      )
    }
  }

  const caps = subscription?.capabilities
  const canQuote = Boolean(caps?.can_quote)
  const canConfirm = Boolean(caps?.can_confirm)
  const canActivate = Boolean(caps?.can_activate)
  const canPause = Boolean(caps?.can_pause)
  const canResume = Boolean(caps?.can_resume)
  const canRenew = Boolean(caps?.can_renew)
  const canClose = Boolean(caps?.can_close)

  return (
    <section className="subscription-details-card" aria-label="Subscription details">
      {editing && subscription && <CreateSubscription initial={subscription} onExpired={onExpired} onClose={() => setEditing(false)} onCreated={updated => { setSubscription(updated); setEditing(false); setRevision(v => v + 1); onChanged() }} />}
      <div className="subscription-details-header">
        <div>
          <h2>{subscription?.number ?? 'Subscription Details'}</h2>
          {subscription && (
            <div style={{ display: 'flex', gap: 8, marginTop: 6, alignItems: 'center' }}>
              <span className={`subscription-badge ${subscription.status}`}>
                {subscription.status}
              </span>
              {subscription.is_paused && (
                <span className="subscription-badge paused">Paused</span>
              )}
              <span style={{ fontSize: '0.85rem', color: '#586a60' }}>
                v{subscription.version} · Created {subscription.created_at.slice(0, 10)}
              </span>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            disabled={busy || loading}
            onClick={() => {
              setLoading(true)
              setRevision(r => r + 1)
            }}
          >
            Refresh
          </button>
          <button disabled={busy || !!pendingAction} onClick={onClose}>
            Close details
          </button>
        </div>
      </div>

      {error && (
        <div className="live-error" role="alert">
          <p>{error}</p>
        </div>
      )}
      {success && (
        <div className="catalog-notice success" role="status">
          <p>{success}</p>
        </div>
      )}
      {pendingAction && !busy && <button onClick={() => void executeLifecycleMutation(pendingAction.path, JSON.parse(pendingAction.body), 'Subscription action completed.')}>Retry same subscription action</button>}

      {loading && !subscription ? (
        <p role="status">Loading subscription details…</p>
      ) : !subscription ? (
        <p>Subscription record not available.</p>
      ) : (
        <>
          {/* Metadata Grid */}
          <div className="catalog-details-grid">
            <div className="detail-item">
              <strong>Customer</strong>
              <span>{subscription.customer_name}</span>
            </div>
            <div className="detail-item">
              <strong>Plan</strong>
              <span>{subscription.plan_name}</span>
            </div>
            <div className="detail-item">
              <strong>Billing Interval</strong>
              <span style={{ textTransform: 'capitalize' }}>
                {subscription.billing_interval} ({subscription.currency})
              </span>
            </div>
            <div className="detail-item">
              <strong>Payment Terms</strong>
              <span>
                {subscription.payment_term_name ?? 'Standard'} ({subscription.payment_due_days ?? 0} days)
              </span>
            </div>
            <div className="detail-item">
              <strong>Start Date</strong>
              <span>{subscription.start_date ?? 'Not set'}</span>
            </div>
            <div className="detail-item">
              <strong>Expiry Date</strong>
              <span>{subscription.expiry_date ?? 'Indefinite'}</span>
            </div>
            <div className="detail-item">
              <strong>Next Billing Date</strong>
              <span>{subscription.next_billing_date ?? '—'}</span>
            </div>
            <div className="detail-item">
              <strong>Quotation Valid Until</strong>
              <span>{subscription.quotation_valid_until ?? '—'}</span>
            </div>
          </div>

          {subscription.capabilities.can_change_addons && <SubscriptionAddons subscription={subscription} onExpired={onExpired} onChanged={() => { setRevision(value => value + 1); onChanged() }} />}

          {/* Policy Snapshot */}
          {subscription.policy_snapshot && (
            <div className="policy-snapshot-box">
              <div>
                <strong>Auto Close:</strong>{' '}
                {subscription.policy_snapshot.auto_close ? 'Enabled' : 'Disabled'}
              </div>
              <div>
                <strong>Early Close:</strong>{' '}
                {subscription.policy_snapshot.allow_early_close ? 'Permitted' : 'Disallowed'}
              </div>
              <div>
                <strong>Pause/Resume:</strong>{' '}
                {subscription.policy_snapshot.allow_pause ? 'Permitted' : 'Disallowed'}
              </div>
              <div>
                <strong>Renewal:</strong>{' '}
                {subscription.policy_snapshot.allow_renewal ? 'Permitted' : 'Disallowed'}
              </div>
            </div>
          )}

          {/* Lifecycle Capabilities & Actions */}
          <div className="capabilities-strip" aria-label="Backend lifecycle permissions">
            <span>Server Capabilities:</span>
            <span className={canQuote ? 'allowed' : 'disallowed'}>Quote: {canQuote ? 'Yes' : 'No'}</span>
            <span>·</span>
            <span className={canConfirm ? 'allowed' : 'disallowed'}>Confirm: {canConfirm ? 'Yes' : 'No'}</span>
            <span>·</span>
            <span className={canActivate ? 'allowed' : 'disallowed'}>Activate: {canActivate ? 'Yes' : 'No'}</span>
            <span>·</span>
            <span className={canPause ? 'allowed' : 'disallowed'}>Pause: {canPause ? 'Yes' : 'No'}</span>
            <span>·</span>
            <span className={canResume ? 'allowed' : 'disallowed'}>Resume: {canResume ? 'Yes' : 'No'}</span>
            <span>·</span>
            <span className={canRenew ? 'allowed' : 'disallowed'}>Renew: {canRenew ? 'Yes' : 'No'}</span>
            <span>·</span>
            <span className={canClose ? 'allowed' : 'disallowed'}>Close: {canClose ? 'Yes' : 'No'}</span>
          </div>

          {/* Action buttons (only displayed if capability exists or for authorized role actions) */}
          <div className="subscription-actions-bar">
            {caps?.can_edit && role !== 'customer' && <button disabled={busy || !!pendingAction} onClick={() => setEditing(true)}>Edit draft</button>}
            <span className="action-heading">Lifecycle Actions:</span>

            {/* Quote Action */}
            {canQuote && (role === 'admin' || role === 'staff') && (
              <button
                disabled={busy || !!pendingAction}
                onClick={() => setActiveAction('quote')}
              >
                Issue Quotation…
              </button>
            )}

            {/* Confirm Quotation */}
            {canConfirm && (role === 'admin' || role === 'staff') && (
              <button
                className="primary-button"
                disabled={busy || !!pendingAction}
                onClick={() =>
                  void executeLifecycleMutation(
                    `/subscriptions/${id}/confirm`,
                    {},
                    'Quotation confirmed successfully.'
                  )
                }
              >
                Confirm Quotation
              </button>
            )}

            {/* Activate Subscription */}
            {canActivate && (role === 'admin' || role === 'staff') && (
              <button
                className="primary-button"
                disabled={busy || !!pendingAction}
                onClick={() =>
                  void executeLifecycleMutation(
                    `/subscriptions/${id}/activate`,
                    {},
                    'Subscription activated.'
                  )
                }
              >
                Activate Subscription
              </button>
            )}

            {/* Pause Subscription */}
            {canPause && !subscription.is_paused && (
              <button
                disabled={busy || !!pendingAction}
                onClick={() => setActiveAction('pause')}
              >
                Pause Subscription…
              </button>
            )}

            {/* Resume Subscription */}
            {canResume && subscription.is_paused && (
              <button
                className="primary-button"
                disabled={busy || !!pendingAction}
                onClick={() =>
                  void executeLifecycleMutation(
                    `/subscriptions/${id}/resume`,
                    {},
                    'Subscription resumed.'
                  )
                }
              >
                Resume Subscription
              </button>
            )}

            {/* Renew Subscription */}
            {canRenew && (
              <button
                disabled={busy || !!pendingAction}
                onClick={() => setActiveAction('renew')}
              >
                Renew Contract…
              </button>
            )}

            {/* Close Subscription */}
            {canClose && subscription.status !== 'closed' && (
              <button
                style={{ color: '#991b1b', borderColor: '#fecaca' }}
                disabled={busy || !!pendingAction}
                onClick={() => setActiveAction('close')}
              >
                Close / Terminate…
              </button>
            )}

            {!canQuote && !canConfirm && !canActivate && !canPause && !canResume && !canRenew && !canClose && (
              <span style={{ fontSize: '0.85rem', color: '#6b7280', fontStyle: 'italic' }}>
                No state transitions permitted by backend in current status ({subscription.status}).
              </span>
            )}
          </div>

          {/* Interactive Action Dialogs */}
          {activeAction && (
            <div className="lifecycle-dialog">
              {activeAction === 'quote' && (
                <form className="lifecycle-dialog-form" onSubmit={handleActionSubmit}>
                  <h4>Issue Quotation</h4>
                  <p>Send an official quotation with a set validity window.</p>
                  <label>
                    Quotation Validity (Days)
                    <input
                      type="number"
                      min={1}
                      max={365}
                      required
                      value={validityDays}
                      onChange={e => setValidityDays(parseInt(e.target.value, 10) || 30)}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setActiveAction(null)}>Cancel</button>
                    <button className="primary-button" disabled={busy || !!pendingAction}>Submit Quotation</button>
                  </div>
                </form>
              )}

              {activeAction === 'pause' && (
                <form className="lifecycle-dialog-form" onSubmit={handleActionSubmit}>
                  <h4>Pause Subscription</h4>
                  <p>Pauses recurring billing until explicitly resumed.</p>
                  <label>
                    Reason for Pause *
                    <input
                      type="text"
                      required
                      maxLength={500}
                      placeholder="e.g. Temporary customer project hiatus"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setActiveAction(null)}>Cancel</button>
                    <button className="primary-button" disabled={busy || !!pendingAction}>Confirm Pause</button>
                  </div>
                </form>
              )}

              {activeAction === 'close' && (
                <form className="lifecycle-dialog-form" onSubmit={handleActionSubmit}>
                  <h4>Close Subscription</h4>
                  <p>Permanently closes this subscription. Future recurring billing will terminate.</p>
                  <label>
                    Closure Reason *
                    <input
                      type="text"
                      required
                      maxLength={500}
                      placeholder="e.g. Contract completed / customer offboarding"
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setActiveAction(null)}>Cancel</button>
                    <button style={{ background: '#991b1b', color: 'white' }} disabled={busy || !!pendingAction}>Confirm Close</button>
                  </div>
                </form>
              )}

              {activeAction === 'renew' && (
                <form className="lifecycle-dialog-form" onSubmit={handleActionSubmit}>
                  <h4>Renew Subscription</h4>
                  <p>Extend the subscription agreement through a new target expiry date.</p>
                  <label>
                    New Expiry Date *
                    <input
                      type="date"
                      required
                      value={newExpiryDate}
                      onChange={e => setNewExpiryDate(e.target.value)}
                    />
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => setActiveAction(null)}>Cancel</button>
                    <button className="primary-button" disabled={busy || !!pendingAction}>Submit Renewal</button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* Line Items Table */}
          <div style={{ marginTop: 24 }}>
            <h3>Subscription Line Items ({subscription.lines.length})</h3>
            <div className="panel table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Description</th>
                    <th>Quantity</th>
                    <th>Unit Price</th>
                    <th>Taxes</th>
                    <th>Subtotal</th>
                    <th>Tax Amount</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {subscription.lines.map(line => (
                    <tr key={line.id}>
                      <td><strong>{line.description}</strong></td>
                      <td>{line.quantity}</td>
                      <td>{money(line.unit_price)}</td>
                      <td style={{ fontSize: '0.85rem' }}>
                        {line.taxes && line.taxes.length > 0
                          ? line.taxes.map(t => `${t.name} (${t.rate_percent}%)`).join(', ')
                          : 'None'}
                      </td>
                      <td>{money(line.subtotal)}</td>
                      <td>{money(line.tax_amount)}</td>
                      <td><strong>{money(line.total)}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Financial Summary */}
            <div className="financial-summary-box">
              <div className="financial-summary-item">
                <span>Recurring Subtotal</span>
                <strong>{money(subscription.recurring_subtotal)}</strong>
              </div>
              <div className="financial-summary-item">
                <span>Estimated Taxes</span>
                <strong>{money(subscription.estimated_tax_total)}</strong>
              </div>
              <div className="financial-summary-item">
                <span>Estimated Total / Period</span>
                <strong style={{ color: '#176b4b', fontSize: '1.25rem' }}>
                  {money(subscription.estimated_total)}
                </strong>
              </div>
            </div>
          </div>

          {/* Related Invoices */}
          <RecordHistory path={`/subscriptions/${id}/events`} title="Subscription history" revision={revision} onExpired={onExpired} />
          <div style={{ marginTop: 28 }}>
            <h3>Related Invoices</h3>
            {invoices && <div><button disabled={invoicePage <= 1} onClick={() => setInvoicePage(v => v - 1)}>Previous invoices</button> <span>Page {invoicePage} of {Math.max(1, invoices.meta.total_pages)}</span> <button disabled={invoicePage >= invoices.meta.total_pages} onClick={() => setInvoicePage(v => v + 1)}>Next invoices</button></div>}
            {!invoices || invoices.data.length === 0 ? (
              <p style={{ color: '#586a60', fontStyle: 'italic' }}>
                No invoices generated for this subscription yet.
              </p>
            ) : (
              <div className="panel table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Invoice Number</th>
                      <th>Status</th>
                      <th>Issue Date</th>
                      <th>Due Date</th>
                      <th>Total</th>
                      <th>Balance Due</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.data.map(inv => (
                      <tr key={inv.id}>
                        <td>
                          <button
                            className="text-button"
                            style={{ fontWeight: 600 }}
                            onClick={() => onSelectInvoice(inv.id)}
                          >
                            {inv.number}
                          </button>
                        </td>
                        <td>
                          <span className={`status-badge ${inv.status.toLowerCase()}`}>
                            {inv.status}
                            {inv.is_overdue ? ' · overdue' : ''}
                          </span>
                        </td>
                        <td>{inv.issue_date}</td>
                        <td>{inv.due_date}</td>
                        <td>{money(inv.total)}</td>
                        <td><strong>{money(inv.balance_due)}</strong></td>
                        <td>
                          <button onClick={() => onSelectInvoice(inv.id)}>
                            View Invoice
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}

