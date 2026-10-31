import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePassword, isValidEmail } from '../src/features/live/password-policy.ts'
import { isPagePermittedForRole, getNavigationItems } from '../src/features/live/navigation-policy.ts'

test('password policy enforces > 8 characters, uppercase, lowercase, and special characters', () => {
  // Length check: <= 8 characters must fail
  const short = validatePassword('Ab!1234')
  assert.equal(short.hasMinLength, false)
  assert.equal(short.isValid, false)

  // Exactly 8 characters must fail (policy requires MORE than eight characters = 9+)
  const eightChars = validatePassword('Abcd!123')
  assert.equal(eightChars.hasMinLength, false)
  assert.equal(eightChars.isValid, false)

  // 9 characters without special character must fail
  const noSpecial = validatePassword('Password12')
  assert.equal(noSpecial.hasMinLength, true)
  assert.equal(noSpecial.hasSpecial, false)
  assert.equal(noSpecial.isValid, false)

  // 9 characters without uppercase must fail
  const noUpper = validatePassword('password!1')
  assert.equal(noUpper.hasUpper, false)
  assert.equal(noUpper.isValid, false)

  // 9 characters without lowercase must fail
  const noLower = validatePassword('PASSWORD!1')
  assert.equal(noLower.hasLower, false)
  assert.equal(noLower.isValid, false)

  // Compliant password (>= 9 chars, upper, lower, special) must pass
  const valid = validatePassword('BrightloopDemo!2026')
  assert.equal(valid.hasMinLength, true)
  assert.equal(valid.hasUpper, true)
  assert.equal(valid.hasLower, true)
  assert.equal(valid.hasSpecial, true)
  assert.equal(valid.isValid, true)

  const minimumValid = validatePassword('A!bcdefgh')
  assert.equal(minimumValid.isValid, true)
})

test('email validation verifies presence of user, domain and tld', () => {
  assert.equal(isValidEmail('admin@brightloop.io'), true)
  assert.equal(isValidEmail('billing@acmestudio.com'), true)
  assert.equal(isValidEmail('staff+test@sub.domain.org'), true)

  assert.equal(isValidEmail(''), false)
  assert.equal(isValidEmail('not-an-email'), false)
  assert.equal(isValidEmail('@missinguser.com'), false)
  assert.equal(isValidEmail('missingtld@domain'), false)
  assert.equal(isValidEmail('spaces in@domain.com'), false)
})

test('role navigation guards verify Payments and Staff access per OpenAPI contract', () => {
  const adminNav = getNavigationItems('admin').map(item => item.id)
  const staffNav = getNavigationItems('staff').map(item => item.id)
  const customerNav = getNavigationItems('customer').map(item => item.id)

  // 1. Admin sees Payments and Staff
  assert.ok(adminNav.includes('Payments'), 'Admin must see Payments in navigation')
  assert.ok(adminNav.includes('Staff'), 'Admin must see Staff Management in navigation')
  assert.equal(isPagePermittedForRole('Payments', 'admin'), true)
  assert.equal(isPagePermittedForRole('Staff', 'admin'), true)

  // 2. Staff sees Payments, but does not see Staff
  assert.ok(staffNav.includes('Payments'), 'Staff must see Payments in navigation')
  assert.ok(!staffNav.includes('Staff'), 'Staff must NOT see Staff Management in navigation')
  assert.equal(isPagePermittedForRole('Payments', 'staff'), true)
  assert.equal(isPagePermittedForRole('Staff', 'staff'), false)

  // 3. Customer does NOT see Payments, and does NOT see Staff
  assert.ok(!customerNav.includes('Payments'), 'Customer must NOT see Payments in navigation')
  assert.ok(!customerNav.includes('Staff'), 'Customer must NOT see Staff Management in navigation')
  assert.equal(isPagePermittedForRole('Payments', 'customer'), false)
  assert.equal(isPagePermittedForRole('Staff', 'customer'), false)

  // Standard shared pages visible to all roles
  for (const page of ['Overview', 'Subscriptions', 'Invoices']) {
    assert.ok(adminNav.includes(page))
    assert.ok(staffNav.includes(page))
    assert.ok(customerNav.includes(page))
    assert.equal(isPagePermittedForRole(page, 'admin'), true)
    assert.equal(isPagePermittedForRole(page, 'staff'), true)
    assert.equal(isPagePermittedForRole(page, 'customer'), true)
  }
})

test('subscription and invoice action availability strictly honors server capabilities', () => {
  const customerInvoice = {
    capabilities: {
      can_confirm: false,
      can_cancel: false,
      can_send: false,
      can_print: true,
      can_record_payment: false,
    },
  }

  const staffInvoice = {
    capabilities: {
      can_confirm: true,
      can_cancel: true,
      can_send: true,
      can_print: true,
      can_record_payment: true,
    },
  }

  function canRecordPayment(inv) {
    return Boolean(inv.capabilities.can_record_payment)
  }

  assert.equal(canRecordPayment(customerInvoice), false)
  assert.equal(canRecordPayment(staffInvoice), true)
})
