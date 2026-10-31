import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { api, ApiError, errorMessage } from '../../api/client'
import { money } from '../../api/format'
import type { InvoiceSummaryListResponse, OverviewResponse, PaymentListResponse, Session, SubscriptionSummaryListResponse } from '../../api/schema'
import './live.css'
import InvoiceDetails from './InvoiceDetails'
import PasswordRecovery from './PasswordRecovery'
import StaffManagement from './StaffManagement'

type Page = 'Overview' | 'Subscriptions' | 'Invoices' | 'Payments'
const pages: Page[] = ['Overview', 'Subscriptions', 'Invoices', 'Payments']

function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function Failure({ error }: { error: unknown }) {
  return <div className="live-error" role="alert">
    <p>{errorMessage(error)}</p>
    {error instanceof ApiError && error.fields.length > 0 && <ul>{error.fields.map((field, index) =>
      <li key={`${field.path}-${index}`}>{field.path}: {field.message}</li>)}</ul>}
    {error instanceof ApiError && error.requestId && <small>Reference: {error.requestId}</small>}
  </div>
}

function ConnectionStatus() {
  const [check, setCheck] = useState(0)
  const [status, setStatus] = useState({ api: 'Checking…', database: 'Checking…' })
  useEffect(() => {
    const controller = new AbortController()
    void Promise.allSettled([api.health('live', controller.signal), api.health('ready', controller.signal)]).then(([live, ready]) => {
      if (controller.signal.aborted) return
      setStatus({
        api: live.status === 'fulfilled' && live.value.data.status === 'ok' ? 'Reachable' : 'Unavailable',
        database: ready.status === 'fulfilled' && ready.value.data.database === 'connected' ? 'Connected' : 'Not ready',
      })
    })
    return () => controller.abort()
  }, [check])
  return <section className="live-connection" aria-label="Backend connection">
    <div aria-live="polite"><strong>API: {status.api}</strong><span>Database: {status.database}</span></div>
    <button onClick={() => { setStatus({ api: 'Checking…', database: 'Checking…' }); setCheck(value => value + 1) }}>Check connection</button>
    <small>Connection status does not mean business features are implemented.</small>
  </section>
}

function SignIn({ onSession }: { onSession: (session: Session) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [registering, setRegistering] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [message, setMessage] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null)
    try {
      if (registering) {
        await api.register({ email: email.trim(), password, display_name: displayName.trim() })
        setRegistering(false); setPassword(''); setMessage('Customer account created. Sign in to continue.')
      } else onSession(await api.login({ email: email.trim(), password }))
    }
    catch (failure) { setError(failure) }
    finally { setBusy(false) }
  }
  if (recovering) return <PasswordRecovery onDone={() => setRecovering(false)} />
  return <section className="panel live-login">
    <h2>{registering ? 'Create a customer account' : 'Sign in to your workspace'}</h2>
    <p>Use an account created by the backend team. Demo identities do not grant access.</p>
    <form onSubmit={submit}>
      {registering && <label>Name<input required maxLength={200} autoComplete="name" value={displayName} onChange={event => setDisplayName(event.target.value)} /></label>}
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={event => setEmail(event.target.value)} /></label>
      <label>Password<input type="password" autoComplete={registering ? 'new-password' : 'current-password'} required minLength={registering ? 9 : undefined} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} /></label>
      {registering && <p>Use more than eight characters with uppercase, lowercase and a special character.</p>}
      {message && <p role="status">{message}</p>}
      {error !== null && <Failure error={error} />}
      <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : registering ? 'Create account' : 'Sign in'}</button>
      <button type="button" disabled={busy} onClick={() => { setRegistering(value => !value); setError(null); setMessage('') }}>{registering ? 'Back to sign in' : 'Create customer account'}</button>
    </form>
    <button onClick={() => setRecovering(true)}>Forgot password / staff setup</button>
    <p className="live-hint">Prototype v1 connects to persisted accounts and records. Use the development accounts described in the setup guide.</p>
  </section>
}

