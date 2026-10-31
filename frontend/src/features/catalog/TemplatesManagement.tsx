import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage, type PreparedMutation } from '../../api/client'
import type { Template, TemplateInput, TemplateLineInput, TemplateListResponse, TemplateResponse, TemplateUpdate } from '../../api/schema'
import { formatExactMoney, normalizeDecimal, validateDecimal4 } from './decimal'
import './catalog.css'

interface Props {
  onExpired: () => void
}

export default function TemplatesManagement({ onExpired }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
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

  // Details (derived) & Form
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const selectedTemplate = templates.find(t => t.id === selectedTemplateId) ?? null

  const [showForm, setShowForm] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null)

  // Form Fields
  const [name, setName] = useState('')
  const [planId, setPlanId] = useState('')
  const [validityDays, setValidityDays] = useState('30')
  const [isActive, setIsActive] = useState(true)
  const [lines, setLines] = useState<TemplateLineInput[]>([
    { product_id: '', variant_id: null, quantity: '1.0000', unit_price: '100.0000' },
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

    api.get<TemplateListResponse>('/quotation-templates', query, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setTemplates(result.data)
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
            setError('Quotation templates API is not implemented yet on the backend (HTTP 501). Template setup and configuration screens are ready.')
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
      await api.send<TemplateResponse>(action)
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
    setEditingTemplate(null)
    setName('')
    setPlanId('')
    setValidityDays('30')
    setIsActive(true)
    setLines([{ product_id: '', variant_id: null, quantity: '1.0000', unit_price: '100.0000' }])
    setFormErrors({})
    setShowForm(true)
    setSelectedTemplateId(null)
  }

  function openEdit(tpl: Template) {
    setEditingTemplate(tpl)
    setName(tpl.name)
    setPlanId(tpl.plan_id)
    setValidityDays(String(tpl.validity_days))
    setIsActive(tpl.is_active)
    setLines(
      tpl.lines && tpl.lines.length > 0
        ? tpl.lines.map(l => ({ ...l }))
        : [{ product_id: '', variant_id: null, quantity: '1.0000', unit_price: '100.0000' }]
    )
    setFormErrors({})
    setShowForm(true)
  }

  function addLine() {
    setLines([
      ...lines,
      { product_id: '', variant_id: null, quantity: '1.0000', unit_price: '100.0000' },
    ])
  }

  function removeLine(idx: number) {
    if (lines.length <= 1) return
    setLines(lines.filter((_, i) => i !== idx))
  }

  function updateLine(idx: number, updates: Partial<TemplateLineInput>) {
    setLines(lines.map((l, i) => (i === idx ? { ...l, ...updates } : l)))
  }

  function validateForm(): TemplateInput | null {
    const errs: Record<string, string> = {}
    const trimmedName = name.trim()
    if (!trimmedName) errs.name = 'Template name is required.'
    else if (trimmedName.length > 200) errs.name = 'Template name cannot exceed 200 characters.'

    const trimmedPlanId = planId.trim()
    if (!trimmedPlanId) errs.planId = 'Base Plan UUID is required.'

    const days = parseInt(validityDays.trim(), 10)
    if (isNaN(days) || days < 1 || days > 365) {
      errs.validityDays = 'Validity days must be an integer between 1 and 365.'
    }

    const validLines: TemplateLineInput[] = []
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]
      const pid = l.product_id.trim()
      if (!pid) errs[`prod_${i}`] = 'Product UUID is required.'

      const normQty = normalizeDecimal(l.quantity, 4)
      if (!normQty) errs[`qty_${i}`] = 'Quantity must be a valid 4-decimal value > 0.'
      else {
        const v = validateDecimal4(normQty)
        if (!v.valid) errs[`qty_${i}`] = v.message!
      }

      const normPrice = normalizeDecimal(l.unit_price, 4)
      if (!normPrice) errs[`price_${i}`] = 'Unit price must be a valid 4-decimal value.'
      else {
        const v = validateDecimal4(normPrice)
        if (!v.valid) errs[`price_${i}`] = v.message!
      }

      if (pid && normQty && normPrice) {
        validLines.push({
          product_id: pid,
          variant_id: l.variant_id?.trim() || null,
          quantity: normQty,
          unit_price: normPrice,
        })
      }
    }

    if (validLines.length === 0) {
      errs.lines = 'At least one quotation line item is required.'
    }

    setFormErrors(errs)
    if (Object.keys(errs).length > 0) return null

    return {
      name: trimmedName,
      plan_id: trimmedPlanId,
      validity_days: days,
      is_active: isActive,
      lines: validLines,
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = validateForm()
    if (!payload) return

    if (editingTemplate) {
      const updatePayload: TemplateUpdate = {
        name: payload.name,
        plan_id: payload.plan_id,
        validity_days: payload.validity_days,
        is_active: payload.is_active,
        lines: payload.lines,
      }
      const action = api.prepare(`/quotation-templates/${editingTemplate.id}`, 'PATCH', updatePayload, editingTemplate.version)
      void sendMutation(action, `Template "${payload.name}" updated successfully.`, () => {
        setShowForm(false)
        setEditingTemplate(null)
      })
    } else {
      const action = api.prepare('/quotation-templates', 'POST', payload)
      void sendMutation(action, `Template "${payload.name}" created successfully.`, () => {
        setShowForm(false)
      })
    }
  }

  function toggleTemplateActive(tpl: Template) {
    const action = api.prepare(`/quotation-templates/${tpl.id}`, 'PATCH', { is_active: !tpl.is_active }, tpl.version)
    void sendMutation(action, `Template "${tpl.name}" marked ${!tpl.is_active ? 'active' : 'inactive'}.`)
  }

  return (
    <section className="catalog-section" aria-busy={busy}>
      <div className="catalog-header">
        <div>
          <h2>Quotation Templates</h2>
          <p>Standardize proposal packages with pre-selected plans, default lines, and validity terms.</p>
        </div>
        <button className="primary-button" disabled={busy} onClick={openCreate}>
          + Create Template
        </button>
      </div>

      {is501 && (
        <div className="catalog-notice info-501" role="note">
          <div>
            <strong>Quotation Templates Awaiting Backend Implementation (HTTP 501)</strong>
            <p>
              Template builder, plan association, pre-configured line items, and validity duration forms are fully implemented and awaiting backend support.
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
          <h3>{editingTemplate ? `Edit Template: ${editingTemplate.name}` : 'New Quotation Template'}</h3>
          <p className="form-subtitle">Configure base plan, proposal validity duration (1-365 days), and default item lines.</p>

          <form onSubmit={handleSubmit}>
            <div className="catalog-form-grid">
              <div className="catalog-field full-width">
                <label>Template Name *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Standard Enterprise Onboarding"
                />
                {formErrors.name && <span className="field-error">{formErrors.name}</span>}
              </div>

              <div className="catalog-field">
                <label>Base Plan UUID *</label>
                <input
                  type="text"
                  required
                  value={planId}
                  onChange={e => setPlanId(e.target.value)}
                  placeholder="UUID of base subscription plan"
                />
                {formErrors.planId && <span className="field-error">{formErrors.planId}</span>}
              </div>

              <div className="catalog-field">
                <label>Validity Days (1–365) *</label>
                <input
                  type="number"
                  min="1"
                  max="365"
                  required
                  value={validityDays}
                  onChange={e => setValidityDays(e.target.value)}
                />
                {formErrors.validityDays && <span className="field-error">{formErrors.validityDays}</span>}
              </div>

              <div className="catalog-field">
                <label className="checkbox-field" style={{ marginTop: 24 }}>
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={e => setIsActive(e.target.checked)}
                  />
                  <span>Template is active and selectable for quotations</span>
                </label>
              </div>
            </div>

            {/* Template line items */}
            <div style={{ marginTop: 16, borderTop: '1px solid #e1ebe4', paddingTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h4 style={{ margin: 0, color: '#153d2d' }}>Pre-configured Line Items *</h4>
                <button type="button" onClick={addLine}>+ Add Line Item</button>
              </div>
              {formErrors.lines && <p className="field-error">{formErrors.lines}</p>}

              {lines.map((line, idx) => (
                <div key={idx} className="line-item-row" style={{ gridTemplateColumns: '2fr 2fr 1fr 1fr auto' }}>
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="Product UUID"
                      value={line.product_id}
                      onChange={e => updateLine(idx, { product_id: e.target.value })}
                    />
                    {formErrors[`prod_${idx}`] && <span className="field-error">{formErrors[`prod_${idx}`]}</span>}
                  </div>
                  <div>
                    <input
                      type="text"
                      placeholder="Variant UUID (optional)"
                      value={line.variant_id ?? ''}
                      onChange={e => updateLine(idx, { variant_id: e.target.value || null })}
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="Qty (4 dec)"
                      value={line.quantity}
                      onChange={e => updateLine(idx, { quantity: e.target.value })}
                    />
                    {formErrors[`qty_${idx}`] && <span className="field-error">{formErrors[`qty_${idx}`]}</span>}
                  </div>
                  <div>
                    <input
                      type="text"
                      required
                      placeholder="Price (4 dec)"
                      value={line.unit_price}
                      onChange={e => updateLine(idx, { unit_price: e.target.value })}
                    />
                    {formErrors[`price_${idx}`] && <span className="field-error">{formErrors[`price_${idx}`]}</span>}
                  </div>
                  <div>
                    {lines.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
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
                onClick={() => { setShowForm(false); setEditingTemplate(null) }}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : editingTemplate ? 'Save Changes' : 'Create Template'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Selected Template Details */}
      {selectedTemplate && (
        <div className="catalog-details-card">
          <div className="catalog-details-header">
            <div>
              <h3>{selectedTemplate.name}</h3>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <span className="catalog-badge fixed">{selectedTemplate.validity_days} days validity</span>
                <span className={`catalog-badge ${selectedTemplate.is_active ? 'active' : 'inactive'}`}>
                  {selectedTemplate.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={busy} onClick={() => openEdit(selectedTemplate)}>Edit Template</button>
              <button disabled={busy} onClick={() => setSelectedTemplateId(null)}>Close Details</button>
            </div>
          </div>

          <div className="catalog-details-grid">
            <div className="detail-item">
              <strong>Base Plan ID</strong>
              <span style={{ fontSize: '0.85rem', wordBreak: 'break-all' }}>{selectedTemplate.plan_id}</span>
            </div>
            <div className="detail-item">
              <strong>Validity Duration</strong>
              <span>{selectedTemplate.validity_days} Days</span>
            </div>
            <div className="detail-item">
              <strong>Included Lines</strong>
              <span>{selectedTemplate.lines?.length ?? 0} item lines</span>
            </div>
            <div className="detail-item">
              <strong>Version</strong>
              <span>v{selectedTemplate.version}</span>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <h4 style={{ margin: '0 0 8px 0' }}>Pre-configured Line Items</h4>
            <div className="panel table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Product ID</th>
                    <th>Variant ID</th>
                    <th>Default Quantity</th>
                    <th>Unit Price</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTemplate.lines?.map((l, idx) => (
                    <tr key={idx}>
                      <td style={{ fontSize: '0.85rem' }}>{l.product_id}</td>
                      <td style={{ fontSize: '0.85rem' }}>{l.variant_id ?? 'None'}</td>
                      <td>{l.quantity}</td>
                      <td>{formatExactMoney(l.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="catalog-toolbar">
        <div className="search-field">
          <label>Search Templates</label>
          <input
            type="search"
            placeholder="Search by template name..."
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
            <option value="all">All Templates</option>
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
        <p role="status">Loading quotation templates…</p>
      ) : templates.length === 0 ? (
        <div className="empty-state">
          <h3>No Templates Found</h3>
          <p>
            {debouncedSearch || statusFilter !== 'all'
              ? 'No templates matched your filters.'
              : is501
                ? 'Quotation templates endpoint returned HTTP 501. Backend implementation pending.'
                : 'Create reusable templates to quickly assemble standardized quotes.'}
          </p>
          {!is501 && (
            <button className="primary-button" onClick={openCreate}>
              Create Template
            </button>
          )}
        </div>
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Template Name</th>
                <th>Base Plan ID</th>
                <th>Validity</th>
                <th>Lines</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {templates.map(tpl => (
                <tr key={tpl.id}>
                  <td>
                    <button
                      className="text-button"
                      style={{ textAlign: 'left', fontWeight: 600 }}
                      onClick={() => setSelectedTemplateId(tpl.id)}
                    >
                      {tpl.name}
                    </button>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: '#586a60' }}>{tpl.plan_id.slice(0, 8)}…</td>
                  <td>{tpl.validity_days} days</td>
                  <td>{tpl.lines?.length ?? 0} lines</td>
                  <td>
                    <span className={`catalog-badge ${tpl.is_active ? 'active' : 'inactive'}`}>
                      {tpl.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="action-buttons-cell">
                    <button disabled={busy} onClick={() => setSelectedTemplateId(tpl.id)}>Details</button>
                    <button disabled={busy} onClick={() => openEdit(tpl)}>Edit</button>
                    <button disabled={busy} onClick={() => toggleTemplateActive(tpl)}>
                      {tpl.is_active ? 'Deactivate' : 'Activate'}
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
          <span>Page {page} of {totalPages} · {totalCount} templates</span>
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
