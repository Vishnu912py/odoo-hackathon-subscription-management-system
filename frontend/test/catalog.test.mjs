import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiClient, ApiError, errorMessage } from '../src/api/client.ts'
import {
  getAllowedTabsForRole,
  isTabAllowedForRole,
  CATALOG_ADMIN_TABS,
  BASE_TABS,
} from '../src/features/catalog/navigation.ts'
import {
  validateDecimal4,
  validateDecimal2,
  validateTaxRate,
  normalizeDecimal,
  formatExactMoney,
} from '../src/features/catalog/decimal.ts'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('admin-only catalog navigation includes all catalog tabs only for admin', () => {
  const adminTabs = getAllowedTabsForRole('admin')
  for (const catTab of CATALOG_ADMIN_TABS) {
    assert.ok(adminTabs.includes(catTab), `Admin should have access to ${catTab}`)
    assert.equal(isTabAllowedForRole(catTab, 'admin'), true)
  }
  assert.ok(adminTabs.includes('Staff'))
  assert.ok(adminTabs.includes('Overview'))
  assert.ok(adminTabs.includes('Subscriptions'))
  assert.ok(adminTabs.includes('Invoices'))
  assert.ok(adminTabs.includes('Payments'))
})

test('staff and customer restrictions prohibit catalog and staff navigation', () => {
  for (const role of ['staff', 'customer']) {
    const tabs = getAllowedTabsForRole(role)
    assert.deepEqual([...tabs], BASE_TABS.filter(tab => role !== 'customer' || (tab !== 'Payments' && tab !== 'Customers')))

    for (const catTab of CATALOG_ADMIN_TABS) {
      assert.equal(tabs.includes(catTab), false, `${role} must not see ${catTab}`)
      assert.equal(isTabAllowedForRole(catTab, role), false, `${role} must not be allowed to open ${catTab}`)
    }
    assert.equal(tabs.includes('Staff'), false, `${role} must not see Staff tab`)
    assert.equal(isTabAllowedForRole('Staff', role), false, `${role} must not access Staff`)

    // Base tabs remain allowed
    for (const baseTab of BASE_TABS) {
      assert.equal(isTabAllowedForRole(baseTab, role), !(role === 'customer' && (baseTab === 'Payments' || baseTab === 'Customers')), `${role} must be allowed on ${baseTab}`)
    }
  }
})

test('product and variant form validation enforces exact 4-decimal format and attributes limit', () => {
  // Sales & cost price: strictly 4 decimals non-negative
  assert.equal(validateDecimal4('100.0000').valid, true)
  assert.equal(validateDecimal4('0.0000').valid, true)
  assert.equal(validateDecimal4('99999999999999.9999').valid, true)

  assert.equal(validateDecimal4('100').valid, false)
  assert.equal(validateDecimal4('100.5').valid, false)
  assert.equal(validateDecimal4('100.50').valid, false)
  assert.equal(validateDecimal4('100.50000').valid, false)
  assert.equal(validateDecimal4('-10.0000').valid, false) // negative disallowed by default
  assert.equal(validateDecimal4('abc').valid, false)
  assert.equal(validateDecimal4('').valid, false)

  // Variant price adjustment can be negative or positive with 4 decimals
  assert.equal(validateDecimal4('-10.0000', true).valid, true)
  assert.equal(validateDecimal4('25.5000', true).valid, true)
  assert.equal(validateDecimal4('0.0000', true).valid, true)
  assert.equal(validateDecimal4('-10', true).valid, false)
  assert.equal(validateDecimal4('-10.5', true).valid, false)

  // Normalization helper handles user input string formatting
  assert.equal(normalizeDecimal('100', 4), '100.0000')
  assert.equal(normalizeDecimal('50.5', 4), '50.5000')
  assert.equal(normalizeDecimal('0', 4), '0.0000')
  assert.equal(normalizeDecimal('-15', 4, true), '-15.0000')
  assert.equal(normalizeDecimal('-15.25', 4, true), '-15.2500')
  assert.equal(normalizeDecimal('invalid', 4), null)
})

test('plan pricing and billing interval validation preserves exact decimal string', () => {
  // Plan price: strictly 2-decimals non-negative INR
  assert.equal(validateDecimal2('999.00').valid, true)
  assert.equal(validateDecimal2('0.00').valid, true)
  assert.equal(validateDecimal2('15000.50').valid, true)

  assert.equal(validateDecimal2('999').valid, false)
  assert.equal(validateDecimal2('999.5').valid, false)
  assert.equal(validateDecimal2('999.500').valid, false)
  assert.equal(validateDecimal2('-10.00').valid, false)

  // Exact money formatting without float conversion
  assert.equal(formatExactMoney('999.00'), '₹999.00')
  assert.equal(formatExactMoney('150000.50'), '₹1,50,000.50')
  assert.equal(formatExactMoney('-500.00'), '-₹500.00')

  // Normalization
  assert.equal(normalizeDecimal('999', 2), '999.00')
  assert.equal(normalizeDecimal('999.5', 2), '999.50')
  assert.equal(normalizeDecimal('999.99', 2), '999.99')
})

