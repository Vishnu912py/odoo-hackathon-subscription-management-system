import RecordMultiSelect from './RecordMultiSelect'
import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage, type PreparedMutation } from '../../api/client'
import type { Discount, DiscountInput, DiscountListResponse, DiscountResponse, DiscountUpdate } from '../../api/schema'
import { formatExactMoney, normalizeDecimal, validateDecimal2, validateDecimal4 } from './decimal'
import './catalog.css'

interface Props {
  onExpired: () => void
}

export default function DiscountsManagement({ onExpired }: Props) {
  const [discounts, setDiscounts] = useState<Discount[]>([])
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
  const [scopeFilter, setScopeFilter] = useState<'all' | 'product' | 'subscription'>('all')
  const [revision, setRevision] = useState(0)

  // Form State
  const [showForm, setShowForm] = useState(false)
  const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null)
  const [name, setName] = useState('')
  const [discountType, setDiscountType] = useState<'fixed' | 'percentage'>('percentage')
  const [value, setValue] = useState('10.0000')
  const [scope, setScope] = useState<'product' | 'subscription'>('product')
  const [productIds, setProductIds] = useState('')
  const [subscriptionIds, setSubscriptionIds] = useState('')
  const [minPurchase, setMinPurchase] = useState('')
  const [minQuantity, setMinQuantity] = useState('')
  const [validFrom, setValidFrom] = useState(() => new Date().toISOString().slice(0, 10))
  const [validUntil, setValidUntil] = useState('')
  const [usageLimit, setUsageLimit] = useState('')
  const [isActive, setIsActive] = useState(true)
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
    if (scopeFilter !== 'all') query.scope = scopeFilter

    api.get<DiscountListResponse>('/discounts', query, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setDiscounts(result.data)
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
            setError('Discounts API is not implemented yet on the backend (HTTP 501). Frontend workflows and validation are ready.')
            return
          }
        }
        setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [page, debouncedSearch, statusFilter, scopeFilter, revision, onExpired])

  async function sendMutation(action: PreparedMutation, successText: string, onDone?: () => void) {
    setPending(action)
    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      await api.send<DiscountResponse>(action)
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
    setEditingDiscount(null)
    setName('')
    setDiscountType('percentage')
    setValue('10.0000')
    setScope('product')
    setProductIds('')
    setSubscriptionIds('')
    setMinPurchase('')
    setMinQuantity('')
    setValidFrom(new Date().toISOString().slice(0, 10))
    setValidUntil('')
    setUsageLimit('')
    setIsActive(true)
    setFormErrors({})
    setShowForm(true)
  }

  function openEdit(d: Discount) {
    setEditingDiscount(d)
    setName(d.name)
    setDiscountType(d.discount_type)
    setValue(d.value)
    setScope(d.scope)
    setProductIds((d.product_ids ?? []).join(', '))
    setSubscriptionIds((d.subscription_ids ?? []).join(', '))
    setMinPurchase(d.minimum_purchase ?? '')
    setMinQuantity(d.minimum_quantity ?? '')
    setValidFrom(d.valid_from)
    setValidUntil(d.valid_until ?? '')
    setUsageLimit(d.usage_limit ? String(d.usage_limit) : '')
    setIsActive(d.is_active)
    setFormErrors({})
    setShowForm(true)
  }

  function validateForm(): DiscountInput | null {
    const errs: Record<string, string> = {}
    const trimmedName = name.trim()
    if (!trimmedName) errs.name = 'Discount name is required.'
    else if (trimmedName.length > 200) errs.name = 'Discount name cannot exceed 200 characters.'

    const normVal = normalizeDecimal(value, 4)
    if (!normVal) {
      errs.value = 'Discount value must be a decimal with 4 fractional digits (e.g. 10.0000).'
    } else {
      const v = validateDecimal4(normVal)
      if (!v.valid) errs.value = v.message!
      else if (discountType === 'percentage') {
        const [w, f] = normVal.split('.')
        const num = parseInt(w, 10)
        if (num > 100 || (num === 100 && f !== '0000')) {
          errs.value = 'Percentage discount cannot exceed 100.0000%.'
        }
      }
    }

    if (!validFrom) {
      errs.validFrom = 'Valid from date is required.'
    }
    if (validFrom && validUntil && validUntil < validFrom) {
      errs.validUntil = 'Valid until date must be on or after valid from date.'
    }

    let normMinPurchase: string | null = null
    if (minPurchase.trim()) {
      normMinPurchase = normalizeDecimal(minPurchase, 2)
      if (!normMinPurchase) {
        errs.minPurchase = 'Minimum purchase must be a 2-decimal amount (e.g. 500.00).'
      } else {
        const v = validateDecimal2(normMinPurchase)
        if (!v.valid) errs.minPurchase = v.message!
      }
    }

    let normMinQty: string | null = null
    if (minQuantity.trim()) {
      normMinQty = normalizeDecimal(minQuantity, 4)
      if (!normMinQty) {
        errs.minQuantity = 'Minimum quantity must be a 4-decimal value (e.g. 1.0000).'
      } else {
        const v = validateDecimal4(normMinQty)
        if (!v.valid) errs.minQuantity = v.message!
      }
    }

    let parsedLimit: number | null = null
    if (usageLimit.trim()) {
      const parsed = parseInt(usageLimit.trim(), 10)
      if (isNaN(parsed) || parsed < 1) {
        errs.usageLimit = 'Usage limit must be a positive integer.'
      } else {
        parsedLimit = parsed
      }
    }

    const pIds = productIds.split(',').map(s => s.trim()).filter(Boolean)
    const sIds = subscriptionIds.split(',').map(s => s.trim()).filter(Boolean)

    setFormErrors(errs)
    if (Object.keys(errs).length > 0) return null

    return {
      name: trimmedName,
      discount_type: discountType,
      value: normVal!,
      currency: discountType === 'fixed' ? 'INR' : null,
      scope,
      product_ids: scope === 'product' ? pIds : [],
      subscription_ids: scope === 'subscription' ? sIds : [],
      minimum_purchase: normMinPurchase,
      minimum_quantity: normMinQty,
      valid_from: validFrom,
      valid_until: validUntil || null,
      usage_limit: parsedLimit,
      is_active: isActive,
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = validateForm()
    if (!payload) return

    if (editingDiscount) {
      const updatePayload: DiscountUpdate = {
        name: payload.name,
        is_active: payload.is_active,
      }
      const action = api.prepare(`/discounts/${editingDiscount.id}`, 'PATCH', updatePayload, editingDiscount.version)
      void sendMutation(action, `Discount "${payload.name}" updated successfully.`, () => {
        setShowForm(false)
        setEditingDiscount(null)
      })
    } else {
      const action = api.prepare('/discounts', 'POST', payload)
      void sendMutation(action, `Discount "${payload.name}" created successfully.`, () => {
        setShowForm(false)
      })
    }
  }

  function toggleDiscountActive(d: Discount) {
    const action = api.prepare(`/discounts/${d.id}`, 'PATCH', { is_active: !d.is_active }, d.version)
    void sendMutation(action, `Discount "${d.name}" marked ${!d.is_active ? 'active' : 'inactive'}.`)
  }

  return (
    <section className="catalog-section" aria-busy={busy}>
      <div className="catalog-header">
        <div>
          <h2>Discount Management</h2>
          <p>Create promotional codes, fixed or percentage discounts, and eligibility thresholds.</p>
        </div>
        <button className="primary-button" disabled={busy} onClick={openCreate}>
          + Create Discount
        </button>
      </div>

      {is501 && (
        <div className="catalog-notice info-501" role="note">
          <div>
            <strong>Discounts API Awaiting Backend Implementation (HTTP 501)</strong>
            <p>
              Discount forms, threshold rules, fixed vs percentage validation, and date bounds are ready for live backend connectivity.
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

      {showForm && (
        <div className="catalog-form-panel">
          <h3>{editingDiscount ? `Edit Discount: ${editingDiscount.name}` : 'New Discount Rule'}</h3>
          <p className="form-subtitle">Define promotional discount criteria, currency restrictions, and scope.</p>

          <form onSubmit={handleSubmit}>
            <div className="catalog-form-grid">
              <div className="catalog-field full-width">
                <label>Discount Name *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Early Bird 20% Off"
                />
                {formErrors.name && <span className="field-error">{formErrors.name}</span>}
              </div>

              <div className="catalog-field">
                <label>Discount Type *</label>
                <select
                  disabled={Boolean(editingDiscount)}
                  value={discountType}
                  onChange={e => setDiscountType(e.target.value as 'fixed' | 'percentage')}
                >
                  <option value="percentage">Percentage (%)</option>
                  <option value="fixed">Fixed Amount (INR)</option>
                </select>
              </div>

              <div className="catalog-field">
                <label>Discount Value (4 decimals) *</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingDiscount)}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={discountType === 'percentage' ? '20.0000' : '150.0000'}
                />
                {editingDiscount && (
                  <span style={{ fontSize: '0.8rem', color: '#586a60' }}>Value is immutable after creation.</span>
                )}
                {formErrors.value && <span className="field-error">{formErrors.value}</span>}
              </div>

              <div className="catalog-field">
                <label>Scope *</label>
                <select
                  disabled={Boolean(editingDiscount)}
                  value={scope}
                  onChange={e => setScope(e.target.value as 'product' | 'subscription')}
                >
                  <option value="product">Product Specific</option>
                  <option value="subscription">Entire Subscription</option>
                </select>
              </div>

              <div className="catalog-field">
                <label>Valid From (date) *</label>
                <input
                  type="date"
                  required
                  disabled={Boolean(editingDiscount)}
                  value={validFrom}
                  onChange={e => setValidFrom(e.target.value)}
                />
                {formErrors.validFrom && <span className="field-error">{formErrors.validFrom}</span>}
              </div>

              <div className="catalog-field">
                <label>Valid Until (optional)</label>
                <input
                  type="date"
                  disabled={Boolean(editingDiscount)}
                  min={validFrom}
                  value={validUntil}
                  onChange={e => setValidUntil(e.target.value)}
                />
                {formErrors.validUntil && <span className="field-error">{formErrors.validUntil}</span>}
              </div>

              <div className="catalog-field">
                <label>Minimum Purchase (INR, 2 decimals, optional)</label>
                <input
                  type="text"
                  disabled={Boolean(editingDiscount)}
                  value={minPurchase}
                  onChange={e => setMinPurchase(e.target.value)}
                  placeholder="e.g. 500.00"
                />
                {formErrors.minPurchase && <span className="field-error">{formErrors.minPurchase}</span>}
              </div>

              <div className="catalog-field">
                <label>Minimum Quantity (4 decimals, optional)</label>
                <input
                  type="text"
                  disabled={Boolean(editingDiscount)}
                  value={minQuantity}
                  onChange={e => setMinQuantity(e.target.value)}
                  placeholder="e.g. 1.0000"
                />
                {formErrors.minQuantity && <span className="field-error">{formErrors.minQuantity}</span>}
              </div>

              <div className="catalog-field">
                <label>Usage Limit (max times, optional)</label>
                <input
                  type="number"
                  min="1"
                  disabled={Boolean(editingDiscount)}
                  value={usageLimit}
                  onChange={e => setUsageLimit(e.target.value)}
                  placeholder="e.g. 100"
                />
                {formErrors.usageLimit && <span className="field-error">{formErrors.usageLimit}</span>}
              </div>

              <div className="catalog-field full-width">
                <label>Eligible products</label>
                {scope === 'product' ? <RecordMultiSelect resource="/products" label="Eligible products" value={productIds} onChange={setProductIds} disabled={Boolean(editingDiscount)} /> : <RecordMultiSelect resource="/subscriptions" label="Eligible subscriptions" value={subscriptionIds} onChange={setSubscriptionIds} disabled={Boolean(editingDiscount)} />}
              </div>

              <div className="catalog-field">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                  />
                  <span>Discount rule is active</span>
                </label>
              </div>
            </div>

            <div className="catalog-form-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setShowForm(false); setEditingDiscount(null) }}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : editingDiscount ? 'Save Changes' : 'Create Discount'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toolbar */}
      <div className="catalog-toolbar">
        <div className="search-field">
          <label>Search Discounts</label>
          <input
            type="search"
            placeholder="Search by discount name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <label>
          Scope
          <select
            value={scopeFilter}
            onChange={e => {
              setScopeFilter(e.target.value as any)
              setLoading(true)
              setPage(1)
            }}
          >
            <option value="all">All Scopes</option>
            <option value="product">Product</option>
            <option value="subscription">Subscription</option>
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
            <option value="all">All Discounts</option>
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
        <p role="status">Loading discounts…</p>
      ) : discounts.length === 0 ? (
        <div className="empty-state">
          <h3>No Discounts Found</h3>
          <p>
            {debouncedSearch || statusFilter !== 'all' || scopeFilter !== 'all'
              ? 'No discounts matched your filters.'
              : is501
                ? 'Discounts endpoint returned HTTP 501. Backend implementation pending.'
                : 'Create promotional discounts to apply fixed or percentage savings.'}
          </p>
          {!is501 && (
            <button className="primary-button" onClick={openCreate}>
              Create Discount
            </button>
          )}
        </div>
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Discount Name</th>
                <th>Type</th>
                <th>Value</th>
                <th>Scope</th>
                <th>Validity Window</th>
                <th>Usage</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map(d => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong></td>
                  <td>
                    <span className={`catalog-badge ${d.discount_type}`}>{d.discount_type}</span>
                  </td>
                  <td>
                    {d.discount_type === 'percentage'
                      ? `${d.value}%`
                      : formatExactMoney(d.value)}
                  </td>
                  <td>{d.scope}</td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {d.valid_from} → {d.valid_until ?? 'Indefinite'}
                  </td>
                  <td style={{ fontSize: '0.85rem' }}>
                    {d.usage_count} / {d.usage_limit ?? '∞'}
                  </td>
                  <td>
                    <span className={`catalog-badge ${d.is_active ? 'active' : 'inactive'}`}>
                      {d.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="action-buttons-cell">
                    <button disabled={busy} onClick={() => openEdit(d)}>Edit</button>
                    <button disabled={busy} onClick={() => toggleDiscountActive(d)}>
                      {d.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
          <span>Page {page} of {totalPages} · {totalCount} discounts</span>
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
