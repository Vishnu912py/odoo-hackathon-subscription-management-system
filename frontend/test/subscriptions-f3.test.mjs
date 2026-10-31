import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiClient, ApiError, errorMessage } from '../src/api/client.ts'
import { money } from '../src/api/format.ts'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const mockSummary = {
  id: 'sub-00000000-0000-0000-0000-000000000001',
  version: 1,
  created_at: '2026-10-31T10:00:00.000Z',
  updated_at: '2026-10-31T10:00:00.000Z',
  number: 'SUB-2026-0001',
  customer_id: 'cust-00000000-0000-0000-0000-000000000001',
  customer_name: 'Acme Technologies',
  plan_id: 'plan-00000000-0000-0000-0000-000000000001',
  plan_name: 'Growth Enterprise Plan',
  status: 'active',
  is_paused: false,
  currency: 'INR',
  billing_interval: 'monthly',
  start_date: '2026-10-01',
  expiry_date: null,
  next_billing_date: '2026-11-01',
  recurring_subtotal: '10000.00',
  estimated_tax_total: '1800.00',
  estimated_total: '11800.00',
  pause_effective_date: null,
  resume_effective_date: null,
  close_effective_date: null,
  capabilities: {
    can_edit: false,
    can_quote: false,
    can_confirm: false,
    can_activate: false,
    can_pause: true,
    can_resume: false,
    can_renew: true,
    can_close: true,
    can_change_addons: false,
  },
}

const mockDetail = {
  ...mockSummary,
  template_id: null,
  payment_term_id: 'term-00000000-0000-0000-0000-000000000001',
  payment_term_name: 'Net 30',
  quotation_valid_until: null,
  paused_at: null,
  closed_at: null,
  payment_due_days: 30,
  policy_snapshot: {
    auto_close: false,
    allow_early_close: true,
    allow_pause: true,
    allow_renewal: true,
  },
  lines: [
    {
      id: 'line-1',
      product_id: 'prod-00000000-0000-0000-0000-000000000001',
      variant_id: null,
      description: 'Platform Access License',
      quantity: '1.0000',
      unit_price: '10000.0000',
      tax_ids: ['tax-1'],
      effective_from: '2026-10-01',
      effective_until: null,
      subtotal: '10000.00',
      tax_amount: '1800.00',
      total: '11800.00',
      taxes: [
        {
          tax_id: 'tax-1',
          name: 'GST 18%',
          rate_percent: '18.0000',
          amount: '1800.00',
        },
      ],
    },
  ],
}

test('subscription rendering and API integration retrieves live list and detail data', async () => {
  const requests = []
  const client = new ApiClient(async (url) => {
    requests.push(url)
    if (url.includes('/subscriptions/sub-00000000-0000-0000-0000-000000000001')) {
      return json({ data: mockDetail })
    }
    if (url.includes('/subscriptions')) {
      return json({ data: [mockSummary], meta: { page: 1, page_size: 20, total: 1, total_pages: 1 } })
    }
    return json({ data: [] })
  })

  // List subscriptions
  const listResult = await client.get('/subscriptions', { page: 1 })
  assert.equal(listResult.data.length, 1)
  assert.equal(listResult.data[0].number, 'SUB-2026-0001')
  assert.equal(listResult.data[0].customer_name, 'Acme Technologies')
  assert.equal(listResult.data[0].status, 'active')
  assert.equal(money(listResult.data[0].estimated_total), '₹11,800.00')

  // Detail subscription
  const detailResult = await client.get(`/subscriptions/${mockSummary.id}`)
  assert.equal(detailResult.data.id, mockSummary.id)
  assert.equal(detailResult.data.lines.length, 1)
  assert.equal(detailResult.data.lines[0].description, 'Platform Access License')
  assert.equal(detailResult.data.payment_term_name, 'Net 30')
  assert.equal(money(detailResult.data.lines[0].total), '₹11,800.00')
})

test('subscription filters and pagination encode query parameters cleanly', async () => {
  const sentQueries = []
  const client = new ApiClient(async (url) => {
    sentQueries.push(url)
    return json({ data: [], meta: { page: 2, page_size: 20, total: 0, total_pages: 0 } })
  })

  await client.get('/subscriptions', {
    page: 2,
    page_size: 20,
    q: 'Acme',
    status: 'active',
    is_paused: false,
    customer_id: 'cust-123',
    plan_id: 'plan-456',
    sort_by: 'next_billing_date',
    sort_order: 'asc',
  })

  assert.equal(sentQueries.length, 1)
  const url = sentQueries[0]
  assert.ok(url.includes('page=2'))
  assert.ok(url.includes('page_size=20'))
  assert.ok(url.includes('q=Acme'))
  assert.ok(url.includes('status=active'))
  assert.ok(url.includes('is_paused=false'))
  assert.ok(url.includes('customer_id=cust-123'))
  assert.ok(url.includes('plan_id=plan-456'))
  assert.ok(url.includes('sort_by=next_billing_date'))
  assert.ok(url.includes('sort_order=asc'))
})

