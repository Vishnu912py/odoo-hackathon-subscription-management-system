import { useState, type FormEvent } from 'react'
import { api, errorMessage } from '../../api/client'

export default function PasswordRecovery({ token, onDone }: { token?: string; onDone: () => void }) {
  const [email, setEmail] = useState(''), [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = token ? await api.resetPassword(token, password) : await api.forgotPassword(email.trim())
      setPassword(''); setMessage(result.data.message)
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(false) }
  }
  return <section className="panel live-login"><h2>{token ? 'Choose your password' : 'Request a password setup email'}</h2>
    <form onSubmit={submit}>
      {token ? <><label>New password<input type="password" required minLength={9} maxLength={128} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></label><p>Use uppercase, lowercase and a special character, with at least nine characters.</p></>
        : <label>Email<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>}
      {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
      <button disabled={busy || Boolean(message)}>{busy ? 'Please wait…' : token ? 'Save password' : 'Send setup email'}</button>
      <button type="button" disabled={busy} onClick={onDone}>Back to sign in</button>
    </form></section>
}