test('tax rate percentage and discount validation enforce bounds and immutability rules', () => {
  // Tax rate percentage: 4 decimals, 0.0000 to 100.0000
  assert.equal(validateTaxRate('18.0000').valid, true)
  assert.equal(validateTaxRate('0.0000').valid, true)
  assert.equal(validateTaxRate('5.5000').valid, true)
  assert.equal(validateTaxRate('100.0000').valid, true)

  assert.equal(validateTaxRate('100.0001').valid, false)
  assert.equal(validateTaxRate('105.0000').valid, false)
  assert.equal(validateTaxRate('18').valid, false)
  assert.equal(validateTaxRate('18.5').valid, false)
  assert.equal(validateTaxRate('-1.0000').valid, false)

  // Normalization
  assert.equal(normalizeDecimal('18', 4), '18.0000')
  assert.equal(normalizeDecimal('5.5', 4), '5.5000')
})

test('API 501 responses are not treated as success and report actionable status', async () => {
  const client = new ApiClient(async (url) => {
    if (url.includes('/csrf')) return json({ data: { csrf_token: 'test-csrf' } })
    return json({
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Operation listProduct is not implemented yet.',
        fields: [],
        request_id: 'req-501-test',
      },
    }, 501)
  })

  await assert.rejects(
    async () => {
      await client.get('/products')
    },
    (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 501)
      assert.equal(err.code, 'NOT_IMPLEMENTED')
      assert.equal(err.requestId, 'req-501-test')
      assert.equal(
        errorMessage(err),
        'This backend feature is not implemented yet. No live records are available.'
      )
      return true
    }
  )

  // Mutations to 501 also reject without fabricating success
  const mutation = client.prepare('/products', 'POST', { name: 'Test' })
  await assert.rejects(
    async () => {
      await client.send(mutation)
    },
    (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 501)
      return true
    }
  )
})

test('correct use of existing API methods and contract fields with CSRF, idempotency and If-Match', async () => {
  const sentRequests = []
  const client = new ApiClient(async (url, options) => {
    sentRequests.push({ url, options })
    if (url.includes('/csrf')) return json({ data: { csrf_token: 'valid-csrf-token' } })
    return json({ data: { id: 'prod-uuid-1', version: 2 } })
  })

  // 1. GET with query parameters
  await client.get('/products', { page: 2, page_size: 20, q: 'analytics', is_active: true })
  const getReq = sentRequests.find(r => r.url.includes('/products?'))
  assert.ok(getReq)
  assert.ok(getReq.url.includes('page=2'))
  assert.ok(getReq.url.includes('page_size=20'))
  assert.ok(getReq.url.includes('q=analytics'))
  assert.ok(getReq.url.includes('is_active=true'))

  // 2. POST create mutation with idempotency key and CSRF
  const createProductAction = client.prepare('/products', 'POST', {
    name: 'Security Shield',
    product_type: 'service',
    sales_price: '500.0000',
    cost_price: '200.0000',
    tax_ids: [],
    is_active: true,
  })
  await client.send(createProductAction)

  const postReq = sentRequests.find(r => r.options.method === 'POST' && r.url.endsWith('/products'))
  assert.ok(postReq)
  assert.equal(postReq.options.headers['X-CSRF-Token'], 'valid-csrf-token')
  assert.equal(postReq.options.headers['Idempotency-Key'], createProductAction.key)
  assert.equal(postReq.options.headers['If-Match'], undefined)

  const parsedBody = JSON.parse(postReq.options.body)
  assert.equal(parsedBody.name, 'Security Shield')
  assert.equal(parsedBody.sales_price, '500.0000')

  // 3. PATCH update mutation with If-Match version precondition
  const updateProductAction = client.prepare('/products/prod-uuid-1', 'PATCH', {
    name: 'Security Shield Enterprise',
    is_active: false,
  }, 2)
  await client.send(updateProductAction)

  const patchReq = sentRequests.find(r => r.options.method === 'PATCH' && r.url.endsWith('/products/prod-uuid-1'))
  assert.ok(patchReq)
  assert.equal(patchReq.options.headers['X-CSRF-Token'], 'valid-csrf-token')
  assert.equal(patchReq.options.headers['Idempotency-Key'], updateProductAction.key)
  assert.equal(patchReq.options.headers['If-Match'], '"2"')
})

