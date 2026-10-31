import { ApiError, errorMessage } from '../../api/client'
import type { PasswordRuleResult } from './password-policy'

export function FormAlert({ error }: { error: unknown }) {
  if (!error) return null

  const isApiErr = error instanceof ApiError
  const message = errorMessage(error)
  const fields = isApiErr ? error.fields : []
  const requestId = isApiErr ? error.requestId : undefined
  const code = isApiErr ? error.code : undefined

  return (
    <div className="live-alert live-alert-error" role="alert">
      <div className="live-alert-header">
        <span className="live-alert-icon" aria-hidden="true">⚠</span>
        <div className="live-alert-content">
          <p className="live-alert-title">{message}</p>
          {code && <span className="live-error-code">Code: {code}</span>}
        </div>
      </div>
      {fields.length > 0 && (
        <ul className="live-field-errors">
          {fields.map((field, idx) => (
            <li key={`${field.path}-${idx}`}>
              <strong>{field.path}</strong>: {field.message}
            </li>
          ))}
        </ul>
      )}
      {requestId && (
        <div className="live-request-ref">
          <small>Request ID: {requestId}</small>
        </div>
      )}
    </div>
  )
}

export function FormSuccess({ message }: { message: string }) {
  if (!message) return null
  return (
    <div className="live-alert live-alert-success" role="status">
      <span className="live-alert-icon" aria-hidden="true">✓</span>
      <p className="live-alert-title">{message}</p>
    </div>
  )
}

export function PasswordChecklist({ rules, touched }: { rules: PasswordRuleResult; touched: boolean }) {
  const items = [
    { label: 'At least 9 characters (max 128)', passed: rules.hasMinLength },
    { label: 'At least one uppercase letter (A–Z)', passed: rules.hasUpper },
    { label: 'At least one lowercase letter (a–z)', passed: rules.hasLower },
    { label: 'At least one special character (!@#$…)', passed: rules.hasSpecial },
  ]

  return (
    <div className={`password-checklist ${touched ? 'touched' : ''}`} aria-label="Password requirements">
      <span className="checklist-heading">Password requirements:</span>
      <ul>
        {items.map((item, i) => (
          <li key={i} className={item.passed ? 'rule-met' : 'rule-unmet'}>
            <span className="rule-icon" aria-hidden="true">{item.passed ? '✓' : '○'}</span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

