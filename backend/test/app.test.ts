import assert from 'node:assert/strict';
import test from 'node:test';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { loadContract } from '../src/contracts.js';
import { errorHandler, HttpError } from '../src/http/errors.js';
import { requestContext } from '../src/http/request-context.js';
import type { DatabaseState } from '../src/db/client.js';
import type { RequestLog } from '../src/http/request-context.js';
import express from 'express';

const config = loadConfig({ NODE_ENV: 'test' });
const makeApp = (state: DatabaseState = 'not_configured') => createApp(config, {
  database: { probe: async () => state, close: async () => undefined },
});

test('liveness works without a database and exposes no framework fingerprint', async () => {
  const response = await request(makeApp()).get('/health/live').expect(200);
  assert.equal(response.body.data.status, 'ok');
  assert.equal(response.headers['x-powered-by'], undefined);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.match(response.headers['x-request-id'] ?? '', /^[0-9a-f-]{36}$/);
});

test('readiness fails closed without a configured or available database', async () => {
  for (const state of ['not_configured', 'unavailable'] as const) {
    const response = await request(makeApp(state)).get('/health/ready').expect(503);
    assert.deepEqual(response.body, { data: { status: 'not_ready', database: state } });
  }
  const response = await request(makeApp('connected')).get('/health/ready').expect(200);
  assert.equal(response.body.data.database, 'connected');
});

test('configured frontend can send credentialed requests and preconditions', async () => {
  const response = await request(makeApp()).options('/api/v1/invoices/example/payments')
    .set('Origin', config.frontendOrigin)
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type,x-csrf-token,idempotency-key,if-match')
    .expect(204);
  assert.equal(response.headers['access-control-allow-origin'], config.frontendOrigin);
  assert.equal(response.headers['access-control-allow-credentials'], 'true');
  assert.match(response.headers['access-control-allow-headers'] ?? '', /If-Match/i);
});

test('unapproved browser origin receives the standard error envelope', async () => {
  const response = await request(makeApp()).get('/health/live')
    .set('Origin', 'https://unapproved.example').expect(403);
  assert.equal(response.body.error.code, 'FORBIDDEN');
  assert.equal(response.body.error.request_id, response.headers['x-request-id']);
  assert.equal(response.headers['access-control-allow-origin'], undefined);
});

test('malformed JSON, oversized bodies and unsupported media fail explicitly', async () => {
  const app = makeApp();
  const bad = await request(app).post('/api/v1/auth/login')
    .set('Content-Type', 'application/json').send('{bad').expect(400);
  assert.equal(bad.body.error.code, 'MALFORMED_REQUEST');
  const large = await request(app).post('/api/v1/auth/login')
    .send({ password: 'x'.repeat(110_000) }).expect(413);
  assert.equal(large.body.error.code, 'PAYLOAD_TOO_LARGE');
  const media = await request(app).post('/api/v1/auth/login')
    .set('Content-Type', 'text/plain').send('email=x').expect(415);
  assert.equal(media.body.error.code, 'UNSUPPORTED_MEDIA_TYPE');
});

test('all contract operations are implemented and fail closed without a database', async () => {
  const app = makeApp();
  const contract = loadContract();
  let checked = 0;
  for (const [path, methods] of Object.entries(contract.paths)) {
    for (const method of ['get', 'post', 'patch'] as const) {
      const operation = methods[method];
      if (!operation) continue;
      const url = '/api/v1'+path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000001');
      const { implemented } = await import('../src/modules/prototype.js');
      assert.ok(implemented.has(`${method} ${path}`), `Missing implementation: ${method} ${path}`);
      if (implemented.has(`${method} ${path}`)) {
        const unavailable = await request(app)[method](url).expect(503);
        assert.equal(unavailable.body.error.code, 'DATABASE_UNAVAILABLE');
        checked++;
        continue;
      }
      const response = await request(app)[method](url).expect(501);
      assert.equal(response.body.error.code, 'NOT_IMPLEMENTED');
      assert.match(response.body.error.message, new RegExp(operation.operationId));
      assert.deepEqual(response.body.error.fields, []);
      checked++;
    }
  }
  assert.equal(checked, 75);
});

test('unknown endpoints return JSON 404 and OpenAPI is development-only', async () => {
  const response = await request(makeApp()).get('/api/v1/unknown').expect(404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
  const contract = await request(makeApp()).get('/api/v1/openapi.json').expect(200);
  assert.equal(contract.body.openapi, '3.1.0');
  const production = createApp({ ...config, nodeEnv: 'production' }, {
    database: { probe: async () => 'not_configured', close: async () => undefined },
  });
  await request(production).get('/api/v1/openapi.json').expect(404);
});

test('unexpected exceptions are sanitized; expected field errors survive', async () => {
  const app = express();
  app.use(requestContext);
  app.get('/unexpected', async () => { throw new Error('postgresql://user:secret@example/database'); });
  app.get('/validation', () => {
    throw new HttpError(422, 'VALIDATION_ERROR', 'Correct the fields.', [{ path: 'quantity', code: 'MUST_BE_POSITIVE', message: 'Use a positive quantity.' }]);
  });
  app.use(errorHandler);
  const response = await request(app).get('/unexpected').expect(500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert(!JSON.stringify(response.body).includes('secret'));
  const validation = await request(app).get('/validation').expect(422);
  assert.equal(validation.body.error.fields[0].path, 'quantity');
});

test('request logging excludes query tokens and credentials', async () => {
  const logs: RequestLog[] = [];
  const app = createApp(config, {
    database: { probe: async () => 'not_configured', close: async () => undefined },
    logRequest: entry => logs.push(entry),
  });
  await request(app).post('/api/v1/auth/reset-password?token=do-not-log')
    .set('Cookie', 'brightloop_session=do-not-log')
    .send({ password: 'do-not-log' }).expect(503);
  assert.equal(logs.length, 1);
  assert.equal(logs[0]?.path, '/api/v1/auth/reset-password');
  assert(!JSON.stringify(logs).includes('do-not-log'));
});
