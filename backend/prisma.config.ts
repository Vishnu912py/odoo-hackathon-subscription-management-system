import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const datasourceUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // Validation/generation do not connect. Migration commands require a real URL.
  ...(datasourceUrl ? { datasource: { url: datasourceUrl } } : {}),
});
