import { useEffect, useState, type FormEvent } from 'react'
import { api, ApiError, type PreparedMutation } from '../../api/client'
import { FormAlert, FormSuccess } from '../live/FormFeedback'

type Entry = { id: string; name: string; version: number; user_id?: string | null; billing_email?: string; billing_address?: string | null; due_days?: number; is_active?: boolean }
export default function DirectoryManagement({ kind, onExpired }: { kind: 'customers' | 'payment-terms'; onExpired: () => void }) {
  const [rows, setRows] = useState<Entry[]>([])
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [revision, setRevision] = useState(0)
  const [entry, setEntry] = useState<Entry | null>(null)
  const [name, setName] = useState(''), [email, setEmail] = useState(''), [address, setAddress] = useState(''), [days, setDays] = useState('15')
  const [active, setActive] = useState(true)
  const [pending, setPending] = useState<PreparedMutation | null>(null)
  const [invitation, setInvitation] = useState<PreparedMutation | null>(null)
  async function invite(row?: Entry) {
    const action = invitation ?? api.prepare(`/customers/${row!.id}/invite`, 'POST', {}, row!.version)
    setInvitation(action); setBusy(true); setError(null)
    try { const result = await api.send<{ data: { message: string } }>(action); setSuccess(result.data.message); setInvitation(null) }
    catch (failure) { setError(failure); if (failure instanceof ApiError && failure.status === 401) onExpired(); if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) setInvitation(null) }
    finally { setBusy(false) }
  }
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [success, setSuccess] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void api.get<{ data: Entry[]; meta: { total_pages: number } }>(`/${kind}`, { page, page_size: 20 }, controller.signal)
      .then(result => { setRows(result.data); setPages(result.meta.total_pages) })
      .catch(failure => { if (!controller.signal.aborted) { setError(failure); if (failure instanceof ApiError && failure.status === 401) onExpired() } })
    return () => controller.abort()
  }, [kind, page, revision, onExpired])
  function edit(row: Entry | null) {
    setEntry(row); setName(row?.name ?? ''); setEmail(row?.billing_email ?? ''); setAddress(row?.billing_address ?? ''); setDays(String(row?.due_days ?? 15)); setActive(row?.is_active ?? true)
  }
  async function save(event: FormEvent) {
    event.preventDefault()
    const body = kind === 'customers' ? { name, billing_email: email, billing_address: address || null }
      : { name, is_active: active, ...(!entry ? { due_days: Number(days) } : {}) }
    const action = pending ?? api.prepare(`/${kind}${entry ? '/' + entry.id : ''}`, entry ? 'PATCH' : 'POST', body, entry?.version)
    setPending(action); setBusy(true); setError(null); setSuccess('')
    try { await api.send(action); setPending(null); edit(null); setRevision(v => v + 1); setSuccess('Saved successfully.') }
    catch (failure) {
      setError(failure)
      if (failure instanceof ApiError && failure.status === 401) onExpired()
      if (failure instanceof ApiError && [403, 404, 412, 422, 428].includes(failure.status)) { setPending(null); setRevision(v => v + 1) }
    } finally { setBusy(false) }
  }
  return <section className="panel">
    <h2>{kind === 'customers' ? 'Customers' : 'Payment terms'}</h2>
    {error !== null && <FormAlert error={error} />}{success && <FormSuccess message={success} />}
    {invitation && <button disabled={busy} onClick={() => void invite()}>Retry same invitation</button>}
    <form onSubmit={save} className="catalog-form-grid">
      <fieldset disabled={busy || !!pending}>
        <legend>{entry ? 'Edit record' : 'New record'}</legend>
        <label>Name<input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label>
        {kind === 'customers' ? <>
          <label>Billing email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} /></label>
          <label>Billing address<textarea value={address} onChange={event => setAddress(event.target.value)} /></label>
        </> : <>
          <label>Days until payment is due<input required type="number" min={0} max={365} disabled={!!entry} value={days} onChange={event => setDays(event.target.value)} /></label>
          <label><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} /> Active</label>
          {entry && <p>Create a new term to change its due days. Existing agreements keep their original terms.</p>}
        </>}
      </fieldset>
      <button className="primary-button" disabled={busy}>{pending ? 'Retry same save' : 'Save'}</button>
      {entry && <button type="button" disabled={busy || !!pending} onClick={() => edit(null)}>New record</button>}
    </form>
    <div className="table-scroll"><table><thead><tr><th>Name</th><th>{kind === 'customers' ? 'Billing email' : 'Due days'}</th><th>Action</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><td>{row.name}</td><td>{row.billing_email ?? `${row.due_days} days${row.is_active ? '' : ' (archived)'}`}</td><td><button disabled={busy || !!pending} onClick={() => edit(row)}>Edit</button>{kind === 'customers' && (row.user_id ? <span> Portal linked</span> : <button disabled={busy || !!invitation} onClick={() => void invite(row)}>Invite to portal</button>)}</td></tr>)}</tbody></table></div>
    {!rows.length && <p>No records yet.</p>}
    <button disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Previous</button> <span>Page {page} of {Math.max(1, pages)}</span> <button disabled={page >= pages} onClick={() => setPage(v => v + 1)}>Next</button>
  </section>
}
