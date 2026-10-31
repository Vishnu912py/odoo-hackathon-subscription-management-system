import RecordSelect from './RecordSelect'
import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage, type PreparedMutation } from '../../api/client'
import type { Plan, PlanInput, PlanListResponse, PlanProductInput, PlanResponse, PlanUpdate } from '../../api/schema'
import { formatExactMoney, normalizeDecimal, validateDecimal2, validateDecimal4 } from './decimal'
import './catalog.css'

interface Props {
  onExpired: () => void
}

export default function PlansManagement({ onExpired }: Props) {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [is501, setIs501] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PreparedMutation | null>(null)

  // Filters & Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [intervalFilter, setIntervalFilter] = useState<'all' | 'daily' | 'weekly' | 'monthly' | 'yearly'>('all')
  const [revision, setRevision] = useState(0)

  // Details (derived) & Forms
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? null

  const [showForm, setShowForm] = useState(false)
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null)

  // Form Fields
  const [name, setName] = useState('')
  const [price, setPrice] = useState('999.00')
  const [billingInterval, setBillingInterval] = useState<'daily' | 'weekly' | 'monthly' | 'yearly'>('monthly')
  const [minQuantity, setMinQuantity] = useState('1.0000')
  const [availableFrom, setAvailableFrom] = useState('')
  const [availableUntil, setAvailableUntil] = useState('')
  const [autoClose, setAutoClose] = useState(false)
  const [allowEarlyClose, setAllowEarlyClose] = useState(true)
  const [allowPause, setAllowPause] = useState(true)
  const [allowRenewal, setAllowRenewal] = useState(true)
  const [isActive, setIsActive] = useState(true)

  // Included products builder
  const [planProducts, setPlanProducts] = useState<PlanProductInput[]>([
    { product_id: '', default_quantity: '1.0000', is_addon: false, unit_price_override: null },
  ])
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    const controller = new AbortController()

    const query: Record<string, string | number | boolean | undefined> = {
      page,
      page_size: 20,
    }
    if (debouncedSearch) query.q = debouncedSearch
    if (statusFilter === 'active') query.is_active = true
    if (statusFilter === 'inactive') query.is_active = false
    if (intervalFilter !== 'all') query.billing_interval = intervalFilter

    api.get<PlanListResponse>('/plans', query, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setPlans(result.data)
        setTotalPages(result.meta.total_pages)
        setTotalCount(result.meta.total)
      })
      .catch(failure => {
        if (controller.signal.aborted) return
        if (failure instanceof ApiError) {
          if (failure.status === 401) {
            onExpired()
            return
          }
          if (failure.status === 501) {
            setIs501(true)
            setError('Subscription plans API is not implemented yet on the backend (HTTP 501). Catalog management screens are ready and will reflect live data once backend routes are connected.')
            return
          }
        }
        setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [page, debouncedSearch, statusFilter, intervalFilter, revision, onExpired])

  async function sendMutation(action: PreparedMutation, successText: string, onDone?: () => void) {
    setPending(action)
    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      await api.send<PlanResponse>(action)
      setPending(null)
      setSuccessMessage(successText)
      if (onDone) onDone()
      setLoading(true)
      setRevision(r => r + 1)
    } catch (failure) {
      if (failure instanceof ApiError) {
        if (failure.status === 401) {
          onExpired()
          return
        }
        if (failure.status === 501) {
          setError('Backend operation is not implemented yet (HTTP 501).')
          return
        }
        if ([400, 404, 412, 422, 428].includes(failure.status)) setPending(null)
        if (failure.status === 409 && failure.code !== 'REQUEST_IN_PROGRESS') setPending(null)
      }
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  function openCreate() {
    setEditingPlan(null)
    setName('')
    setPrice('999.00')
    setBillingInterval('monthly')
    setMinQuantity('1.0000')
    setAvailableFrom('')
    setAvailableUntil('')
    setAutoClose(false)
    setAllowEarlyClose(true)
    setAllowPause(true)
    setAllowRenewal(true)
    setIsActive(true)
    setPlanProducts([{ product_id: '', default_quantity: '1.0000', is_addon: false, unit_price_override: null }])
    setFormErrors({})
    setShowForm(true)
    setSelectedPlanId(null)
  }

  function openEdit(plan: Plan) {
    setEditingPlan(plan)
    setName(plan.name)
    setPrice(plan.price)
    setBillingInterval(plan.billing_interval)
    setMinQuantity(plan.minimum_quantity)
    setAvailableFrom(plan.available_from ?? '')
    setAvailableUntil(plan.available_until ?? '')
    setAutoClose(plan.auto_close)
    setAllowEarlyClose(plan.allow_early_close)
    setAllowPause(plan.allow_pause)
    setAllowRenewal(plan.allow_renewal)
    setIsActive(plan.is_active)
    setPlanProducts(
      plan.products && plan.products.length > 0
        ? plan.products.map(p => ({
            product_id: p.product_id,
            default_quantity: p.default_quantity,
            is_addon: p.is_addon,
            unit_price_override: p.unit_price_override,
          }))
        : [{ product_id: '', default_quantity: '1.0000', is_addon: false, unit_price_override: null }]
    )
    setFormErrors({})
    setShowForm(true)
  }

  function addProductRow() {
    setPlanProducts([
      ...planProducts,
      { product_id: '', default_quantity: '1.0000', is_addon: false, unit_price_override: null },
    ])
  }

  function removeProductRow(index: number) {
    if (planProducts.length <= 1) return
    setPlanProducts(planProducts.filter((_, i) => i !== index))
  }

  function updateProductRow(index: number, updates: Partial<PlanProductInput>) {
    setPlanProducts(
      planProducts.map((p, i) => (i === index ? { ...p, ...updates } : p))
    )
  }

  function validateForm(): PlanInput | null {
    const errs: Record<string, string> = {}
    const trimmedName = name.trim()
    if (!trimmedName) errs.name = 'Plan name is required.'
    else if (trimmedName.length > 200) errs.name = 'Plan name cannot exceed 200 characters.'

    const normPrice = normalizeDecimal(price, 2)
    if (!normPrice) {
      errs.price = 'Price must be a valid non-negative decimal with exactly 2 fractional digits (e.g. 999.00).'
    } else {
      const v = validateDecimal2(normPrice)
      if (!v.valid) errs.price = v.message!
    }

    const normMinQty = normalizeDecimal(minQuantity, 4)
    if (!normMinQty) {
      errs.minQuantity = 'Minimum quantity must be a decimal with 4 fractional digits (e.g. 1.0000).'
    } else {
      const v = validateDecimal4(normMinQty)
      if (!v.valid) errs.minQuantity = v.message!
    }

    if (availableFrom && availableUntil && availableUntil < availableFrom) {
      errs.availableUntil = 'Available until date must be on or after available from date.'
    }

    const validProducts: PlanProductInput[] = []
    for (let i = 0; i < planProducts.length; i++) {
      const p = planProducts[i]
      const pid = p.product_id.trim()
      if (!pid) {
        errs[`product_${i}`] = 'Product ID (UUID) is required for each included item.'
      }
      const normQty = normalizeDecimal(p.default_quantity, 4)
      if (!normQty) {
        errs[`qty_${i}`] = 'Default quantity must be a 4-decimal value > 0.'
      }
      let normOverride: string | null = null
      if (p.unit_price_override && p.unit_price_override.trim()) {
        normOverride = normalizeDecimal(p.unit_price_override, 4)
        if (!normOverride) {
          errs[`override_${i}`] = 'Unit price override must be a 4-decimal value.'
        }
      }
      if (pid && normQty) {
        validProducts.push({
          product_id: pid,
          default_quantity: normQty,
          is_addon: p.is_addon,
          unit_price_override: normOverride,
        })
      }
    }

    if (validProducts.length === 0) {
      errs.products = 'At least one product item must be included in the plan.'
    }

    setFormErrors(errs)
    if (Object.keys(errs).length > 0) return null

    return {
      name: trimmedName,
      price: normPrice!,
      currency: 'INR',
      billing_interval: billingInterval,
      minimum_quantity: normMinQty!,
      available_from: availableFrom || null,
      available_until: availableUntil || null,
      auto_close: autoClose,
      allow_early_close: allowEarlyClose,
      allow_pause: allowPause,
      allow_renewal: allowRenewal,
      is_active: isActive,
      products: validProducts,
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = validateForm()
    if (!payload) return

    if (editingPlan) {
      const updatePayload: PlanUpdate = {
        name: payload.name,
        price: payload.price,
        currency: 'INR',
        billing_interval: payload.billing_interval,
        minimum_quantity: payload.minimum_quantity,
        available_from: payload.available_from,
        available_until: payload.available_until,
        auto_close: payload.auto_close,
        allow_early_close: payload.allow_early_close,
        allow_pause: payload.allow_pause,
        allow_renewal: payload.allow_renewal,
        is_active: payload.is_active,
        products: payload.products,
      }
      const action = api.prepare(`/plans/${editingPlan.id}`, 'PATCH', updatePayload, editingPlan.version)
      void sendMutation(action, `Plan "${payload.name}" updated successfully.`, () => {
        setShowForm(false)
        setEditingPlan(null)
      })
    } else {
      const action = api.prepare('/plans', 'POST', payload)
      void sendMutation(action, `Plan "${payload.name}" created successfully.`, () => {
        setShowForm(false)
      })
    }
  }

  function togglePlanActive(plan: Plan) {
    const action = api.prepare(`/plans/${plan.id}`, 'PATCH', { is_active: !plan.is_active }, plan.version)
    void sendMutation(action, `Plan "${plan.name}" marked ${!plan.is_active ? 'active' : 'inactive'}.`)
  }

  return (
    <section className="catalog-section" aria-busy={busy}>
      <div className="catalog-header">
        <div>
          <h2>Subscription Plans</h2>
          <p>Configure pricing, recurrence intervals, lifecycle rules, and product bundles.</p>
        </div>
        <button className="primary-button" disabled={busy} onClick={openCreate}>
          + Create Plan
        </button>
      </div>

      {is501 && (
        <div className="catalog-notice info-501" role="note">
          <div>
            <strong>Subscription Plans Awaiting Backend Implementation (HTTP 501)</strong>
            <p>
              Frontend plan forms, recurrence settings, exact decimal validation, and API structures are fully operational and ready for backend deployment.
            </p>
          </div>
        </div>
      )}

      {error && !is501 && <div className="live-error" role="alert"><p>{error}</p></div>}
      {successMessage && <div className="catalog-notice success" role="status"><p>{successMessage}</p></div>}
      {pending && (
        <div style={{ marginBottom: 16 }}>
          <button disabled={busy} onClick={() => void sendMutation(pending, 'Retried operation successfully.')}>
            Retry Prepared Mutation
          </button>
        </div>
      )}

      {/* Plan Form Modal/Panel */}
      {showForm && (
        <div className="catalog-form-panel">
          <h3>{editingPlan ? `Edit Plan: ${editingPlan.name}` : 'Create Subscription Plan'}</h3>
          <p className="form-subtitle">Enter recurring plan specifications and lifecycle permissions.</p>

          <form onSubmit={handleSubmit}>
            <div className="catalog-form-grid">
              <div className="catalog-field full-width">
                <label>Plan Name *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Growth Monthly Tier"
                />
                {formErrors.name && <span className="field-error">{formErrors.name}</span>}
              </div>

              <div className="catalog-field">
                <label>Recurring Price (INR, 2 decimals) *</label>
                <input
                  type="text"
                  required
                  value={price}
                  onChange={e => setPrice(e.target.value)}
                  placeholder="999.00"
                />
                {formErrors.price && <span className="field-error">{formErrors.price}</span>}
              </div>

              <div className="catalog-field">
                <label>Billing Interval *</label>
                <select
                  value={billingInterval}
                  onChange={e => setBillingInterval(e.target.value as 'daily' | 'weekly' | 'monthly' | 'yearly')}
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>

              <div className="catalog-field">
                <label>Minimum Quantity (4 decimals) *</label>
                <input
                  type="text"
                  required
                  value={minQuantity}
                  onChange={e => setMinQuantity(e.target.value)}
                  placeholder="1.0000"
                />
                {formErrors.minQuantity && <span className="field-error">{formErrors.minQuantity}</span>}
              </div>

              <div className="catalog-field">
                <label>Available From (optional)</label>
                <input
                  type="date"
                  value={availableFrom}
                  onChange={e => setAvailableFrom(e.target.value)}
                />
              </div>

              <div className="catalog-field">
                <label>Available Until (optional)</label>
                <input
                  type="date"
                  value={availableUntil}
                  min={availableFrom || undefined}
                  onChange={e => setAvailableUntil(e.target.value)}
                />
                {formErrors.availableUntil && <span className="field-error">{formErrors.availableUntil}</span>}
              </div>
            </div>

            {/* Lifecycle configuration options */}
            <div style={{ marginTop: 12, marginBottom: 20 }}>
              <label style={{ fontWeight: 600, color: '#205c42', display: 'block', marginBottom: 8 }}>
                Lifecycle Policy & Permissions
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={autoClose}
                    onChange={e => setAutoClose(e.target.checked)}
                  />
                  <span>Auto Close on Expiry</span>
                </label>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={allowEarlyClose}
                    onChange={e => setAllowEarlyClose(e.target.checked)}
                  />
                  <span>Allow Early Close</span>
                </label>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={allowPause}
                    onChange={e => setAllowPause(e.target.checked)}
                  />
                  <span>Allow Pause & Resume</span>
                </label>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={allowRenewal}
                    onChange={e => setAllowRenewal(e.target.checked)}
                  />
                  <span>Allow Contract Renewal</span>
                </label>

                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                  />
                  <span>Plan is Active</span>
                </label>
              </div>
            </div>

            {/* Included Products List */}
            <div style={{ marginTop: 16, borderTop: '1px solid #e1ebe4', paddingTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, color: '#153d2d' }}>Included Products & Add-ons *</h4>
                <button type="button" onClick={addProductRow}>+ Add Product Line</button>
              </div>
              {formErrors.products && <p className="field-error">{formErrors.products}</p>}

              {planProducts.map((item, idx) => (
                <div key={idx} className="line-item-row">
                  <div>
                    <RecordSelect resource="/products" label="Product" required value={item.product_id} onChange={value => updateProductRow(idx, { product_id: value })} />
                    {formErrors[`product_${idx}`] && <span className="field-error">{formErrors[`product_${idx}`]}</span>}
                  </div>
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="Qty (e.g. 1.0000)"
                      value={item.default_quantity}
                      onChange={e => updateProductRow(idx, { default_quantity: e.target.value })}
                    />
                    {formErrors[`qty_${idx}`] && <span className="field-error">{formErrors[`qty_${idx}`]}</span>}
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Override (optional)"
                      value={item.unit_price_override ?? ''}
                      onChange={e => updateProductRow(idx, { unit_price_override: e.target.value || null })}
                    />
                    {formErrors[`override_${idx}`] && <span className="field-error">{formErrors[`override_${idx}`]}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label className="checkbox-field" style={{ margin: 0 }}>
                      <input
                        type="checkbox"
                        checked={item.is_addon}
                        onChange={e => updateProductRow(idx, { is_addon: e.target.checked })}
                      />
                      <span>Add-on</span>
                    </label>
                    {planProducts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeProductRow(idx)}
                        style={{ border: '1px solid #e6b7a9', color: '#991b1b', background: '#fff3ee' }}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="catalog-form-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setShowForm(false); setEditingPlan(null) }}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : editingPlan ? 'Save Changes' : 'Create Plan'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Selected Plan Details Card */}
      {selectedPlan && (
        <div className="catalog-details-card">
          <div className="catalog-details-header">
            <div>
              <h3>{selectedPlan.name}</h3>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <span className="catalog-badge fixed">{selectedPlan.billing_interval}</span>
                <span className={`catalog-badge ${selectedPlan.is_active ? 'active' : 'inactive'}`}>
                  {selectedPlan.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={busy} onClick={() => openEdit(selectedPlan)}>Edit Plan</button>
              <button disabled={busy} onClick={() => setSelectedPlanId(null)}>Close Details</button>
            </div>
          </div>

          <div className="catalog-details-grid">
            <div className="detail-item">
              <strong>Price</strong>
              <span>{formatExactMoney(selectedPlan.price)} / {selectedPlan.billing_interval}</span>
            </div>
            <div className="detail-item">
              <strong>Min Quantity</strong>
              <span>{selectedPlan.minimum_quantity}</span>
            </div>
            <div className="detail-item">
              <strong>Validity Window</strong>
              <span>
                {selectedPlan.available_from ?? 'Anytime'} → {selectedPlan.available_until ?? 'Indefinite'}
              </span>
            </div>
            <div className="detail-item">
              <strong>Included Items</strong>
              <span>{selectedPlan.products?.length ?? 0} products</span>
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <h4 style={{ margin: '0 0 8px 0', fontSize: '0.95rem' }}>Lifecycle Policy</h4>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: '0.85rem' }}>
              <span className={`catalog-badge ${selectedPlan.auto_close ? 'active' : 'inactive'}`}>
                Auto Close: {selectedPlan.auto_close ? 'Yes' : 'No'}
              </span>
              <span className={`catalog-badge ${selectedPlan.allow_early_close ? 'active' : 'inactive'}`}>
                Early Close: {selectedPlan.allow_early_close ? 'Allowed' : 'Disabled'}
              </span>
              <span className={`catalog-badge ${selectedPlan.allow_pause ? 'active' : 'inactive'}`}>
                Pause/Resume: {selectedPlan.allow_pause ? 'Allowed' : 'Disabled'}
              </span>
              <span className={`catalog-badge ${selectedPlan.allow_renewal ? 'active' : 'inactive'}`}>
                Renewal: {selectedPlan.allow_renewal ? 'Allowed' : 'Disabled'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar / Filters */}
      <div className="catalog-toolbar">
        <div className="search-field">
          <label>Search Plans</label>
          <input
            type="search"
            placeholder="Search by plan name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <label>
          Billing Interval
          <select
            value={intervalFilter}
            onChange={e => {
              setIntervalFilter(e.target.value as any)
              setLoading(true)
              setPage(1)
            }}
          >
            <option value="all">All Intervals</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </select>
        </label>

        <label>
          Status Filter
          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as any)
              setLoading(true)
              setPage(1)
            }}
          >
            <option value="all">All Plans</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>
        </label>

        <div className="catalog-toolbar-actions">
          <button
            disabled={busy || loading}
            onClick={() => {
              setLoading(true)
              setRevision(r => r + 1)
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Table Listing */}
      {loading ? (
        <p role="status">Loading plans…</p>
      ) : plans.length === 0 ? (
        <div className="empty-state">
          <h3>No Plans Found</h3>
          <p>
            {debouncedSearch || statusFilter !== 'all' || intervalFilter !== 'all'
              ? 'No plans matched your filter criteria.'
              : is501
                ? 'Subscription plans endpoint returned HTTP 501. Backend implementation pending.'
                : 'Create your first subscription plan to offer recurring packages.'}
          </p>
          {!is501 && (
            <button className="primary-button" onClick={openCreate}>
              Create Plan
            </button>
          )}
        </div>
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Plan Name</th>
                <th>Price</th>
                <th>Interval</th>
                <th>Min Qty</th>
                <th>Lifecycle Flags</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.map(p => (
                <tr key={p.id}>
                  <td>
                    <button
                      className="text-button"
                      style={{ textAlign: 'left', fontWeight: 600 }}
                      onClick={() => setSelectedPlanId(p.id)}
                    >
                      {p.name}
                    </button>
                  </td>
                  <td><strong>{formatExactMoney(p.price)}</strong></td>
                  <td><span className="catalog-badge fixed">{p.billing_interval}</span></td>
                  <td>{p.minimum_quantity}</td>
                  <td style={{ fontSize: '0.8rem', color: '#586a60' }}>
                    {[
                      p.allow_pause && 'Pause',
                      p.allow_renewal && 'Renew',
                      p.allow_early_close && 'Early Close',
                    ].filter(Boolean).join(' · ') || 'Standard'}
                  </td>
                  <td>
                    <span className={`catalog-badge ${p.is_active ? 'active' : 'inactive'}`}>
                      {p.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="action-buttons-cell">
                    <button disabled={busy} onClick={() => setSelectedPlanId(p.id)}>Details</button>
                    <button disabled={busy} onClick={() => openEdit(p)}>Edit</button>
                    <button disabled={busy} onClick={() => togglePlanActive(p)}>
                      {p.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="live-pagination">
          <button
            disabled={loading || page <= 1}
            onClick={() => {
              setLoading(true)
              setPage(p => p - 1)
            }}
          >
            Previous
          </button>
          <span>Page {page} of {totalPages} · {totalCount} plans</span>
          <button
            disabled={loading || page >= totalPages}
            onClick={() => {
              setLoading(true)
              setPage(p => p + 1)
            }}
          >
            Next
          </button>
        </div>
      )}
    </section>
  )
}
