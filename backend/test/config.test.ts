import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('safe development defaults work without database credentials', () => {
  const config = loadConfig({});
  assert.equal(config.port, 3000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.databaseUrl, undefined);
  assert.equal(config.frontendOrigin, 'http://localhost:5173');
});

test('production requires HTTPS and mail configuration is all-or-nothing', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /HTTPS/);
  assert.throws(() => loadConfig({ GMAIL_CLIENT_ID: 'partial' }), /all Gmail/);
  assert.equal(loadConfig({ NODE_ENV: 'production', FRONTEND_ORIGIN: 'https://brightloop.example' }).frontendOrigin, 'https://brightloop.example');
});

test('invalid ports are rejected rather than silently truncated', () => {
  for (const port of ['0', '65536', '3000.5', '3000junk', '']) {
    assert.throws(() => loadConfig({ PORT: port }), /PORT/);
  }
});

test('CORS requires an exact HTTP origin, not wildcard or URL paths', () => {
  for (const origin of ['*', 'javascript:alert(1)', 'https://example.com/app', 'https://x:secret@example.com', 'https://example.com?token=secret']) {
    assert.throws(() => loadConfig({ FRONTEND_ORIGIN: origin }), /FRONTEND_ORIGIN/);
  }
  assert.equal(loadConfig({ FRONTEND_ORIGIN: 'https://example.com/' }).frontendOrigin, 'https://example.com');
});

test('invalid database URLs do not expose supplied credentials in errors', () => {
  assert.throws(() => loadConfig({ DATABASE_URL: 'mysql://user:secret@localhost/db' }), error => {
    assert(error instanceof Error);
    assert(!error.message.includes('secret'));
    return true;
  });
  const url = 'postgresql://local:example@localhost:5432/brightloop';
  assert.equal(loadConfig({ DATABASE_URL: url }).databaseUrl, url);
});
