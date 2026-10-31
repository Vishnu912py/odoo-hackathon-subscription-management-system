import 'dotenv/config';
import { createDatabase } from '../src/db/client.js';
import { loadConfig } from '../src/config.js';
import { hashPassword } from '../src/modules/accounts/passwords.js';

// Explicit one-time operator command; never invoked by a build, migration or seed.
const config = loadConfig();
const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? '';
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
    !/^(?=.*[a-z])(?=.*[A-Z])(?=.*[^a-zA-Z0-9]).{9,128}$/.test(password)) {
  throw new Error('Set ADMIN_BOOTSTRAP_EMAIL and a valid ADMIN_BOOTSTRAP_PASSWORD in the operator environment.');
}
const database = createDatabase(config.databaseUrl);
try {
  if (!database.prisma) throw new Error('Configure DATABASE_URL.');
  await database.prisma.user.create({ data: { email, passwordHash: await hashPassword(password), displayName: 'Administrator', role: 'ADMIN' } });
  console.info('Administrator created. Remove bootstrap credentials from the operator environment.');
} catch {
  console.error('Administrator was not created. Check database access, migrations and whether the email already exists. Existing accounts are never overwritten.');
  process.exitCode = 1;
} finally { await database.close(); }
