import VariantSelect from '../catalog/VariantSelect'
import RecordSelect from '../catalog/RecordSelect'
import RecordMultiSelect from '../catalog/RecordMultiSelect'
import { useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage, type PreparedMutation } from '../../api/client'
import type { Subscription, SubscriptionInput, SubscriptionLineInput, SubscriptionResponse } from '../../api/schema'
import { normalizeDecimal, validateDecimal4 } from '../catalog/decimal'
import './subscriptions.css'

interface Props {
  initial?: Subscription
  onClose: () => void
  onCreated: (newSub: SubscriptionResponse['data']) => void
  onExpired: () => void
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default function CreateSubscription({ initial, onClose, onCreated, onExpired }: Props) {
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? '')
  const [planId, setPlanId] = useState(initial?.plan_id ?? '')
  const [templateId, setTemplateId] = useState(initial?.template_id ?? '')
  const [paymentTermId, setPaymentTermId] = useState(initial?.payment_term_id ?? '')
  const [startDate, setStartDate] = useState(() =>
    initial?.start_date ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  )
  const [expiryDate, setExpiryDate] = useState(initial?.expiry_date ?? '')

  // Optional customized line items
  const [lines, setLines] = useState<SubscriptionLineInput[]>(initial?.lines.map(({ product_id, variant_id, quantity, unit_price, tax_ids }) => ({ product_id, variant_id, quantity, unit_price, tax_ids })) ?? [])
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<PreparedMutation | null>(null)

  function addLine() {
    setLines([
      ...lines,
      { product_id: '', variant_id: null, quantity: '1.0000' },
    ])
  }

  function removeLine(idx: number) {
    setLines(lines.filter((_, i) => i !== idx))
  }

