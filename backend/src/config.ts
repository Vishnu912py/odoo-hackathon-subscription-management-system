export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  frontendOrigin: string;
  databaseUrl?: string;
}

// Accept an explicit environment so configuration tests do not mutate process.env.
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, test, or production.');
  }
  const portText = env.PORT ?? '3000';
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer from 1 through 65535.');
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!host || /[\s/]/.test(host)) throw new Error('HOST must be a hostname or IP address.');

  let origin: URL;
  try {
    origin = new URL(env.FRONTEND_ORIGIN ?? 'http://localhost:5173');
  } catch {
    throw new Error('FRONTEND_ORIGIN must be an absolute HTTP(S) origin.');
  }
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password ||
      origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('FRONTEND_ORIGIN must contain only scheme, hostname, and optional port.');
  }

  const databaseUrl = env.DATABASE_URL?.trim() || undefined;
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || url.pathname.length < 2) {
        throw new Error('invalid');
      }
    } catch {
      // Do not include the connection string or credentials in configuration errors.
      throw new Error('DATABASE_URL must be a PostgreSQL connection URL with a database name.');
    }
  }
  return {
    nodeEnv: nodeEnv as Config['nodeEnv'], host, port, frontendOrigin: origin.origin,
    ...(databaseUrl ? { databaseUrl } : {}),
  };
}
