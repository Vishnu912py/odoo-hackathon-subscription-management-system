import test from 'node:test'
import assert from 'node:assert/strict'
import { ApiClient, ApiError, errorMessage } from '../src/api/client.ts'
import { money } from '../src/api/format.ts'

test('money formatting preserves large decimal amounts and fractional zeros exactly', () => {
  assert.equal(money('1180.00'), '₹1,180.00')
  assert.equal(money('9999999999999999.99'), '₹9,99,99,99,99,99,99,999.99')
  assert.equal(money('0.01'), '₹0.01')
})

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const session = { user: { id: 'user', role: 'staff' }, csrf_token: 'rotated-token', expires_at: '2026-11-01T00:00:00Z' }

test('password recovery sends secrets only in POST bodies and renews CSRF after reset', async () => {
  const requests = []
  const client = new ApiClient(async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith('/csrf')) return json({ data: { csrf_token: 'csrf-' + requests.length } })
    if (url.endsWith('/login')) return json({ data: session })
    return json({ data: { message: 'Accepted' } })
  })
  await client.forgotPassword('member@example.test')
  await client.resetPassword('single-use-secret', 'NewPassword!123')
  await client.login({ email: 'member@example.test', password: 'NewPassword!123' })
  assert.equal(requests.filter(r => r.url.endsWith('/csrf')).length, 2)
  const reset = requests.find(r => r.url.endsWith('/reset-password'))
  assert.equal(reset.options.method, 'POST')
  assert.equal(reset.options.credentials, 'include')
  assert.deepEqual(JSON.parse(reset.options.body), { token: 'single-use-secret', password: 'NewPassword!123' })
  assert.ok(requests.every(r => !r.url.includes('single-use-secret') && !r.url.includes('NewPassword')))
})

test('login obtains anonymous CSRF, includes cookies, then uses rotated CSRF for logout', async () => {
  const requests = []
  const client = new ApiClient(async (url, options) => {
    requests.push({ url, options })
    if (url.endsWith('/csrf')) return json({ data: { csrf_token: 'anonymous-token' } })
    if (url.endsWith('/login')) return json({ data: session })
    return new Response(null, { status: 204 })
  })
  assert.deepEqual(await client.login({ email: 'staff@example.com', password: 'Example!Password' }), session)
  await client.logout()
  assert.deepEqual(requests.map(r => r.url), ['/api/v1/auth/csrf', '/api/v1/auth/login', '/api/v1/auth/logout'])
  assert.ok(requests.every(r => r.options.credentials === 'include'))
  assert.equal(requests[1].options.headers['X-CSRF-Token'], 'anonymous-token')
  assert.equal(requests[2].options.headers['X-CSRF-Token'], 'rotated-token')
  assert.equal(requests[2].options.body, '{}')
})

test('concurrent mutations share one initial CSRF request; prepared retries preserve key, body, version and decimal strings', async () => {
  const requests = []
  const client = new ApiClient(async (url, options) => {
    requests.push({ url, options })
    return json({ data: url.endsWith('/csrf') ? { csrf_token: 'token' } : { ok: true } })
  })
  const input = { amount: '680.00', method: 'bank_transfer', payment_date: '2026-10-31' }
  const action = client.prepare('/invoices/123/payments', 'POST', input, 3)
  input.amount = '999.00'
  await Promise.all([client.send(action), client.send(action)])
  assert.equal(requests.filter(r => r.url.endsWith('/csrf')).length, 1)
  const writes = requests.filter(r => r.url.endsWith('/payments'))
  assert.equal(writes.length, 2)
  assert.equal(writes[0].options.headers['Idempotency-Key'], writes[1].options.headers['Idempotency-Key'])
  assert.equal(writes[0].options.headers['If-Match'], '"3"')
  assert.equal(JSON.parse(writes[0].options.body).amount, '680.00')
})

