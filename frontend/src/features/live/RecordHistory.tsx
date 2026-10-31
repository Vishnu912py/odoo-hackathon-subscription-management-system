import { useEffect, useState } from 'react'
import { api, ApiError, type PreparedMutation } from '../../api/client'
import { FormAlert } from './FormFeedback'
type Row = { id: string; created_at?: string; occurred_at?: string; summary?: string; event_type?: string; status?: string; recipient?: string; attempts?: number; error?: string | null }
export default function RecordHistory({ path, title, revision, onExpired }: { path: string; title: string; revision: number; onExpired: () => void }) {
  const [page, setPage] = useState(1), [pages, setPages] = useState(1), [refresh, setRefresh] = useState(0)
  const [rows, setRows] = useState<Row[]>([]), [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState<PreparedMutation | null>(null), [busy, setBusy] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    void api.get<{ data: Row[]; meta: { total_pages: number } }>(path, { page, page_size: 20 }, controller.signal)
      .then(result => { setRows(result.data); setPages(result.meta.total_pages); setError(null) })
      .catch(failure => { if (!controller.signal.aborted) { setError(failure); if (failure instanceof ApiError && failure.status === 401) onExpired() } })
    return () => controller.abort()
  }, [path, page, revision, refresh, onExpired])
  async function retry(row?: Row) {
    const action = pending ?? api.prepare(`${path}/${row!.id}/retry`, 'POST', {})
    setPending(action); setBusy(true)
    try { await api.send(action); setPending(null); setRefresh(v => v + 1) }
    catch (failure) { setError(failure); if (failure instanceof ApiError && failure.status === 401) onExpired(); if (failure instanceof ApiError && failure.status >= 400 && failure.status < 500) setPending(null) }
    finally { setBusy(false) }
  }
  return <section className="panel"><h3>{title}</h3>
    <button onClick={() => setRefresh(v => v + 1)}>Refresh history</button>
    {error !== null && <FormAlert error={error} />}
    {pending && <button disabled={busy} onClick={() => void retry()}>Retry same delivery request</button>}
    {!rows.length && <p>No history yet.</p>}
    {rows.map(row => <div key={row.id}><p><time>{new Date(row.created_at ?? row.occurred_at ?? '').toLocaleString()}</time> · {(row.event_type ?? row.status)?.replaceAll('_', ' ')} {row.recipient && `· ${row.recipient} · ${row.attempts} attempts`}</p>
      {row.summary && <p>{row.summary}</p>}
      {row.error && <p>{row.error}</p>}
      {row.status === 'failed' && <button disabled={busy || !!pending} onClick={() => void retry(row)}>Retry delivery</button>}
    </div>)}
    <button disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Previous history</button> <span>Page {page} of {Math.max(1, pages)}</span> <button disabled={page >= pages} onClick={() => setPage(v => v + 1)}>Next history</button>
  </section>
}