interface RecordsProps { session: Session; page: Page; onExpired: () => void }
function Records({ session, page, onExpired }: RecordsProps) {
  const [pageNumber, setPageNumber] = useState(1)
  const [revision, setRevision] = useState(0)
  const [range, setRange] = useState({ from: today().slice(0, 7) + '-01', to: today() })
  const [draftRange, setDraftRange] = useState(range)
  const [data, setData] = useState<OverviewResponse | SubscriptionSummaryListResponse | InvoiceSummaryListResponse | PaymentListResponse | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const role = session.user.role
  const [invoiceId, setInvoiceId] = useState<string | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const request = page === 'Overview'
      ? api.get<OverviewResponse>(role === 'customer' ? '/portal/overview' : '/reports/overview', range, controller.signal)
      : api.get<SubscriptionSummaryListResponse | InvoiceSummaryListResponse | PaymentListResponse>(`/${page.toLowerCase()}`, { page: pageNumber, page_size: 20 }, controller.signal)
    void request.then(result => { if (!controller.signal.aborted) setData(result) }).catch(failure => {
      if (controller.signal.aborted) return
      if (failure instanceof ApiError && failure.status === 401) onExpired()
      else setError(failure)
    }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
    return () => controller.abort()
  }, [page, pageNumber, revision, range, role, onExpired])

  const meta = data && 'meta' in data ? data.meta : null
  function startLoading() { setBusy(true); setData(null); setError(null) }
  return <section className="live-records" aria-busy={busy}>
    <div className="live-heading"><h2>{page}</h2><button disabled={busy} onClick={() => { startLoading(); setRevision(value => value + 1) }}>Refresh</button></div>
    {page === 'Overview' && <form className="live-filters" onSubmit={event => {
      event.preventDefault()
      const days = (Date.parse(draftRange.to) - Date.parse(draftRange.from)) / 86_400_000 + 1
      if (days < 1 || days > 366) { setError(new ApiError(422, 'VALIDATION_ERROR', 'Choose a range of 1–366 days.')); return }
      startLoading(); setRange({ ...draftRange })
    }}>
      <label>From<input type="date" required max={draftRange.to} value={draftRange.from} onChange={event => setDraftRange({ ...draftRange, from: event.target.value })} /></label>
      <label>To<input type="date" required min={draftRange.from} max={today()} value={draftRange.to} onChange={event => setDraftRange({ ...draftRange, to: event.target.value })} /></label>
      <button disabled={busy}>Apply dates</button>
    </form>}
    {busy && <p role="status">Loading {page.toLowerCase()}…</p>}
    {error !== null && <Failure error={error} />}
    {data && page === 'Overview' && <Overview result={data as OverviewResponse} />}
    {data && page === 'Subscriptions' && <Subscriptions result={data as SubscriptionSummaryListResponse} />}
    {invoiceId && <InvoiceDetails key={invoiceId} id={invoiceId} userId={session.user.id} onClose={() => setInvoiceId(null)} onChanged={() => { startLoading(); setRevision(value => value + 1) }} onExpired={onExpired} />}
    {data && page === 'Invoices' && <Invoices result={data as InvoiceSummaryListResponse} onSelect={setInvoiceId} />}
    {data && page === 'Payments' && <Payments result={data as PaymentListResponse} />}
    {meta && <div className="live-pagination">
      <button disabled={busy || pageNumber <= 1} onClick={() => { startLoading(); setPageNumber(value => value - 1) }}>Previous</button>
      <span>{meta.total === 0 ? '0 records' : `Page ${meta.page} of ${meta.total_pages} · ${meta.total} records`}</span>
      <button disabled={busy || pageNumber >= meta.total_pages} onClick={() => { startLoading(); setPageNumber(value => value + 1) }}>Next</button>
    </div>}
  </section>
}

