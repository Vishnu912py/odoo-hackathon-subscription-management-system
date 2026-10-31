import 'dotenv/config';
import { createDatabase } from '../src/db/client.js';
import { loadConfig } from '../src/config.js';
import { deliverMail, requireMail } from '../src/modules/accounts/mail.js';

const config = loadConfig();
requireMail(config);
const database = createDatabase(config.databaseUrl);
try {
  if (!database.prisma) throw new Error('Configure DATABASE_URL.');
  await deliverMail(database.prisma, config);
  console.info('Email delivery pass completed. Check pending jobs for retries; this does not guarantee delivery.');
} finally { await database.close(); }
