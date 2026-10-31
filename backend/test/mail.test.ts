import test from 'node:test';
import assert from 'node:assert/strict';
import { gmailTransport } from '../src/modules/accounts/mail.js';
import type { Config } from '../src/config.js';

test('Gmail uses OAuth refresh and MIME base64url; provider failures do not leak secrets', async () => {
  const config: Config = { nodeEnv: 'test', host: 'localhost', port: 3000, frontendOrigin: 'http://localhost:5173',
    mail: { clientId: 'client', clientSecret: 'private-client-secret', refreshToken: 'private-refresh-token', sender: 'sender@example.test', encryptionKey: 'ab'.repeat(32) } };
  const calls: Array<{ url: string; options?: RequestInit }> = [];
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), ...(options ? { options } : {}) });
      return new Response(JSON.stringify(String(url).includes('oauth2') ? { access_token: 'access-token' } : { id: 'message' }), { status: 200 });
    };
    await gmailTransport(config)({ to: 'staff@example.test', subject: 'Staff setup', text: 'Use https://app.example/#reset=single-use-token' });
    assert.equal(calls[0]!.url, 'https://oauth2.googleapis.com/token');
    assert.equal((calls[0]!.options!.body as URLSearchParams).get('grant_type'), 'refresh_token');
    assert.equal(calls[1]!.url, 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    const raw = Buffer.from(JSON.parse(String(calls[1]!.options!.body)).raw, 'base64url').toString();
    assert.match(raw, /To: staff@example.test\r\n/);
    assert.equal(Buffer.from(raw.split('\r\n\r\n')[1]!, 'base64').toString(), 'Use https://app.example/#reset=single-use-token');
    globalThis.fetch = async () => new Response('{"error":"private-refresh-token"}', { status: 401 });
    await assert.rejects(gmailTransport(config)({ to: 'staff@example.test', subject: 'Staff setup', text: 'secret' }), error => {
      assert.ok(error instanceof Error); assert.equal(error.message, 'Gmail authorization failed.'); return true;
    });
  } finally { globalThis.fetch = original; }
});
