import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase } from '../src/db/client.js';

test('unconfigured database does not allocate a client or report ready', async () => {
  const db = createDatabase();
  assert.equal(db.prisma, undefined);
  assert.equal(await db.probe(), 'not_configured');
  await db.close();
});

test('Prisma adapter reports an unavailable local database without leaking credentials', { timeout: 10_000 }, async () => {
  // Port 1 is deliberately not a PostgreSQL service. No application database is modified.
  const db = createDatabase('postgresql://test:example-only@127.0.0.1:1/brightloop?schema=public');
  try {
    assert(db.prisma);
    assert.equal(await db.probe(), 'unavailable');
  } finally {
    await db.close();
  }
});
