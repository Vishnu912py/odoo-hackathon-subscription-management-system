import { useEffect, useState } from 'react'
import { api, ApiError, errorMessage } from '../../api/client'
import { money } from '../../api/format'
import type { Session, SubscriptionSummary, SubscriptionSummaryListResponse } from '../../api/schema'
import SubscriptionDetails from './SubscriptionDetails'
import CreateSubscription from './CreateSubscription'
import './subscriptions.css'

interface Props {
  session: Session
  onSelectInvoice: (invoiceId: string) => void
  onExpired: () => void
}

export default function SubscriptionsManagement({ session, onSelectInvoice, onExpired }: Props) {
  const [rows, setRows] = useState<SubscriptionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  // Filters & Pagination
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [pausedFilter, setPausedFilter] = useState<'all' | 'true' | 'false'>('all')
  const [customerFilter, setCustomerFilter] = useState('')
  const [planFilter, setPlanFilter] = useState('')
  const [sortBy, setSortBy] = useState<'created_at' | 'number' | 'next_billing_date'>('created_at')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')

  // Selected subscription for details view
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState<string | null>(null)

  // Create form modal state
  const [showCreateForm, setShowCreateForm] = useState(false)

  const role = session.user.role
  const isCustomer = role === 'customer'

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim())
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Load subscriptions
  useEffect(() => {
    const controller = new AbortController()

    const query: Record<string, string | number | boolean | undefined> = {
      page,
      page_size: 20,
      sort_by: sortBy,
      sort_order: sortOrder,
    }
    if (debouncedSearch) query.q = debouncedSearch
    if (statusFilter !== 'all') query.status = statusFilter
    if (pausedFilter === 'true') query.is_paused = true
    if (pausedFilter === 'false') query.is_paused = false
    if (!isCustomer && customerFilter.trim()) query.customer_id = customerFilter.trim()
    if (planFilter.trim()) query.plan_id = planFilter.trim()

    api.get<SubscriptionSummaryListResponse>('/subscriptions', query, controller.signal)
      .then(result => {
        if (controller.signal.aborted) return
        setRows(result.data)
        setTotalPages(result.meta.total_pages)
        setTotalCount(result.meta.total)
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
  }, [page, debouncedSearch, statusFilter, pausedFilter, customerFilter, planFilter, sortBy, sortOrder, revision, isCustomer, onExpired])

  return (
    <section className="subscriptions-section">
      <div className="catalog-header">
        <div>
          <h2>Subscriptions</h2>
          <p>
            {isCustomer
              ? 'View and monitor your subscription agreements and billing status.'
              : 'Manage recurring subscription agreements, lifecycle transitions, and quotations.'}
          </p>
        </div>
        {!isCustomer && (
          <button
            className="primary-button"
            onClick={() => {
              setShowCreateForm(true)
              setSelectedSubscriptionId(null)
            }}
          >
            + Create Quotation
          </button>
        )}
      </div>

      {error && (
        <div className="live-error" role="alert">
          <p>{error}</p>
        </div>
      )}

      {/* Creation Modal */}
      {showCreateForm && (
        <CreateSubscription
          onClose={() => setShowCreateForm(false)}
          onCreated={newSub => {
            setShowCreateForm(false)
            setSelectedSubscriptionId(newSub.id)
            setLoading(true)
            setRevision(r => r + 1)
          }}
          onExpired={onExpired}
        />
      )}

      {/* Detailed View */}
      {selectedSubscriptionId && (
        <SubscriptionDetails
          key={selectedSubscriptionId}
          id={selectedSubscriptionId}
          role={role}
          onClose={() => setSelectedSubscriptionId(null)}
          onChanged={() => {
            setLoading(true)
            setRevision(r => r + 1)
          }}
          onSelectInvoice={onSelectInvoice}
          onExpired={onExpired}
        />
      )}

      {/* Filters Toolbar */}
      <div className="catalog-toolbar">
        <div className="search-field">
          <label>Search Subscriptions</label>
          <input
            type="search"
            placeholder="Search by number, customer, plan..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>

        <label>
          Status
          <select
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value)
              setLoading(true)
              setPage(1)
            }}
          >
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="quotation">Quotation</option>
            <option value="confirmed">Confirmed</option>
            <option value="active">Active</option>
            <option value="closed">Closed</option>
          </select>
        </label>

        <label>
          Pause State
          <select
            value={pausedFilter}
            onChange={e => {
              setPausedFilter(e.target.value as any)
              setLoading(true)
              setPage(1)
            }}
          >
            <option value="all">All</option>
            <option value="true">Paused Only</option>
            <option value="false">Active Only</option>
          </select>
        </label>

        {!isCustomer && (
          <label>
            Customer ID
            <input
              type="text"
              placeholder="Filter customer UUID"
              value={customerFilter}
              onChange={e => {
                setCustomerFilter(e.target.value)
                setLoading(true)
                setPage(1)
              }}
              style={{ minWidth: 150 }}
            />
          </label>
        )}

        <label>
          Plan ID
          <input
            type="text"
            placeholder="Filter plan UUID"
            value={planFilter}
            onChange={e => {
              setPlanFilter(e.target.value)
              setLoading(true)
              setPage(1)
            }}
            style={{ minWidth: 150 }}
          />
        </label>

        <label>
          Sort By
          <select
            value={`${sortBy}-${sortOrder}`}
            onChange={e => {
              const [sb, so] = e.target.value.split('-') as [any, any]
              setSortBy(sb)
              setSortOrder(so)
              setLoading(true)
            }}
          >
            <option value="created_at-desc">Newest First</option>
            <option value="created_at-asc">Oldest First</option>
            <option value="number-asc">Number (A-Z)</option>
            <option value="next_billing_date-asc">Next Billing Date</option>
          </select>
        </label>

        <div className="catalog-toolbar-actions">
          <button
            disabled={loading}
            onClick={() => {
              setLoading(true)
              setRevision(r => r + 1)
            }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Subscription Table */}
      {loading ? (
        <p role="status">Loading subscriptions…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <h3>No Subscriptions Found</h3>
          <p>
            {debouncedSearch || statusFilter !== 'all' || customerFilter || planFilter
              ? 'No subscription agreements match your active filter criteria.'
              : isCustomer
                ? 'No subscription agreements exist for your account yet.'
                : 'Create a new quotation to establish a customer agreement.'}
          </p>
          {!isCustomer && !debouncedSearch && statusFilter === 'all' && (
            <button
              className="primary-button"
              onClick={() => setShowCreateForm(true)}
            >
              Create Quotation
            </button>
          )}
        </div>
      ) : (
        <div className="panel table-scroll">
          <table>
            <thead>
              <tr>
                <th>Subscription #</th>
                <th>Customer</th>
                <th>Plan</th>
                <th>Status</th>
                <th>Start Date</th>
                <th>Next Billing</th>
                <th>Estimated Total</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td>
                    <button
                      className="text-button"
                      style={{ fontWeight: 600, textAlign: 'left' }}
                      onClick={() => setSelectedSubscriptionId(row.id)}
                    >
                      {row.number}
                    </button>
                  </td>
                  <td>{row.customer_name}</td>
                  <td>{row.plan_name}</td>
                  <td>
                    <span className={`subscription-badge ${row.status}`}>
                      {row.status}
                    </span>
                    {row.is_paused && (
                      <span className="subscription-badge paused" style={{ marginLeft: 6 }}>
                        Paused
                      </span>
                    )}
                  </td>
                  <td>{row.start_date ?? '—'}</td>
                  <td>{row.next_billing_date ?? '—'}</td>
                  <td>
                    <strong>{money(row.estimated_total)}</strong>
                    <span style={{ fontSize: '0.78rem', color: '#586a60', marginLeft: 4 }}>
                      /{row.billing_interval}
                    </span>
                  </td>
                  <td className="action-buttons-cell">
                    <button onClick={() => setSelectedSubscriptionId(row.id)}>
                      View Details
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
          <span>Page {page} of {totalPages} · {totalCount} subscriptions</span>
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