test('server errors preserve status, fields and request ID without falling back to fixtures', async () => {
  for (const status of [401, 403, 409, 412, 422, 501]) {
    const client = new ApiClient(async () => json({ error: { code: 'TEST_ERROR', message: 'Rejected', request_id: 'request-1', fields: [{ path: 'amount', code: 'range', message: 'Too large' }] } }, status))
    await assert.rejects(client.get('/invoices'), error => {
      assert.ok(error instanceof ApiError)
      assert.equal(error.status, status)
      assert.equal(error.requestId, 'request-1')
      assert.equal(error.fields[0].path, 'amount')
      if (status === 501) assert.match(errorMessage(error), /not implemented/)
      return true
    })
  }
})

test('unauthorized requests invalidate cached CSRF and require a fresh token', async () => {
  let csrfCount = 0
  const client = new ApiClient(async url => {
    if (url.endsWith('/csrf')) return json({ data: { csrf_token: `token-${++csrfCount}` } })
    return json({ error: { code: 'UNAUTHENTICATED', message: 'Expired' } }, 401)
  })
  assert.equal(await client.csrf(), 'token-1')
  await assert.rejects(client.me(), { status: 401 })
  assert.equal(await client.csrf(), 'token-2')
})

test('query encoding, empty collections, and genuine failures remain distinct', async () => {
  let path
  const empty = { data: [], meta: { page: 2, page_size: 20, total: 0, total_pages: 0 } }
  const client = new ApiClient(async url => { path = url; return json(empty) })
  assert.deepEqual(await client.get('/subscriptions', { page: 2, q: 'A & B', is_paused: false, omitted: undefined }), empty)
  assert.equal(path, '/api/v1/subscriptions?page=2&q=A+%26+B&is_paused=false')
  await assert.rejects(new ApiClient(async () => new Response('<html>proxy failure</html>', { status: 502 })).get('/invoices'), { status: 502 })
  await assert.rejects(new ApiClient(async () => json({ unexpected: [] })).get('/invoices'), { code: 'INVALID_RESPONSE' })
  await assert.rejects(new ApiClient(async () => { throw new TypeError('fetch failed') }).get('/invoices'), { code: 'NETWORK_ERROR' })
})

test('501 authentication does not attempt login with a fabricated session', async () => {
  const paths = []
  const client = new ApiClient(async url => { paths.push(url); return json({ error: { code: 'NOT_IMPLEMENTED', message: 'Pending' } }, 501) })
  await assert.rejects(client.login({ email: 'x@example.com', password: 'Password!' }), { status: 501 })
  assert.deepEqual(paths, ['/api/v1/auth/csrf'])
})

test('failed mutation is not retried automatically; manual retry reuses the prepared operation', async () => {
  let writes = 0
  const client = new ApiClient(async url => {
    if (url.endsWith('/csrf')) return json({ data: { csrf_token: 'token' } })
    writes++
    if (writes === 1) throw new TypeError('response lost')
    return json({ data: { id: 'persisted-payment' } }, 201)
  })
  const action = client.prepare('/invoices/123/payments', 'POST', { amount: '1.00' }, 1)
  await assert.rejects(client.send(action), { code: 'NETWORK_ERROR' })
  assert.equal(writes, 1)
  assert.deepEqual(await client.send(action), { data: { id: 'persisted-payment' } })
})

test('request cancellation propagates without becoming a network error', async () => {
  const controller = new AbortController()
  controller.abort()
  const client = new ApiClient(async (_url, options) => { options.signal.throwIfAborted() })
  await assert.rejects(client.get('/invoices', {}, controller.signal), { name: 'AbortError' })
})

test('timeouts report a distinct actionable error', async () => {
  const keepAlive = setTimeout(() => {}, 200)
  try {
    const client = new ApiClient(async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })
    }), 5)
    await assert.rejects(client.get('/invoices'), { code: 'TIMEOUT' })
  } finally { clearTimeout(keepAlive) }
})