  function updateLine(idx: number, updates: Partial<SubscriptionLineInput>) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...updates } : l)))
  }

  function validate(): SubscriptionInput | null {
    const errs: Record<string, string> = {}

    const trimmedCust = customerId.trim()
    if (!trimmedCust) errs.customerId = 'Customer ID is required.'
    else if (!UUID_REGEX.test(trimmedCust)) errs.customerId = 'Must be a valid UUID format.'

    const trimmedPlan = planId.trim()
    if (!trimmedPlan) errs.planId = 'Plan ID is required.'
    else if (!UUID_REGEX.test(trimmedPlan)) errs.planId = 'Must be a valid UUID format.'

    const trimmedTerm = paymentTermId.trim()
    if (!trimmedTerm) errs.paymentTermId = 'Payment term ID is required.'
    else if (!UUID_REGEX.test(trimmedTerm)) errs.paymentTermId = 'Must be a valid UUID format.'

    if (templateId.trim() && !UUID_REGEX.test(templateId.trim())) {
      errs.templateId = 'Template ID must be a valid UUID if provided.'
    }

    if (!startDate) {
      errs.startDate = 'Start date is required.'
    }
    if (startDate && expiryDate && expiryDate < startDate) {
      errs.expiryDate = 'Expiry date must be on or after start date.'
    }

    const validLines: SubscriptionLineInput[] = []
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      const pid = l.product_id.trim()
      if (!pid) {
        errs[`line_prod_${i}`] = 'Product UUID is required for line item.'
      } else if (!UUID_REGEX.test(pid)) {
        errs[`line_prod_${i}`] = 'Product ID must be a valid UUID.'
      }

      const normQty = normalizeDecimal(l.quantity, 4)
      if (!normQty) {
        errs[`line_qty_${i}`] = 'Quantity must be a valid 4-decimal value > 0.'
      } else {
        const v = validateDecimal4(normQty)
        if (!v.valid) errs[`line_qty_${i}`] = v.message!
      }

      let normPrice: string | undefined = undefined
      if (l.unit_price && l.unit_price.trim()) {
        const p = normalizeDecimal(l.unit_price, 4)
        if (!p) {
          errs[`line_price_${i}`] = 'Unit price must be a valid 4-decimal value.'
        } else {
          normPrice = p
        }
      }

      if (pid && normQty && !errs[`line_prod_${i}`] && !errs[`line_qty_${i}`]) {
        validLines.push({
          product_id: pid,
          variant_id: l.variant_id?.trim() || null,
          quantity: normQty,
          unit_price: normPrice,
          ...(l.tax_ids !== undefined ? { tax_ids: l.tax_ids } : {}),
        })
      }
    }

    setFormErrors(errs)
    if (Object.keys(errs).length > 0) return null

    return {
      customer_id: trimmedCust,
      plan_id: trimmedPlan,
      template_id: templateId.trim() || null,
      payment_term_id: trimmedTerm,
      start_date: startDate,
      expiry_date: expiryDate || null,
      lines: initial || validLines.length > 0 ? validLines : undefined,
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = pending ? JSON.parse(pending.body) as SubscriptionInput : validate()
    if (!payload) return

    setBusy(true)
    setError(null)
    const { customer_id: _customer, template_id: _template, ...updates } = payload
    const action = pending ?? (initial ? api.prepare(`/subscriptions/${initial.id}`, 'PATCH', updates, initial.version) : api.prepare('/subscriptions', 'POST', payload))
    setPending(action)

    try {
      const result = await api.send<SubscriptionResponse>(action)
      setPending(null)
      onCreated(result.data)
    } catch (failure) {
      if (failure instanceof ApiError) {
        if (failure.status === 401) {
          onExpired()
          return
        }
        if (failure.status === 501) {
          setError('Subscription creation is not implemented yet on the backend (HTTP 501 NOT IMPLEMENTED). The mutation payload, UUIDs, and line items were validated against the OpenAPI contract.')
          return
        }
        if ([400, 404, 412, 422, 428].includes(failure.status)) setPending(null)
      }
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="subscription-create-modal" aria-label="Create subscription quotation">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h3>{initial ? 'Edit draft subscription' : 'Create New Quotation / Subscription'}</h3>
          <p style={{ margin: 0, color: '#586a60', fontSize: '0.88rem' }}>
            Assemble a customer agreement by associating a customer profile, subscription plan, payment term, and optional custom line items.
          </p>
        </div>
        <button disabled={busy} onClick={onClose}>
          ✕ Close
        </button>
      </div>

      {error && (
        <div className="live-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {pending && (
        <div style={{ marginBottom: 14 }}>
          <button
            disabled={busy}
            onClick={() => void handleSubmit(new Event('submit') as any)}
          >
            Retry Same Creation Request
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="catalog-form-grid">
          <div className="catalog-field">
            <label>Customer *</label>
            <RecordSelect resource="/customers" label="Customer" value={customerId} onChange={setCustomerId} disabled={!!initial} required />
            {formErrors.customerId && <span className="field-error">{formErrors.customerId}</span>}
          </div>

          <div className="catalog-field">
            <label>Plan *</label>
            <RecordSelect resource="/plans" label="Plan" value={planId} onChange={setPlanId} required />
            {formErrors.planId && <span className="field-error">{formErrors.planId}</span>}
          </div>

          <div className="catalog-field">
            <label>Payment term *</label>
            <RecordSelect resource="/payment-terms" label="Payment term" value={paymentTermId} onChange={setPaymentTermId} required />
            {formErrors.paymentTermId && <span className="field-error">{formErrors.paymentTermId}</span>}
          </div>

          <div className="catalog-field">
            <label>Template (optional)</label>
            <RecordSelect resource="/quotation-templates" label="Template" value={templateId} onChange={setTemplateId} disabled={!!initial} />
            {formErrors.templateId && <span className="field-error">{formErrors.templateId}</span>}
          </div>

          <div className="catalog-field">
            <label>Start Date *</label>
            <input
              type="date"
              required
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
            {formErrors.startDate && <span className="field-error">{formErrors.startDate}</span>}
          </div>

          <div className="catalog-field">
            <label>Expiry Date (optional)</label>
            <input
              type="date"
              min={startDate}
              value={expiryDate}
              onChange={e => setExpiryDate(e.target.value)}
            />
            {formErrors.expiryDate && <span className="field-error">{formErrors.expiryDate}</span>}
          </div>
        </div>

        {/* Optional customized line items */}
        <div style={{ marginTop: 20, borderTop: '1px solid #e1ebe4', paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h4 style={{ margin: 0, color: '#153d2d' }}>Custom Line Items (Optional)</h4>
            <button type="button" onClick={addLine}>+ Add Custom Line</button>
          </div>
          <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem', color: '#586a60' }}>
            {initial ? 'Changes replace the draft lines. At least one line is needed before issuing a quotation.' : 'If left empty, lines from the selected plan/template will be populated by the server.'}
          </p>

          {lines.map((l, idx) => (
            <div key={idx} className="line-item-row" style={{ gridTemplateColumns: '2fr 2fr 1fr 1fr auto' }}>
              <div>
                <RecordSelect resource="/products" label="Product" required value={l.product_id} onChange={value => updateLine(idx, { product_id: value, variant_id: null })} />
                {formErrors[`line_prod_${idx}`] && <span className="field-error">{formErrors[`line_prod_${idx}`]}</span>}
              </div>
              <div>
                <VariantSelect key={l.product_id} productId={l.product_id} value={l.variant_id ?? ""} onChange={value => updateLine(idx, { variant_id: value || null })} />
              </div>
              <div>
                <input
                  type="text"
                  required
                  placeholder="Qty (e.g. 1.0000)"
                  value={l.quantity}
                  onChange={e => updateLine(idx, { quantity: e.target.value })}
                />
                {formErrors[`line_qty_${idx}`] && <span className="field-error">{formErrors[`line_qty_${idx}`]}</span>}
              </div>
              <div>
                <input
                  type="text"
                  placeholder="Price (optional)"
                  value={l.unit_price ?? ''}
                  onChange={e => updateLine(idx, { unit_price: e.target.value || undefined })}
                />
                {formErrors[`line_price_${idx}`] && <span className="field-error">{formErrors[`line_price_${idx}`]}</span>}
              </div>
              <div>
                <label><input type="checkbox" checked={l.tax_ids !== undefined} onChange={e => updateLine(idx, { tax_ids: e.target.checked ? [] : undefined })} /> Override product taxes</label>
                {l.tax_ids !== undefined && <RecordMultiSelect resource="/taxes" label="Line taxes" value={l.tax_ids.join(',')} onChange={value => updateLine(idx, { tax_ids: value.split(',').map(v => v.trim()).filter(Boolean) })} />}
                <button
                  type="button"
                  onClick={() => removeLine(idx)}
                  style={{ border: '1px solid #e6b7a9', color: '#991b1b', background: '#fff3ee' }}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="catalog-form-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" disabled={busy}>
            {busy ? 'Submitting…' : initial ? 'Save draft changes' : 'Create draft subscription'}
          </button>
        </div>
      </form>
    </div>
  )
}

