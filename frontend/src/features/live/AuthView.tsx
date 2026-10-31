import { useState, useId, type FormEvent } from 'react'
import { api } from '../../api/client'
import type { Session } from '../../api/schema'
import { validatePassword, isValidEmail } from './password-policy'
import { FormAlert, FormSuccess, PasswordChecklist } from './FormFeedback'

export type AuthMode = 'login' | 'register' | 'forgot' | 'reset'

interface AuthViewProps {
  initialMode?: AuthMode
  resetToken?: string
  onSession: (session: Session) => void
  onResetComplete?: () => void
}

export default function AuthView({
  initialMode = 'login',
  resetToken = '',
  onSession,
  onResetComplete,
}: AuthViewProps) {
  const [mode, setMode] = useState<AuthMode>(resetToken ? 'reset' : initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [successMessage, setSuccessMessage] = useState('')
  const [passwordTouched, setPasswordTouched] = useState(false)

  const emailId = useId()
  const passwordId = useId()
  const confirmPasswordId = useId()
  const nameId = useId()
  const companyId = useId()

  const passwordRules = validatePassword(password)
  const emailValid = isValidEmail(email)
  const passwordsMatch = password === confirmPassword

  const switchMode = (newMode: AuthMode) => {
    setMode(newMode)
    setError(null)
    setSuccessMessage('')
    setPassword('')
    setConfirmPassword('')
    setPasswordTouched(false)
  }

  // Submit handlers
  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password || busy) return
    setBusy(true)
    setError(null)
    try {
      const session = await api.login({ email: email.trim(), password })
      onSession(session)
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleRegister(e: FormEvent) {
    e.preventDefault()
    if (!displayName.trim() || !emailValid || !passwordRules.isValid || !passwordsMatch || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.register({
        email: email.trim(),
        password,
        display_name: displayName.trim(),
        company_name: companyName.trim() || null,
      })
      switchMode('login')
      setSuccessMessage('Customer account created successfully. You can now sign in.')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleForgot(e: FormEvent) {
    e.preventDefault()
    if (!emailValid || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.forgotPassword(email.trim())
      setSuccessMessage(result.data.message)
      setPassword('')
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault()
    if (!resetToken || !passwordRules.isValid || !passwordsMatch || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await api.resetPassword(resetToken, password)
      setSuccessMessage(result.data.message)
      setPassword('')
      setConfirmPassword('')
      if (onResetComplete) {
        onResetComplete()
      }
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel live-auth-card" aria-labelledby="auth-title">
      <div className="auth-card-header">
        <div className="auth-brand-badge" aria-hidden="true">R</div>
        <div>
          <h2 id="auth-title">
            {mode === 'login' && 'Sign in to RevOps Shield'}
            {mode === 'register' && 'Create customer account'}
            {mode === 'forgot' && 'Password recovery & setup'}
            {mode === 'reset' && 'Set account password'}
          </h2>
          <p className="auth-subtitle">
            {mode === 'login' && 'Enter your credentials to access your workspace or customer portal.'}
            {mode === 'register' && 'Register a customer account with self-service billing access.'}
            {mode === 'forgot' && 'Request a password reset link or re-send an expired staff invitation link.'}
            {mode === 'reset' && 'Choose a secure new password for your RevOps Shield account.'}
          </p>
        </div>
      </div>

      {successMessage && <FormSuccess message={successMessage} />}
      {error !== null && <FormAlert error={error} />}

      {/* LOGIN FORM */}
      {mode === 'login' && (
        <form onSubmit={handleLogin} className="live-auth-form" noValidate>
          <div className="form-group">
            <label htmlFor={emailId}>Email address</label>
            <input
              id={emailId}
              type="email"
              autoComplete="username"
              required
              maxLength={254}
              placeholder="name@company.com"
              value={email}
              disabled={busy}
              onChange={e => setEmail(e.target.value)}
            />
          </div>

          <div className="form-group">
            <div className="label-with-link">
              <label htmlFor={passwordId}>Password</label>
              <button
                type="button"
                className="text-link"
                disabled={busy}
                onClick={() => switchMode('forgot')}
              >
                Forgot password?
              </button>
            </div>
            <input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              placeholder="Enter your password"
              value={password}
              disabled={busy}
              onChange={e => setPassword(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="primary-button auth-submit-btn"
            disabled={busy || !email.trim() || !password}
          >
            {busy ? 'Signing in…' : 'Sign in to workspace'}
          </button>

          <div className="auth-divider">
            <span>or</span>
          </div>

          <div className="auth-secondary-actions">
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={() => switchMode('register')}
            >
              Create customer account
            </button>
          </div>
        </form>
      )}

      {/* REGISTRATION FORM */}
      {mode === 'register' && (
        <form onSubmit={handleRegister} className="live-auth-form" noValidate>
          <div className="form-group">
            <label htmlFor={nameId}>Full name</label>
            <input
              id={nameId}
              type="text"
              autoComplete="name"
              required
              maxLength={200}
              placeholder="Jane Doe"
              value={displayName}
              disabled={busy}
              onChange={e => setDisplayName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor={companyId}>
              Company name <span className="field-optional">(optional)</span>
            </label>
            <input
              id={companyId}
              type="text"
              autoComplete="organization"
              maxLength={200}
              placeholder="Acme Inc."
              value={companyName}
              disabled={busy}
              onChange={e => setCompanyName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor={emailId}>Email address</label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="jane@example.com"
              value={email}
              disabled={busy}
              aria-invalid={email.length > 0 && !emailValid}
              onChange={e => setEmail(e.target.value)}
            />
            {email.length > 0 && !emailValid && (
              <small className="field-hint field-hint-error">Please enter a valid email address.</small>
            )}
          </div>

          <div className="form-group">
            <label htmlFor={passwordId}>Password</label>
            <input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              required
              minLength={9}
              maxLength={128}
              placeholder="At least 9 characters"
              value={password}
              disabled={busy}
              aria-invalid={passwordTouched && !passwordRules.isValid}
              onChange={e => {
                setPassword(e.target.value)
                setPasswordTouched(true)
              }}
            />
            <PasswordChecklist rules={passwordRules} touched={passwordTouched} />
          </div>

          <div className="form-group">
            <label htmlFor={confirmPasswordId}>Confirm password</label>
            <input
              id={confirmPasswordId}
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              placeholder="Re-enter your password"
              value={confirmPassword}
              disabled={busy}
              aria-invalid={confirmPassword.length > 0 && !passwordsMatch}
              onChange={e => setConfirmPassword(e.target.value)}
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <small className="field-hint field-hint-error">Passwords do not match.</small>
            )}
          </div>

          <button
            type="submit"
            className="primary-button auth-submit-btn"
            disabled={busy || !displayName.trim() || !emailValid || !passwordRules.isValid || !passwordsMatch}
          >
            {busy ? 'Creating account…' : 'Create customer account'}
          </button>

          <div className="auth-secondary-actions">
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => switchMode('login')}
            >
              ← Back to sign in
            </button>
          </div>
        </form>
      )}

      {/* FORGOT PASSWORD FORM */}
      {mode === 'forgot' && (
        <form onSubmit={handleForgot} className="live-auth-form" noValidate>
          <div className="form-group">
            <label htmlFor={emailId}>Registered email</label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              placeholder="name@company.com"
              value={email}
              disabled={busy}
              aria-invalid={email.length > 0 && !emailValid}
              onChange={e => setEmail(e.target.value)}
            />
            <small className="field-hint">
              We will send a secure single-use link. Staff setup links use the same recovery service.
            </small>
          </div>

          <button
            type="submit"
            className="primary-button auth-submit-btn"
            disabled={busy || !emailValid}
          >
            {busy ? 'Sending request…' : 'Send setup email'}
          </button>

          <div className="auth-secondary-actions">
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => switchMode('login')}
            >
              ← Back to sign in
            </button>
          </div>
        </form>
      )}

      {/* RESET PASSWORD FORM */}
      {mode === 'reset' && (
        <form onSubmit={handleReset} className="live-auth-form" noValidate>
          <div className="form-group">
            <label htmlFor={passwordId}>New password</label>
            <input
              id={passwordId}
              type="password"
              autoComplete="new-password"
              required
              minLength={9}
              maxLength={128}
              placeholder="Choose a strong password"
              value={password}
              disabled={busy}
              aria-invalid={passwordTouched && !passwordRules.isValid}
              onChange={e => {
                setPassword(e.target.value)
                setPasswordTouched(true)
              }}
            />
            <PasswordChecklist rules={passwordRules} touched={passwordTouched} />
          </div>

          <div className="form-group">
            <label htmlFor={confirmPasswordId}>Confirm new password</label>
            <input
              id={confirmPasswordId}
              type="password"
              autoComplete="new-password"
              required
              maxLength={128}
              placeholder="Re-enter new password"
              value={confirmPassword}
              disabled={busy}
              aria-invalid={confirmPassword.length > 0 && !passwordsMatch}
              onChange={e => setConfirmPassword(e.target.value)}
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <small className="field-hint field-hint-error">Passwords do not match.</small>
            )}
          </div>

          <button
            type="submit"
            className="primary-button auth-submit-btn"
            disabled={busy || !passwordRules.isValid || !passwordsMatch}
          >
            {busy ? 'Saving password…' : 'Save new password'}
          </button>

          <div className="auth-secondary-actions">
            <button
              type="button"
              className="text-link"
              disabled={busy}
              onClick={() => {
                switchMode('login')
                if (onResetComplete) onResetComplete()
              }}
            >
              ← Return to sign in
            </button>
          </div>
        </form>
      )}

      {/* Development accounts guide */}
      <div className="auth-dev-callout">
        <strong>Demo Development Accounts:</strong>
        <div className="dev-accounts-grid">
          <div><code>admin@brightloop.io</code><span>Admin role</span></div>
          <div><code>staff@brightloop.io</code><span>Staff role</span></div>
          <div><code>billing@acmestudio.com</code><span>Customer role</span></div>
        </div>
        <small>Password: <code>BrightloopDemo!2026</code> (Local development database only)</small>
      </div>
    </section>
  )
}

