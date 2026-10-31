import RecordMultiSelect from './RecordMultiSelect'
import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage, type PreparedMutation } from '../../api/client'
import type { Product, ProductInput, ProductListResponse, ProductResponse, ProductUpdate, Variant, VariantInput, VariantResponse, VariantUpdate } from '../../api/schema'
import { formatExactMoney, normalizeDecimal, validateDecimal4 } from './decimal'
import './catalog.css'

interface Props {
  onExpired: () => void
}

export default function ProductsManagement({ onExpired }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [is501, setIs501] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PreparedMutation | null>(null)

  // Filtering & Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [revision, setRevision] = useState(0)

  // Selection & Details (derived from products)
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null)
  const selectedProduct = products.find(p => p.id === selectedProductId) ?? null

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)

  // Variant subform
  const [showVariantForm, setShowVariantForm] = useState(false)
  const [editingVariant, setEditingVariant] = useState<Variant | null>(null)
  const [variantName, setVariantName] = useState('')
  const [variantPriceAdj, setVariantPriceAdj] = useState('0.0000')
  const [variantIsActive, setVariantIsActive] = useState(true)
  const [variantAttrKey, setVariantAttrKey] = useState('')
  const [variantAttrVal, setVariantAttrVal] = useState('')
  const [variantAttrs, setVariantAttrs] = useState<Record<string, string>>({})
  const [variantError, setVariantError] = useState<string | null>(null)

  // Product Form fields
  const [formName, setFormName] = useState('')
  const [formType, setFormType] = useState<'service' | 'goods'>('service')
  const [formSalesPrice, setFormSalesPrice] = useState('100.0000')
  const [formCostPrice, setFormCostPrice] = useState('50.0000')
  const [formNotes, setFormNotes] = useState('')
  const [formTaxIds, setFormTaxIds] = useState('')
  const [formIsActive, setFormIsActive] = useState(true)
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Load products
  useEffect(() => {
    const controller = new AbortController()

    const query: Record<string, string | number | boolean | undefined> = {
      page,
      page_size: 20,
    }
    if (debouncedSearch) query.q = debouncedSearch
    if (statusFilter === 'active') query.is_active = true
    if (statusFilter === 'inactive') query.is_active = false

    api.get<ProductListResponse>('/products', query, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setProducts(result.data)
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
            setError('The product catalog API is not implemented yet on the backend (HTTP 501). Catalog management screens are ready and will reflect live data once backend routes are connected.')
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
      await api.send<ProductResponse | VariantResponse>(action)
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

  function openCreateForm() {
    setEditingProduct(null)
    setFormName('')
    setFormType('service')
    setFormSalesPrice('100.0000')
    setFormCostPrice('50.0000')
    setFormNotes('')
    setFormTaxIds('')
    setFormIsActive(true)
    setFormErrors({})
    setShowCreateForm(true)
    setSelectedProductId(null)
  }

  function openEditForm(prod: Product) {
    setEditingProduct(prod)
    setFormName(prod.name)
    setFormType(prod.product_type)
    setFormSalesPrice(prod.sales_price)
    setFormCostPrice(prod.cost_price ?? '0.0000')
    setFormNotes(prod.notes ?? '')
    setFormTaxIds((prod.tax_ids ?? []).join(', '))
    setFormIsActive(prod.is_active)
    setFormErrors({})
    setShowCreateForm(true)
  }

  function validateProductForm(): ProductInput | null {
    const errs: Record<string, string> = {}
    const trimmedName = formName.trim()
    if (!trimmedName) errs.name = 'Product name is required.'
    else if (trimmedName.length > 200) errs.name = 'Product name cannot exceed 200 characters.'

    const normSales = normalizeDecimal(formSalesPrice, 4)
    if (!normSales) {
      errs.sales_price = 'Sales price must be a valid non-negative decimal with 4 fractional digits (e.g. 100.0000).'
    } else {
      const v = validateDecimal4(normSales)
      if (!v.valid) errs.sales_price = v.message!
    }

    const normCost = normalizeDecimal(formCostPrice, 4)
    if (!normCost) {
      errs.cost_price = 'Cost price must be a valid non-negative decimal with 4 fractional digits (e.g. 50.0000).'
    } else {
      const v = validateDecimal4(normCost)
      if (!v.valid) errs.cost_price = v.message!
    }

    if (formNotes.length > 2000) {
      errs.notes = 'Notes cannot exceed 2000 characters.'
    }

    const taxIds = formTaxIds.split(',')
      .map(t => t.trim())
      .filter(Boolean)

    setFormErrors(errs)
    if (Object.keys(errs).length > 0) return null

    return {
      name: trimmedName,
      product_type: formType,
      sales_price: normSales!,
      cost_price: normCost!,
      notes: formNotes.trim() || null,
      tax_ids: taxIds,
      is_active: formIsActive,
    }
  }

  function handleProductSubmit(e: FormEvent) {
    e.preventDefault()
    const payload = validateProductForm()
    if (!payload) return

    if (editingProduct) {
      const updatePayload: ProductUpdate = {
        name: payload.name,
        product_type: payload.product_type,
        sales_price: payload.sales_price,
        cost_price: payload.cost_price,
        notes: payload.notes,
        tax_ids: payload.tax_ids,
        is_active: payload.is_active,
      }
      const action = api.prepare(`/products/${editingProduct.id}`, 'PATCH', updatePayload, editingProduct.version)
      void sendMutation(action, `Product "${payload.name}" updated successfully.`, () => {
        setShowCreateForm(false)
        setEditingProduct(null)
      })
    } else {
      const action = api.prepare('/products', 'POST', payload)
      void sendMutation(action, `Product "${payload.name}" created successfully.`, () => {
        setShowCreateForm(false)
      })
    }
  }

  function toggleProductActive(product: Product) {
    const action = api.prepare(`/products/${product.id}`, 'PATCH', { is_active: !product.is_active }, product.version)
    void sendMutation(action, `Product "${product.name}" marked ${!product.is_active ? 'active' : 'inactive'}.`)
  }

  // Variant functions
  function openCreateVariant() {
    setEditingVariant(null)
    setVariantName('')
    setVariantPriceAdj('0.0000')
    setVariantIsActive(true)
    setVariantAttrs({})
    setVariantAttrKey('')
    setVariantAttrVal('')
    setVariantError(null)
    setShowVariantForm(true)
  }

  function openEditVariant(v: Variant) {
    setEditingVariant(v)
    setVariantName(v.name)
    setVariantPriceAdj(v.price_adjustment)
    setVariantIsActive(v.is_active)
    setVariantAttrs(v.attributes ?? {})
    setVariantAttrKey('')
    setVariantAttrVal('')
    setVariantError(null)
    setShowVariantForm(true)
  }

  function addAttribute() {
    const k = variantAttrKey.trim()
    const val = variantAttrVal.trim()
    if (!k || !val) return
    if (Object.keys(variantAttrs).length >= 10) {
      setVariantError('A variant cannot have more than 10 attributes.')
      return
    }
    setVariantAttrs({ ...variantAttrs, [k]: val })
    setVariantAttrKey('')
    setVariantAttrVal('')
    setVariantError(null)
  }

  function removeAttribute(k: string) {
    const copy = { ...variantAttrs }
    delete copy[k]
    setVariantAttrs(copy)
  }

  function handleVariantSubmit(e: FormEvent) {
    e.preventDefault()
    if (!selectedProduct) return
    const trimmedName = variantName.trim()
    if (!trimmedName) {
      setVariantError('Variant name is required.')
      return
    }
    const normAdj = normalizeDecimal(variantPriceAdj, 4, true)
    if (!normAdj) {
      setVariantError('Price adjustment must be a decimal with 4 fractional digits (e.g. 15.0000 or -10.0000).')
      return
    }
    const check = validateDecimal4(normAdj, true)
    if (!check.valid) {
      setVariantError(check.message!)
      return
    }

    if (editingVariant) {
      const payload: VariantUpdate = {
        name: trimmedName,
        attributes: variantAttrs,
        price_adjustment: normAdj,
        is_active: variantIsActive,
      }
      const action = api.prepare(`/products/${selectedProduct.id}/variants/${editingVariant.id}`, 'PATCH', payload, editingVariant.version)
      void sendMutation(action, `Variant "${trimmedName}" updated.`, () => {
        setShowVariantForm(false)
        setEditingVariant(null)
      })
    } else {
      const payload: VariantInput = {
        name: trimmedName,
        attributes: variantAttrs,
        price_adjustment: normAdj,
        is_active: variantIsActive,
      }
      const action = api.prepare(`/products/${selectedProduct.id}/variants`, 'POST', payload)
      void sendMutation(action, `Variant "${trimmedName}" created.`, () => {
        setShowVariantForm(false)
      })
    }
  }

  return (
    <section className="catalog-section" aria-busy={busy}>
      <div className="catalog-header">
        <div>
          <h2>Products & Variants</h2>
          <p>Manage subscription products, pricing, tax association, and variant configurations.</p>
        </div>
        <button
          className="primary-button"
          disabled={busy}
          onClick={openCreateForm}
        >
          + Add Product
        </button>
      </div>

      {is501 && (
        <div className="catalog-notice info-501" role="note">
          <div>
            <strong>Product Catalog Awaiting Backend Implementation (HTTP 501)</strong>
            <p>
              The frontend screens, forms, client mutations, and decimal validation are complete per the agreed OpenAPI contract. Live records will populate once the backend catalog module is deployed.
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

      {/* Product Form Panel */}
      {showCreateForm && (
        <div className="catalog-form-panel">
          <h3>{editingProduct ? `Edit Product: ${editingProduct.name}` : 'Create New Product'}</h3>
          <p className="form-subtitle">Enter product details with exact decimal pricing (INR).</p>

          <form onSubmit={handleProductSubmit}>
            <div className="catalog-form-grid">
              <div className="catalog-field full-width">
                <label>Product Name *</label>
                <input
                  type="text"
                  required
                  maxLength={200}
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Cloud Security Suite"
                />
                {formErrors.name && <span className="field-error">{formErrors.name}</span>}
              </div>

              <div className="catalog-field">
                <label>Product Type *</label>
                <select
                  value={formType}
                  onChange={e => setFormType(e.target.value as 'service' | 'goods')}
                >
                  <option value="service">Service</option>
                  <option value="goods">Goods</option>
                </select>
              </div>

              <div className="catalog-field">
                <label>Sales Price (INR, 4 decimals) *</label>
                <input
                  type="text"
                  required
                  value={formSalesPrice}
                  onChange={e => setFormSalesPrice(e.target.value)}
                  placeholder="100.0000"
                />
                {formErrors.sales_price && <span className="field-error">{formErrors.sales_price}</span>}
              </div>

              <div className="catalog-field">
                <label>Cost Price (INR, 4 decimals) *</label>
                <input
                  type="text"
                  required
                  value={formCostPrice}
                  onChange={e => setFormCostPrice(e.target.value)}
                  placeholder="50.0000"
                />
                {formErrors.cost_price && <span className="field-error">{formErrors.cost_price}</span>}
              </div>

              <div className="catalog-field">
                <label>Applicable taxes</label>
                <RecordMultiSelect resource="/taxes" label="Taxes" value={formTaxIds} onChange={setFormTaxIds} />
              </div>

              <div className="catalog-field full-width">
                <label>Internal Notes (optional)</label>
                <textarea
                  maxLength={2000}
                  value={formNotes}
                  onChange={e => setFormNotes(e.target.value)}
                  placeholder="Internal description, SLA, or provisioning notes..."
                />
                {formErrors.notes && <span className="field-error">{formErrors.notes}</span>}
              </div>

              <div className="catalog-field">
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={formIsActive}
                    onChange={e => setFormIsActive(e.target.checked)}
                  />
                  <span>Product is active and available for quotation</span>
                </label>
              </div>
            </div>

            <div className="catalog-form-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setShowCreateForm(false); setEditingProduct(null) }}
              >
                Cancel
              </button>
              <button className="primary-button" disabled={busy}>
                {busy ? 'Saving…' : editingProduct ? 'Save Changes' : 'Create Product'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Product Details & Variant Management Drawer */}
      {selectedProduct && (
        <div className="catalog-details-card">
          <div className="catalog-details-header">
            <div>
              <h3>{selectedProduct.name}</h3>
              <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                <span className={`catalog-badge ${selectedProduct.product_type}`}>{selectedProduct.product_type}</span>
                <span className={`catalog-badge ${selectedProduct.is_active ? 'active' : 'inactive'}`}>
                  {selectedProduct.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button disabled={busy} onClick={() => openEditForm(selectedProduct)}>Edit Product</button>
              <button disabled={busy} onClick={() => setSelectedProductId(null)}>Close Details</button>
            </div>
          </div>

          <div className="catalog-details-grid">
            <div className="detail-item">
              <strong>Sales Price</strong>
              <span>{formatExactMoney(selectedProduct.sales_price)}</span>
            </div>
            <div className="detail-item">
              <strong>Cost Price</strong>
              <span>{formatExactMoney(selectedProduct.cost_price ?? '0.0000')}</span>
            </div>
            <div className="detail-item">
              <strong>Tax Rules</strong>
              <span>{selectedProduct.tax_ids?.length ? `${selectedProduct.tax_ids.length} taxes assigned` : 'None'}</span>
            </div>
            <div className="detail-item">
              <strong>Version</strong>
              <span>v{selectedProduct.version}</span>
            </div>
          </div>

          {selectedProduct.notes && (
            <p><strong>Notes:</strong> {selectedProduct.notes}</p>
          )}

          {/* Variants section */}
          <div className="variant-box">
            <div className="variant-box-header">
              <div>
                <h4 style={{ margin: 0 }}>Product Variants ({selectedProduct.variants?.length ?? 0})</h4>
                <p style={{ margin: '2px 0 0', fontSize: '0.85rem', color: '#586a60' }}>
                  Specific configurations and price adjustments for {selectedProduct.name}.
                </p>
              </div>
              <button
                disabled={busy}
                onClick={openCreateVariant}
              >
                + Add Variant
              </button>
            </div>

            {showVariantForm && (
              <div className="variant-subform">
                <h5>{editingVariant ? `Edit Variant: ${editingVariant.name}` : 'New Product Variant'}</h5>
                {variantError && <p className="field-error">{variantError}</p>}
                <form onSubmit={handleVariantSubmit}>
                  <div className="catalog-form-grid">
                    <div className="catalog-field">
                      <label>Variant Name *</label>
                      <input
                        type="text"
                        required
                        maxLength={200}
                        value={variantName}
                        onChange={e => setVariantName(e.target.value)}
                        placeholder="e.g. 50 Seats / Enterprise"
                      />
                    </div>
                    <div className="catalog-field">
                      <label>Price Adjustment (e.g. +20.0000 or -5.0000)</label>
                      <input
                        type="text"
                        required
                        value={variantPriceAdj}
                        onChange={e => setVariantPriceAdj(e.target.value)}
                        placeholder="0.0000"
                      />
                    </div>
                    <div className="catalog-field">
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={variantIsActive}
                          onChange={e => setVariantIsActive(e.target.checked)}
                        />
                        <span>Variant is active</span>
                      </label>
                    </div>
                  </div>

                  {/* Attributes builder */}
                  <div style={{ marginTop: 12 }}>
                    <label style={{ fontWeight: 600, fontSize: '0.88rem' }}>Attributes (Key-Value, max 10)</label>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6, marginBottom: 8 }}>
                      <input
                        type="text"
                        placeholder="Key (e.g. size)"
                        value={variantAttrKey}
                        onChange={e => setVariantAttrKey(e.target.value)}
                        style={{ width: 140 }}
                      />
                      <input
                        type="text"
                        placeholder="Value (e.g. Large)"
                        value={variantAttrVal}
                        onChange={e => setVariantAttrVal(e.target.value)}
                        style={{ width: 140 }}
                      />
                      <button type="button" onClick={addAttribute}>Add Attribute</button>
                    </div>
                    <div>
                      {Object.entries(variantAttrs).map(([k, v]) => (
                        <span key={k} className="attribute-tag">
                          {k}: {v} <button type="button" onClick={() => removeAttribute(k)} style={{ border: 0, background: 'none', cursor: 'pointer', padding: 0, marginLeft: 4 }}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="catalog-form-actions">
                    <button type="button" onClick={() => setShowVariantForm(false)}>Cancel</button>
                    <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : editingVariant ? 'Update Variant' : 'Create Variant'}</button>
                  </div>
                </form>
              </div>
            )}

            {(!selectedProduct.variants || selectedProduct.variants.length === 0) ? (
              <p style={{ color: '#586a60', fontStyle: 'italic' }}>No variants created for this product yet.</p>
            ) : (
              <div className="panel table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Variant Name</th>
                      <th>Attributes</th>
                      <th>Price Adjustment</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedProduct.variants.map(v => (
                      <tr key={v.id}>
                        <td><strong>{v.name}</strong></td>
                        <td>
                          {v.attributes && Object.keys(v.attributes).length > 0 ? (
                            Object.entries(v.attributes).map(([k, val]) => (
                              <span key={k} className="attribute-tag">{k}: {val}</span>
                            ))
                          ) : '—'}
                        </td>
                        <td>{formatExactMoney(v.price_adjustment)}</td>
                        <td>
                          <span className={`catalog-badge ${v.is_active ? 'active' : 'inactive'}`}>
                            {v.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="action-buttons-cell">
                          <button disabled={busy} onClick={() => openEditVariant(v)}>Edit</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toolbar / Filters */}
      <div className="catalog-toolbar">
        <div className="search-field">
          <label>Search Products</label>
          <input
            type="search"
            placeholder="Search by product name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <label>
          Status Filter
          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')
              setLoading(true)
              setPage(1)
            }}
          >
            <option value="all">All Products</option>
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
        <p role="status">Loading products…</p>
      ) : products.length === 0 ? (
        <div className="empty-state">
          <h3>No Products Found</h3>
          <p>
            {debouncedSearch || statusFilter !== 'all'
              ? 'No products matched your search filters. Try adjusting your query.'
              : is501
                ? 'Product catalog endpoint returned HTTP 501. Backend implementation pending.'
                : 'Get started by creating your first subscription product.'}
          </p>
          {!is501 && (
            <button className="primary-button" onClick={openCreateForm}>
              Create Product
            </button>
          )}
        </div>
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Product Name</th>
                <th>Type</th>
                <th>Sales Price</th>
                <th>Cost Price</th>
                <th>Variants</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {products.map(prod => (
                <tr key={prod.id}>
                  <td>
                    <button
                      className="text-button"
                      style={{ textAlign: 'left', fontWeight: 600 }}
                      onClick={() => setSelectedProductId(prod.id)}
                    >
                      {prod.name}
                    </button>
                  </td>
                  <td>
                    <span className={`catalog-badge ${prod.product_type}`}>{prod.product_type}</span>
                  </td>
                  <td>{formatExactMoney(prod.sales_price)}</td>
                  <td>{formatExactMoney(prod.cost_price ?? '0.0000')}</td>
                  <td>{prod.variants?.length ?? 0} variants</td>
                  <td>
                    <span className={`catalog-badge ${prod.is_active ? 'active' : 'inactive'}`}>
                      {prod.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="action-buttons-cell">
                    <button
                      disabled={busy}
                      onClick={() => setSelectedProductId(prod.id)}
                    >
                      Details & Variants
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => openEditForm(prod)}
                    >
                      Edit
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => toggleProductActive(prod)}
                    >
                      {prod.is_active ? 'Deactivate' : 'Activate'}
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
          <span>Page {page} of {totalPages} · {totalCount} products</span>
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
