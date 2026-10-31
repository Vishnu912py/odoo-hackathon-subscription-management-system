import 'dotenv/config';
import { createDatabase } from '../src/db/client.js';
import { loadConfig } from '../src/config.js';
import { processBilling, deliverInvoices } from '../src/modules/billing/worker.js';
import { deliverMail } from '../src/modules/accounts/mail.js';

const config = loadConfig(), database = createDatabase(config.databaseUrl);
try {
  if (!database.prisma) throw new Error('Configure DATABASE_URL.');
  do {
    console.info(await processBilling(database.prisma, config));
    await deliverInvoices(database.prisma, config);
    await deliverMail(database.prisma, config);
    if (process.argv.includes('--watch')) await new Promise(resolve => setTimeout(resolve, 30_000));
  } while (process.argv.includes('--watch'));
} finally { await database.close(); }
