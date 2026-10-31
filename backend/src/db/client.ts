import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { databaseConnectionUrl } from './connection.js';

export type DatabaseState = 'connected' | 'unavailable' | 'not_configured';
export interface Database {
  readonly prisma?: PrismaClient;
  probe(): Promise<DatabaseState>;
  close(): Promise<void>;
}

// One pool per server process, never one client per request.
export function createDatabase(connectionString?: string): Database {
  if (!connectionString) {
    return { probe: async () => 'not_configured', close: async () => undefined };
  }
  const schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
  const adapter = new PrismaPg({
    connectionString: databaseConnectionUrl(connectionString),
    max: 5,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 3000,
    query_timeout: 3000,
  }, { schema });
  const prisma = new PrismaClient({ adapter });
  return {
    prisma,
    async probe() {
      try {
        await prisma.$queryRaw`SELECT 1`;
        return 'connected';
      } catch {
        return 'unavailable';
      }
    },
    async close() { await prisma.$disconnect(); },
  };
}
