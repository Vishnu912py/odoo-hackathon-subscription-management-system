import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, errorMessage, type PreparedMutation } from '../../api/client'
import type { Staff, StaffListResponse, StaffResponse } from '../../api/schema'

export default function StaffManagement({ onExpired }: { onExpired: () => void }) {
  const [rows, setRows] = useState<Staff[]>([]), [page, setPage] = useState(1), [totalPages, setTotalPages] = useState(0)
  const [revision, setRevision] = useState(0), [email, setEmail] = useState(''), [name, setName] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<PreparedMutation | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void api.get<StaffListResponse>('/staff', { page, page_size: 20 }, controller.signal).then(result => {
      if (!controller.signal.aborted) { setRows(result.data); setTotalPages(result.meta.total_pages) }
    }).catch(failure => { if (!controller.signal.aborted) { setError(errorMessage(failure)); if (failure instanceof ApiError && failure.status === 401) onExpired() } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [page, revision, onExpired])
  async function send(action: PreparedMutation) {
    setPending(action); setBusy(true); setError('')
    try {
      await api.send<StaffResponse>(action); setPending(null); setEmail(''); setName(''); setLoading(true); setRevision(value => value + 1)
    } catch (failure) {
      setError(errorMessage(failure))
      if (failure instanceof ApiError && [400, 404, 412, 422, 428].includes(failure.status)) setPending(null)
      if (failure instanceof ApiError && failure.status === 409 && failure.code !== 'REQUEST_IN_PROGRESS') setPending(null)
      if (failure instanceof ApiError && failure.status === 401) onExpired()
    } finally { setBusy(false) }
  }
  function invite(event: FormEvent) { event.preventDefault(); void send(api.prepare('/staff', 'POST', { email: email.trim(), display_name: name.trim() })) }
  return <section className="live-records"><h2>Staff access</h2><p>Invited staff set their own password using an emailed link. Expired invitations can request another email on the sign-in screen.</p>
    <form className="live-filters" onSubmit={invite}><label>Name<input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label><label>Email<input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label><button disabled={busy || Boolean(pending)}>Invite staff</button></form>
    {error && <p role="alert">{error}</p>}{pending && <button disabled={busy} onClick={() => void send(pending)}>Retry same request</button>}
    {loading ? <p role="status">Loading staff…</p> : <div className="panel table-scroll"><table><thead><tr><th>Name</th><th>Email</th><th>Invitation</th><th>Access</th><th>Action</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td>{row.display_name}</td><td>{row.email}</td><td>{row.invitation_status}</td><td>{row.is_active ? 'Active' : 'Inactive'}</td><td><button disabled={busy || Boolean(pending) || row.invitation_status === 'pending'} onClick={() => void send(api.prepare(`/staff/${row.id}`, 'PATCH', { is_active: !row.is_active }, row.version))}>{row.is_active ? 'Disable' : 'Enable'}</button></td></tr>)}</tbody></table></div>}
    <div className="live-pagination"><button disabled={loading || page <= 1} onClick={() => { setLoading(true); setPage(page - 1) }}>Previous</button><span>Page {page}</span><button disabled={loading || page >= totalPages} onClick={() => { setLoading(true); setPage(page + 1) }}>Next</button></div>
  </section>
}
