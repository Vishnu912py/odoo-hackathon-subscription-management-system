import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type PreparedMutation } from '../../api/client'
import type { Staff, StaffListResponse, StaffResponse } from '../../api/schema'
import { isValidEmail } from './password-policy'
import { FormAlert, FormSuccess } from './FormFeedback'

export default function StaffManagement({ onExpired }: { onExpired: () => void }) {
  const [rows, setRows] = useState<Staff[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalStaff, setTotalStaff] = useState(0)
  const [revision, setRevision] = useState(0)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [success, setSuccess] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<PreparedMutation | null>(null)

  const emailValid = isValidEmail(email)
  const canInvite = name.trim().length > 0 && emailValid && !busy && !pending

  useEffect(() => {
    const controller = new AbortController()
    void api.get<StaffListResponse>('/staff', { page, page_size: 20 }, controller.signal)
      .then(result => {
        if (!controller.signal.aborted) {
          setRows(result.data)
          setTotalPages(result.meta.total_pages)
          setTotalStaff(result.meta.total)
        }
      })
      .catch(failure => {
        if (!controller.signal.aborted) {
          setError(failure)
          if (failure instanceof ApiError && failure.status === 401) onExpired()
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [page, revision, onExpired])

  async function send(action: PreparedMutation, successMsg?: string) {
    setPending(action)
    setBusy(true)
    setError(null)
    setSuccess('')
    try {
      await api.send<StaffResponse>(action)
      setPending(null)
      setEmail('')
      setName('')
      if (successMsg) setSuccess(successMsg)
      setLoading(true)
      setRevision(value => value + 1)
    } catch (failure) {
      setError(failure)
      if (failure instanceof ApiError && [400, 404, 412, 422, 428].includes(failure.status)) setPending(null)
      if (failure instanceof ApiError && failure.status === 409 && failure.code !== 'REQUEST_IN_PROGRESS') setPending(null)
      if (failure instanceof ApiError && failure.status === 401) onExpired()
    } finally {
      setBusy(false)
    }
  }

  function invite(event: FormEvent) {
    event.preventDefault()
    if (!canInvite) return
    const inviteEmail = email.trim()
    void send(
      api.prepare('/staff', 'POST', { email: inviteEmail, display_name: name.trim() }),
      `Invitation sent to ${inviteEmail}. They will receive an email to set their password.`
    )
  }

  return (
    <section className="live-records staff-management-panel" aria-label="Staff management">
      <div className="section-header-row">
        <div>
          <div className="role-chip admin-chip">Admin Only</div>
          <h2>Staff Access & Invitations</h2>
          <p className="section-desc">
            Invite new team members and manage role status. Staff members receive an invitation link to securely set their password.
          </p>
        </div>
        <button
          className="secondary-button"
          disabled={loading || busy}
          onClick={() => {
            setError(null)
            setRevision(v => v + 1)
          }}
        >
          {loading ? 'Refreshing…' : '↻ Refresh list'}
        </button>
      </div>

      {success && <FormSuccess message={success} />}
      {error !== null && <FormAlert error={error} />}

      <div className="panel invite-card">
        <h3>Invite staff member</h3>
        <p className="invite-card-hint">
          New staff members are sent a 30-minute setup link. If expired, they can request a new link on the login screen.
        </p>

        <form className="live-filters staff-invite-form" onSubmit={invite} noValidate>
          <div className="form-group">
            <label htmlFor="staff-name">Staff Name</label>
            <input
              id="staff-name"
              required
              maxLength={200}
              placeholder="e.g. Alex Morgan"
              value={name}
              disabled={busy}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="staff-email">Staff Email</label>
            <input
              id="staff-email"
              type="email"
              required
              maxLength={254}
              placeholder="alex@company.com"
              value={email}
              disabled={busy}
              aria-invalid={email.length > 0 && !emailValid}
              onChange={e => setEmail(e.target.value)}
            />
            {email.length > 0 && !emailValid && (
              <small className="field-hint field-hint-error">Enter a valid email address.</small>
            )}
          </div>

          <div className="form-group submit-group">
            <button
              type="submit"
              className="primary-button"
              disabled={!canInvite}
            >
              {busy && !pending ? 'Sending invitation…' : '＋ Invite staff'}
            </button>
          </div>
        </form>

        {pending && (
          <div className="retry-banner" role="alert">
            <p>A request was interrupted or returned an uncertain status. Retry with the identical key to ensure idempotency:</p>
            <button
              type="button"
              className="primary-button"
              disabled={busy}
              onClick={() => void send(pending)}
            >
              {busy ? 'Retrying…' : 'Retry same invitation'}
            </button>
          </div>
        )}
      </div>

      <div className="staff-roster-section">
        <div className="roster-header">
          <h3>Active & Pending Staff ({totalStaff})</h3>
        </div>

        {loading ? (
          <div className="loading-state" role="status">
            <span className="spinner" aria-hidden="true" />
            <p>Loading staff directory…</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="empty-state">
            <p>No staff accounts found.</p>
          </div>
        ) : (
          <div className="panel table-scroll">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Invitation</th>
                  <th>Access status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.id}>
                    <td className="font-semibold">{row.display_name}</td>
                    <td><code>{row.email}</code></td>
                    <td>
                      <span className={`status-badge invitation-${row.invitation_status}`}>
                        {row.invitation_status === 'pending' ? '⏳ Pending setup' : '✓ Accepted'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${row.is_active ? 'active' : 'inactive'}`}>
                        {row.is_active ? '● Active' : '○ Inactive'}
                      </span>
                    </td>
                    <td>
                      <button
                        className="table-action-button"
                        disabled={busy || Boolean(pending) || row.invitation_status === 'pending'}
                        title={row.invitation_status === 'pending' ? 'Staff must complete password setup before status can be changed' : undefined}
                        onClick={() => void send(
                          api.prepare(`/staff/${row.id}`, 'PATCH', { is_active: !row.is_active }, row.version),
                          `${row.display_name} is now ${row.is_active ? 'disabled' : 'enabled'}.`
                        )}
                      >
                        {row.is_active ? 'Disable access' : 'Enable access'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="live-pagination">
          <button
            className="secondary-button"
            disabled={loading || page <= 1}
            onClick={() => {
              setLoading(true)
              setPage(p => p - 1)
            }}
          >
            ← Previous
          </button>
          <span className="pagination-info">
            Page {page} of {Math.max(1, totalPages)}
          </span>
          <button
            className="secondary-button"
            disabled={loading || page >= totalPages}
            onClick={() => {
              setLoading(true)
              setPage(p => p + 1)
            }}
          >
            Next →
          </button>
        </div>
      </div>
    </section>
  )
}
