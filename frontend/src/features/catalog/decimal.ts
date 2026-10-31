// Pure decimal validation and exact string formatting.
// Never convert financial values to JavaScript floating-point numbers.

const REGEX_DECIMAL_4 = /^(0|[1-9][0-9]{0,13})\.[0-9]{4}$/
const REGEX_DECIMAL_4_SIGNED = /^-?(0|[1-9][0-9]{0,13})\.[0-9]{4}$/
const REGEX_DECIMAL_2 = /^(0|[1-9][0-9]{0,15})\.[0-9]{2}$/
const REGEX_TAX_PERCENT = /^(0|[1-9][0-9]{0,2})\.[0-9]{4}$/

export function validateDecimal4(value: string, allowNegative = false): { valid: boolean; message?: string } {
  if (!value || typeof value !== 'string') return { valid: false, message: 'Amount is required.' }
  const trimmed = value.trim()
  const regex = allowNegative ? REGEX_DECIMAL_4_SIGNED : REGEX_DECIMAL_4
  if (!regex.test(trimmed)) {
    return { valid: false, message: allowNegative ? 'Must be a decimal with exactly 4 fractional digits (e.g. 10.0000 or -5.0000).' : 'Must be a non-negative decimal with exactly 4 fractional digits (e.g. 100.0000).' }
  }
  return { valid: true }
}

export function validateDecimal2(value: string): { valid: boolean; message?: string } {
  if (!value || typeof value !== 'string') return { valid: false, message: 'Amount is required.' }
  const trimmed = value.trim()
  if (!REGEX_DECIMAL_2.test(trimmed)) {
    return { valid: false, message: 'Must be a non-negative decimal with exactly 2 fractional digits (e.g. 499.00).' }
  }
  return { valid: true }
}

export function validateTaxRate(value: string): { valid: boolean; message?: string } {
  if (!value || typeof value !== 'string') return { valid: false, message: 'Tax rate percentage is required.' }
  const trimmed = value.trim()
  if (!REGEX_TAX_PERCENT.test(trimmed)) {
    return { valid: false, message: 'Tax rate must be a percentage with 4 fractional digits between 0.0000 and 100.0000% (e.g. 18.0000).' }
  }
  const [whole, fraction] = trimmed.split('.')
  const wholeNum = parseInt(whole, 10)
  if (wholeNum > 100 || (wholeNum === 100 && fraction !== '0000')) {
    return { valid: false, message: 'Tax rate cannot exceed 100.0000%.' }
  }
  return { valid: true }
}

export function normalizeDecimal(input: string, fractionDigits: 2 | 4, allowNegative = false): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  let isNegative = false
  let raw = trimmed
  if (raw.startsWith('-')) {
    if (!allowNegative) return null
    isNegative = true
    raw = raw.slice(1)
  } else if (raw.startsWith('+')) {
    raw = raw.slice(1)
  }

  const parts = raw.split('.')
  if (parts.length > 2) return null
  const [wholePart, fracPart = ''] = parts
  if (!/^\d+$/.test(wholePart)) return null
  if (fracPart.length > 0 && !/^\d+$/.test(fracPart)) return null

  // Strip leading zeros from whole part unless it's just "0"
  let cleanWhole = wholePart.replace(/^0+(?=\d)/, '')
  if (cleanWhole === '') cleanWhole = '0'

  if (fractionDigits === 2 && cleanWhole.length > 16) return null
  if (fractionDigits === 4 && cleanWhole.length > 14) return null

  const cleanFrac = (fracPart + '0'.repeat(fractionDigits)).slice(0, fractionDigits)
  const result = `${cleanWhole}.${cleanFrac}`

  if (isNegative && result !== '0.00' && result !== '0.0000') {
    return `-${result}`
  }
  return result
}

export function formatExactMoney(value: string, currency = 'INR'): string {
  if (!value) return '₹0.00'
  const isNegative = value.startsWith('-')
  const clean = isNegative ? value.slice(1) : value
  const [whole = '0', fraction = '00'] = clean.split('.')
  try {
    const symbol = currency === 'INR' ? '₹' : `${currency} `
    const formattedWhole = BigInt(whole).toLocaleString('en-IN')
    return `${isNegative ? '-' : ''}${symbol}${formattedWhole}.${fraction}`
  } catch {
    return `${currency} ${value}`
  }
}

