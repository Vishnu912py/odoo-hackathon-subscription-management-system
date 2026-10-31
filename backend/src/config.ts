export interface Config {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  frontendOrigin: string;
  databaseUrl?: string;
  mail?: { clientId: string; clientSecret: string; refreshToken: string; sender: string; encryptionKey: string };
  cronSecret?: string;
  vercel?: boolean;
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
  if (nodeEnv === 'production' && origin.protocol !== 'https:') throw new Error('Production FRONTEND_ORIGIN must use HTTPS.');

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
  const mailNames = ['GMAIL_CLIENT_ID', 'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_SENDER', 'AUTH_EMAIL_KEY'] as const;
  const configured = mailNames.filter(name => Boolean(env[name]));
  if (configured.length && configured.length !== mailNames.length) throw new Error('Configure all Gmail mail variables together.');
  if (configured.length && (!/^[a-f0-9]{64}$/i.test(env.AUTH_EMAIL_KEY!) || !/^[^\s<>\r\n]+@[^\s<>\r\n]+$/.test(env.GMAIL_SENDER!))) throw new Error('AUTH_EMAIL_KEY must be 32 bytes in hex and GMAIL_SENDER must be an email address.');
  return {
    nodeEnv: nodeEnv as Config['nodeEnv'], host, port, frontendOrigin: origin.origin,
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(configured.length ? { mail: { clientId: env.GMAIL_CLIENT_ID!, clientSecret: env.GMAIL_CLIENT_SECRET!, refreshToken: env.GMAIL_REFRESH_TOKEN!, sender: env.GMAIL_SENDER!, encryptionKey: env.AUTH_EMAIL_KEY! } } : {}),
    ...(env.CRON_SECRET ? { cronSecret: env.CRON_SECRET } : {}),
    vercel: env.VERCEL === '1',
  };
}