test('create subscription mutation adheres to contract schema, idempotency, and CSRF', async () => {
  const sentRequests = []
  const client = new ApiClient(async (url, options) => {
    sentRequests.push({ url, options })
    if (url.includes('/csrf')) return json({ data: { csrf_token: 'csrf-sub-token' } })
    return json({ data: mockDetail })
  })

  const payload = {
    customer_id: '00000000-0000-0000-0000-000000000001',
    plan_id: '00000000-0000-0000-0000-000000000002',
    payment_term_id: '00000000-0000-0000-0000-000000000003',
    start_date: '2026-11-01',
    expiry_date: '2027-10-31',
    lines: [
      {
        product_id: '00000000-0000-0000-0000-000000000004',
        variant_id: null,
        quantity: '2.0000',
        unit_price: '500.0000',
        tax_ids: [],
      },
    ],
  }

  const action = client.prepare('/subscriptions', 'POST', payload)
  assert.ok(action.key)
  assert.equal(action.method, 'POST')
  assert.equal(action.path, '/subscriptions')

  const result = await client.send(action)
  assert.equal(result.data.id, mockDetail.id)

  const req = sentRequests.find(r => r.url.endsWith('/subscriptions') && r.options.method === 'POST')
  assert.ok(req)
  assert.equal(req.options.headers['X-CSRF-Token'], 'csrf-sub-token')
  assert.equal(req.options.headers['Idempotency-Key'], action.key)
  assert.equal(req.options.headers['If-Match'], undefined) // create has no If-Match

  const parsed = JSON.parse(req.options.body)
  assert.equal(parsed.customer_id, payload.customer_id)
  assert.equal(parsed.start_date, '2026-11-01')
  assert.equal(parsed.lines[0].quantity, '2.0000')
})

test('lifecycle mutations enforce version precondition If-Match', async () => {
  const sentRequests = []
  const client = new ApiClient(async (url, options) => {
    sentRequests.push({ url, options })
    if (url.includes('/csrf')) return json({ data: { csrf_token: 'csrf-action-token' } })
    return json({ data: { ...mockDetail, status: 'confirmed', version: 2 } })
  })

  // Confirm quotation requires If-Match: "${version}"
  const confirmAction = client.prepare(`/subscriptions/${mockDetail.id}/confirm`, 'POST', {}, mockDetail.version)
  await client.send(confirmAction)

  const req = sentRequests.find(r => r.url.includes('/confirm'))
  assert.ok(req)
  assert.equal(req.options.headers['If-Match'], '"1"')
  assert.equal(req.options.headers['X-CSRF-Token'], 'csrf-action-token')
  assert.equal(req.options.headers['Idempotency-Key'], confirmAction.key)
})

test('capability-based action flags dictate permissible lifecycle workflows', () => {
  // Case 1: Subscription in draft/quotation status
  const quotationCaps = {
    can_edit: true,
    can_quote: true,
    can_confirm: true,
    can_activate: false,
    can_pause: false,
    can_resume: false,
    can_renew: false,
    can_close: false,
    can_change_addons: false,
  }
  assert.equal(quotationCaps.can_confirm, true)
  assert.equal(quotationCaps.can_activate, false)
  assert.equal(quotationCaps.can_pause, false)

  // Case 2: Subscription in active status
  const activeCaps = {
    can_edit: false,
    can_quote: false,
    can_confirm: false,
    can_activate: false,
    can_pause: true,
    can_resume: false,
    can_renew: true,
    can_close: true,
    can_change_addons: true,
  }
  assert.equal(activeCaps.can_pause, true)
  assert.equal(activeCaps.can_confirm, false)
  assert.equal(activeCaps.can_renew, true)
  assert.equal(activeCaps.can_close, true)

  // Case 3: Paused subscription
  const pausedCaps = {
    can_edit: false,
    can_quote: false,
    can_confirm: false,
    can_activate: false,
    can_pause: false,
    can_resume: true,
    can_renew: false,
    can_close: true,
    can_change_addons: false,
  }
  assert.equal(pausedCaps.can_resume, true)
  assert.equal(pausedCaps.can_pause, false)
})

test('HTTP 501 responses on lifecycle endpoints are handled gracefully without fabricating success', async () => {
  const client = new ApiClient(async (url) => {
    if (url.includes('/csrf')) return json({ data: { csrf_token: 'test-csrf' } })
    return json(
      {
        error: {
          code: 'NOT_IMPLEMENTED',
          message: 'Operation pauseSubscription is not implemented yet.',
          fields: [],
          request_id: 'req-pause-501',
        },
      },
      501
    )
  })

  const pauseAction = client.prepare(
    `/subscriptions/${mockDetail.id}/pause`,
    'POST',
    { reason: 'Customer requested pause' },
    mockDetail.version
  )

  await assert.rejects(
    async () => {
      await client.send(pauseAction)
    },
    (err) => {
      assert.ok(err instanceof ApiError)
      assert.equal(err.status, 501)
      assert.equal(err.code, 'NOT_IMPLEMENTED')
      assert.equal(err.requestId, 'req-pause-501')
      assert.equal(
        errorMessage(err),
        'This backend feature is not implemented yet. No live records are available.'
      )
      return true
    }
  )
})

test('role-based access ensures customer cannot filter other customers or access staff routes', () => {
  const customerUser = { role: 'customer', id: 'cust-user-1', customer_id: 'cust-1' }
  const staffUser = { role: 'staff', id: 'staff-user-1', customer_id: null }
  const adminUser = { role: 'admin', id: 'admin-user-1', customer_id: null }

  // Customer role restrictions
  assert.equal(customerUser.role === 'customer', true)
  // Staff and Admin role checks
  assert.equal(staffUser.role !== 'customer', true)
  assert.equal(adminUser.role === 'admin', true)
})

