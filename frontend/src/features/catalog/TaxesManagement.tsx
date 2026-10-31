import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage, type PreparedMutation } from '../../api/client'
import type { Tax, TaxInput, TaxListResponse, TaxResponse, TaxUpdate } from '../../api/schema'
import { normalizeDecimal, validateTaxRate } from './decimal'
import './catalog.css'

interface Props {
  onExpired: () => void
}

export default function TaxesManagement({ onExpired }: Props) {
  const [taxes, setTaxes] = useState<Tax[]>([])
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
  const [revision, setRevision] = useState(0)

  // Form
  const [showForm, setShowForm] = useState(false)
  const [editingTax, setEditingTax] = useState<Tax | null>(null)
  const [name, setName] = useState('')
  const [ratePercent, setRatePercent] = useState('18.0000')
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

    api.get<TaxListResponse>('/taxes', query, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setTaxes(result.data)
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
            setError('Tax configuration API is not implemented yet on the backend (HTTP 501). Forms and validation are ready.')
            return
          }
        }
        setError(errorMessage(failure))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [page, debouncedSearch, statusFilter, revision, onExpired])

  async function sendMutation(action: PreparedMutation, successText: string, onDone?: () => void) {
    setPending(action)
    setBusy(true)
    setError(null)
    setSuccessMessage(null)
    try {
      await api.send<TaxResponse>(action)
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
    setEditingTax(null)
    setName('')
    setRatePercent('18.0000')
    setIsActive(true)
    setFormErrors({})
    setShowForm(true)
  }

  function openEdit(tax: Tax) {
    setEditingTax(tax)
    setName(tax.name)
    setRatePercent(tax.rate_percent)
    setIsActive(tax.is_active)
    setFormErrors({})
    setShowForm(true)
  }

  function validateForm(): { name: string; ratePercent: string; isActive: boolean } | null {
    const errs: Record<string, string> = {}
    const trimmedName = name.trim()
    if (!trimmedName) errs.name = 'Tax rule name is required.'
    else if (trimmedName.length > 200) errs.name = 'Tax name cannot exceed 200 characters.'

    const normRate = normalizeDecimal(ratePercent, 4)
    if (!normRate) {
      errs.ratePercent = 'Rate percentage must be a decimal with 4 fractional digits (e.g. 18.0000).'
    } else {
      const v = validateTaxRate(normRate)
      if (!v.valid) errs.ratePercent = v.message!
    }

    setFormErrors(errs)
    if (Object.keys(errs).length > 0) return null
    return { name: trimmedName, ratePercent: normRate!, isActive }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const valid = validateForm()
    if (!valid) return

    if (editingTax) {
      const payload: TaxUpdate = {
        name: valid.name,
        is_active: valid.isActive,
      }
      const action = api.prepare(`/taxes/${editingTax.id}`, 'PATCH', payload, editingTax.version)
      void sendMutation(action, `Tax rule "${valid.name}" updated successfully.`, () => {
        setShowForm(false)
        setEditingTax(null)
      })
    } else {
      const payload: TaxInput = {
        name: valid.name,
        rate_percent: valid.ratePercent,
        is_active: valid.isActive,
      }
      const action = api.prepare('/taxes', 'POST', payload)
      void sendMutation(action, `Tax rule "${valid.name}" created successfully.`, () => {
        setShowForm(false)
      })
    }
  }

  function toggleTaxActive(tax: Tax) {
    const action = api.prepare(`/taxes/${tax.id}`, 'PATCH', { is_active: !tax.is_active }, tax.version)
    void sendMutation(action, `Tax rule "${tax.name}" marked ${!tax.is_active ? 'active' : 'inactive'}.`)
  }

  return (
    <section className="catalog-section" aria-busy={busy}>
      <div className="catalog-header">
        <div>
          <h2>Tax Management</h2>
          <p>Define tax rates, GST schedules, and active rules applicable to products and subscriptions.</p>
        </div>
        <button className="primary-button" disabled={busy} onClick={openCreate}>
          + Add Tax Rule
        </button>
      </div>

      {is501 && (
        <div className="catalog-notice info-501" role="note">
          <div>
            <strong>Tax Management Awaiting Backend Implementation (HTTP 501)</strong>
            <p>
              Tax rule forms, rate percentage validation (0.0000% - 100.0000%), and immutable rate constraints are verified and ready.
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
          <h3>{editingTax ? `Edit Tax Rule: ${editingTax.name}` : 'New Tax Rule'}</h3>
          <p className="form-subtitle">Enter tax name and 4-decimal rate percentage (e.g. 18.0000 for 18% GST).</p>

          <form onSubmit={handleSubmit}>
            <div className="catalog-form-grid">
              <div className="catalog-field full-width">
                <label>Tax Name *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. GST 18% (Standard)"
                />
                {formErrors.name && <span className="field-error">{formErrors.name}</span>}
              </div>

              <div className="catalog-field">
                <label>Tax Rate (% with 4 decimals) *</label>
                <input
                  type="text"
                  required
                  disabled={Boolean(editingTax)}
                  value={ratePercent}
                  onChange={e => setRatePercent(e.target.value)}
                  placeholder="18.0000"
                />
                {editingTax && (
                  <span style={{ fontSize: '0.8rem', color: '#586a60' }}>
                    Note: Per financial audit rules, tax rate is immutable once created.
                  </span>
                )}
                {formErrors.ratePercent && <span className="field-error">{formErrors.ratePercent}</span>}
              </div>

              <div className="catalog-field">
                <label className="checkbox-field" style={{ marginTop: 24 }}>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                  />
                  <span>Tax rule is active and applicable to new line items</span>
                </label>
              </div>
            </div>

            <div className="catalog-form-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setShowForm(false); setEditingTax(null) }}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : editingTax ? 'Save Changes' : 'Create Tax Rule'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Toolbar / Filters */}
      <div className="catalog-toolbar">
        <div className="search-field">
          <label>Search Taxes</label>
          <input
            type="search"
            placeholder="Search by tax name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

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
            <option value="all">All Taxes</option>
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

      {/* Listing */}
      {loading ? (
        <p role="status">Loading taxes…</p>
      ) : taxes.length === 0 ? (
        <div className="empty-state">
          <h3>No Tax Rules Found</h3>
          <p>
            {debouncedSearch || statusFilter !== 'all'
              ? 'No taxes matched your filter.'
              : is501
                ? 'Tax rules endpoint returned HTTP 501. Backend implementation pending.'
                : 'Configure tax rules to automatically calculate invoice taxes.'}
          </p>
          {!is501 && (
            <button className="primary-button" onClick={openCreate}>
              Add Tax Rule
            </button>
          )}
        </div>
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Tax Rule Name</th>
                <th>Rate (%)</th>
                <th>Status</th>
                <th>Version</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {taxes.map(t => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td><strong>{t.rate_percent}%</strong></td>
                  <td>
                    <span className={`catalog-badge ${t.is_active ? 'active' : 'inactive'}`}>
                      {t.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>v{t.version}</td>
                  <td className="action-buttons-cell">
                    <button disabled={busy} onClick={() => openEdit(t)}>Edit</button>
                    <button disabled={busy} onClick={() => toggleTaxActive(t)}>
                      {t.is_active ? 'Deactivate' : 'Activate'}
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
          <span>Page {page} of {totalPages} · {totalCount} taxes</span>
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
