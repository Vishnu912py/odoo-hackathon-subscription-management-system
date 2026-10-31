import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { databaseConnectionUrl } from './src/db/connection.js';

const datasourceUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Validation/generation do not connect. Migration commands require a real URL.
  ...(datasourceUrl ? { datasource: { url: databaseConnectionUrl(datasourceUrl) } } : {}),
});