function Overview({ result: { data } }: { result: OverviewResponse }) {
  return <>
    <p>Period totals: {data.from} through {data.to}. Current counts and balances as of {data.as_of}.</p>
    <div className="stats-grid">
      {[
        ['Invoiced in period', money(data.invoiced_total)], ['Payments in period', money(data.payments_received)],
        ['Current outstanding', money(data.outstanding_balance)], ['Current overdue', money(data.overdue_balance)],
        ['Active subscriptions now', data.active_subscriptions], ['Paused subscriptions now', data.paused_subscriptions],
      ].map(([label, value]) => <article className="stat-card" key={label}><div className="stat-top">{label}</div><div className="stat-value">{value}</div></article>)}
    </div>
    <p className="live-hint">Invoiced amounts exclude drafts and cancellations; they are not cash collected.</p>
    <div className="panel table-scroll"><table><thead><tr><th>Month</th><th>Invoiced</th><th>Payments received</th></tr></thead><tbody>
      {data.monthly.map(row => <tr key={row.month}><td>{row.month}</td><td>{money(row.invoiced_total)}</td><td>{money(row.payments_received)}</td></tr>)}
    </tbody></table></div>
  </>
}
function Subscriptions({ result }: { result: SubscriptionSummaryListResponse }) {
  if (!result.data.length) return <p>No subscriptions found for your account.</p>
  return <div className="panel table-scroll"><table><thead><tr><th>Subscription</th><th>Customer</th><th>Plan</th><th>Status</th><th>Next billing</th><th>Estimated total</th></tr></thead><tbody>
    {result.data.map(row => <tr key={row.id}><td>{row.number}</td><td>{row.customer_name}</td><td>{row.plan_name}</td><td>{row.status}{row.is_paused ? ' · paused' : ''}</td><td>{row.next_billing_date ?? '—'}</td><td>{money(row.estimated_total)}</td></tr>)}
  </tbody></table></div>
}
function Invoices({ result, onSelect }: { result: InvoiceSummaryListResponse; onSelect: (id: string) => void }) {
  if (!result.data.length) return <p>No invoices found for your account.</p>
  return <div className="panel table-scroll"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Status</th><th>Due</th><th>Total</th><th>Balance</th></tr></thead><tbody>
    {result.data.map(row => <tr key={row.id}><td><button onClick={() => onSelect(row.id)}>{row.number}</button></td><td>{row.customer_name}</td><td>{row.status}{row.is_overdue ? ' · overdue' : ''}</td><td>{row.due_date}</td><td>{money(row.total)}</td><td>{money(row.balance_due)}</td></tr>)}
  </tbody></table></div>
}
function Payments({ result }: { result: PaymentListResponse }) {
  if (!result.data.length) return <p>No payments found for your account.</p>
  return <div className="panel table-scroll"><table><thead><tr><th>Invoice</th><th>Date</th><th>Method</th><th>Amount</th><th>Note</th></tr></thead><tbody>
    {result.data.map(row => <tr key={row.id}><td>{row.invoice_number}</td><td>{row.payment_date}</td><td>{row.method.replaceAll('_', ' ')}</td><td>{money(row.amount)}</td><td>{row.note ?? '—'}</td></tr>)}
  </tbody></table></div>
}

export default function LiveWorkspace() {
  const [session, setSession] = useState<Session | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [revision, setRevision] = useState(0)
  const [page, setPage] = useState<Page | 'Staff'>('Overview')
  const [error, setError] = useState<unknown>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('reset') ?? '')
  useEffect(() => { if (resetToken) window.history.replaceState(null, '', window.location.pathname + window.location.search) }, [resetToken])
  // State setters are stable; use one stable expiry callback to avoid refetch loops.
  const expire = useCallback(() => {
    setSession(null)
    setError(new ApiError(401, 'UNAUTHENTICATED', 'Your session expired.'))
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    void api.me(controller.signal).then(value => { if (!controller.signal.aborted) setSession(value) }).catch(failure => {
      if (!controller.signal.aborted && !(failure instanceof ApiError && failure.status === 401)) setError(failure)
    }).finally(() => { if (!controller.signal.aborted) setRestoring(false) })
    return () => controller.abort()
  }, [revision])
  async function signOut() {
    setSigningOut(true); setError(null)
    try { await api.logout(); setSession(null) }
    catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) setSession(null)
      setError(failure)
    } finally { setSigningOut(false) }
  }
  if (resetToken) return <main className="live-workspace"><PasswordRecovery token={resetToken} onDone={() => { setResetToken(''); setSession(null); setRevision(value => value + 1) }} /></main>
  return <main className="live-workspace">
    <header className="live-heading"><div><p className="eyebrow">BRIGHTLOOP · LIVE CONNECTION</p><h1>Subscription workspace</h1><p>Records below come from the backend API.</p></div></header>
    <ConnectionStatus />
    <div className="live-heading">
      <p>{session ? `${session.user.display_name} · ${session.user.role}` : 'Not signed in'}</p>
      <div className="live-actions"><button disabled={restoring || signingOut} onClick={() => { setRestoring(true); setError(null); setSession(null); setRevision(value => value + 1) }}>Refresh session</button>
        {session && <button disabled={signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button>}</div>
    </div>
    {error !== null && <Failure error={error} />}
    {restoring ? <p role="status">Restoring session…</p> : !session ? <SignIn onSession={value => { setError(null); setSession(value); setPage('Overview') }} /> : <>
      <nav className="live-tabs" aria-label="Live records">{(session.user.role === 'admin' ? [...pages, 'Staff' as const] : pages).map(item => <button key={item} aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}>{item}</button>)}</nav>
      {page === 'Staff' && session.user.role === 'admin' ? <StaffManagement onExpired={expire} /> : <Records key={`${session.user.id}-${page}`} session={session} page={page === 'Staff' ? 'Overview' : page} onExpired={expire} />}
    </>}
  </main>
}
