import { useState, type FormEvent } from 'react'
import { api } from '../../api/client'
import { validatePassword, isValidEmail } from './password-policy'
import { FormAlert, FormSuccess, PasswordChecklist } from './FormFeedback'

export default function PasswordRecovery({ token, onDone }: { token?: string; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [touched, setTouched] = useState(false)

  const passwordRules = validatePassword(password)
  const passwordsMatch = password === confirmPassword
  const emailValid = isValidEmail(email)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (token) {
      if (!passwordRules.isValid || !passwordsMatch || busy) return
    } else {
      if (!emailValid || busy) return
    }

    setBusy(true)
    setError(null)
    try {
      const result = token
        ? await api.resetPassword(token, password)
        : await api.forgotPassword(email.trim())
      setPassword('')
      setConfirmPassword('')
      setMessage(result.data.message)
    } catch (failure) {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  const canSubmit = token
    ? passwordRules.isValid && passwordsMatch && !busy && !message
    : emailValid && !busy && !message

  return (
    <section className="panel live-auth-card" aria-labelledby="recovery-title">
      <div className="auth-card-header">
        <div className="auth-brand-badge" aria-hidden="true">R</div>
        <div>
          <h2 id="recovery-title">{token ? 'Choose your password' : 'Request password setup email'}</h2>
          <p className="auth-subtitle">
            {token
              ? 'Complete password setup for your customer or staff account.'
              : 'Enter your email to receive password setup or recovery instructions.'}
          </p>
        </div>
      </div>

      {message && <FormSuccess message={message} />}
      {error !== null && <FormAlert error={error} />}

      <form onSubmit={submit} className="live-auth-form" noValidate>
        {token ? (
          <>
            <div className="form-group">
              <label htmlFor="recovery-password">New password</label>
              <input
                id="recovery-password"
                type="password"
                required
                minLength={9}
                maxLength={128}
                autoComplete="new-password"
                placeholder="Choose a strong password"
                value={password}
                disabled={busy || Boolean(message)}
                aria-invalid={touched && !passwordRules.isValid}
                onChange={e => {
                  setPassword(e.target.value)
                  setTouched(true)
                }}
              />
              <PasswordChecklist rules={passwordRules} touched={touched} />
            </div>

            <div className="form-group">
              <label htmlFor="recovery-confirm-password">Confirm new password</label>
              <input
                id="recovery-confirm-password"
                type="password"
                required
                maxLength={128}
                autoComplete="new-password"
                placeholder="Re-enter your new password"
                value={confirmPassword}
                disabled={busy || Boolean(message)}
                aria-invalid={confirmPassword.length > 0 && !passwordsMatch}
                onChange={e => setConfirmPassword(e.target.value)}
              />
              {confirmPassword.length > 0 && !passwordsMatch && (
                <small className="field-hint field-hint-error">Passwords do not match.</small>
              )}
            </div>
          </>
        ) : (
          <div className="form-group">
            <label htmlFor="recovery-email">Email address</label>
            <input
              id="recovery-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="name@company.com"
              value={email}
              disabled={busy || Boolean(message)}
              aria-invalid={email.length > 0 && !emailValid}
              onChange={e => setEmail(e.target.value)}
            />
            {email.length > 0 && !emailValid && (
              <small className="field-hint field-hint-error">Please enter a valid email address.</small>
            )}
            <small className="field-hint">
              Staff members with expired setup invitations can also request a new email here.
            </small>
          </div>
        )}

        <button
          type="submit"
          className="primary-button auth-submit-btn"
          disabled={!canSubmit}
        >
          {busy ? 'Please wait…' : token ? 'Save password' : 'Send setup email'}
        </button>

        <div className="auth-secondary-actions">
          <button type="button" className="text-link" disabled={busy} onClick={onDone}>
            ← Back to sign in
          </button>
        </div>
      </form>
    </section>
  )
}
