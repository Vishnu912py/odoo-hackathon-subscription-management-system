export interface PasswordRuleResult {
  hasMinLength: boolean
  hasUpper: boolean
  hasLower: boolean
  hasSpecial: boolean
  isValid: boolean
}

/**
 * RevOps Shield password policy:
 * - More than 8 characters (at least 9 characters, max 128)
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one special character
 */
export function validatePassword(password: string): PasswordRuleResult {
  const hasMinLength = password.length >= 9 && password.length <= 128
  const hasUpper = /[A-Z]/.test(password)
  const hasLower = /[a-z]/.test(password)
  const hasSpecial = /[^A-Za-z0-9]/.test(password)

  return {
    hasMinLength,
    hasUpper,
    hasLower,
    hasSpecial,
    isValid: hasMinLength && hasUpper && hasLower && hasSpecial,
  }
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

