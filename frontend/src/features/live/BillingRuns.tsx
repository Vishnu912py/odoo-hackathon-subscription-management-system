import { useEffect, useState } from 'react'
import { api, ApiError, type PreparedMutation } from '../../api/client'
import type { BillingRun, BillingRunResponse, BillingRunListResponse } from '../../api/schema'
import { FormAlert } from './FormFeedback'

export default function BillingRuns({ onChanged, onExpired }: { onChanged: () => void; onExpired: () => void }) {
  const [run, setRun] = useState<BillingRun | null>(null)
  const [pending, setPending] = useState<PreparedMutation | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [history, setHistory] = useState<BillingRunListResponse | null>(null)
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void api.get<BillingRunListResponse>('/billing-runs', { page, page_size: 10 }, controller.signal).then(result => {
      setHistory(result)
      setRun(current => current ?? result.data.find(item => ['queued', 'running'].includes(item.status)) ?? null)
    }).catch(failure => { if (!controller.signal.aborted) { setError(failure); if (failure instanceof ApiError && failure.status === 401) onExpired() } })
    return () => controller.abort()
  }, [page, revision, onExpired])
  useEffect(() => {
    if (!run || !['queued', 'running'].includes(run.status)) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      void api.get<BillingRunResponse>(`/billing-runs/${run.id}`, {}, controller.signal).then(result => {
        setRun(result.data)
        if (!['queued', 'running'].includes(result.data.status)) { onChanged(); setRevision(v => v + 1) }
      }).catch(failure => {
        if (controller.signal.aborted) return
        setError(failure)
        if (failure instanceof ApiError && failure.status === 401) onExpired()
      })
    }, 3000)
    return () => { clearTimeout(timer); controller.abort() }
  }, [run, onChanged, onExpired])
  async function start(retryId?: string) {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const action = pending ?? (retryId ? api.prepare(`/billing-runs/${retryId}/retry`, 'POST', {}) : api.prepare('/billing-runs', 'POST', { as_of: today, limit: 100 }))
    setPending(action); setBusy(true); setError(null)
    try { const result = await api.send<BillingRunResponse>(action); setRun(result.data); setPending(null); setRevision(v => v + 1) }
    catch (failure) {
      setError(failure)
      if (failure instanceof ApiError && failure.status === 401) onExpired()
      if (failure instanceof ApiError && [400, 403, 422].includes(failure.status)) setPending(null)
    } finally { setBusy(false) }
  }
  return <div className="panel">
    <h3>Recurring billing</h3>
    <p>Generate draft invoices for due subscription periods. Review and confirm each invoice before collecting payment.</p>
    <button className="primary-button" disabled={busy || Boolean(run && ['queued', 'running'].includes(run.status))} onClick={() => void start()}>
      {busy ? 'Queueing…' : pending ? 'Retry same billing request' : 'Generate due invoices'}
    </button>
    {error !== null && <FormAlert error={error} />}
    {run && <p role="status">Billing {run.status.replaceAll('_', ' ')} · {run.created_count} generated · {run.reused_count} reused · {run.failed_count} failed.
      {['queued', 'running'].includes(run.status) && ' Waiting for the billing worker.'}
      {run.next_run_required && ' More periods require processing.'}</p>}
    {run?.errors.map((item, index) => <p key={index}>{item.period_start}: {item.message}</p>)}
    <h4>Billing run history</h4>
    <button onClick={() => setRevision(v => v + 1)}>Refresh billing history</button>
    {history?.data.map(item => <p key={item.id}>{new Date(item.created_at).toLocaleString()} · through {item.as_of} · {item.status.replaceAll('_', ' ')} · {item.created_count} generated · {item.failed_count} failed
      {(['failed', 'completed_with_errors'].includes(item.status) || (item.status === 'completed' && item.next_run_required)) && <button disabled={busy || !!pending || Boolean(run && ['queued', 'running'].includes(run.status))} onClick={() => void start(item.id)}>Retry failed periods</button>}
    </p>)}
    <button disabled={page <= 1} onClick={() => setPage(v => v - 1)}>Previous runs</button> <span>Page {page} of {Math.max(1, history?.meta.total_pages ?? 1)}</span> <button disabled={!history || page >= history.meta.total_pages} onClick={() => setPage(v => v + 1)}>Next runs</button>
  </div>
}
