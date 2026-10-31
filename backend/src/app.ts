import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Config } from './config.js';
import { loadContract } from './contracts.js';
import type { Database } from './db/client.js';
import { errorHandler, HttpError, notFound } from './http/errors.js';
import { requestContext, requestLogger, type RequestLog } from './http/request-context.js';
import { createApiRouter } from './modules/index.js';
import { prototypeRouter } from './modules/prototype.js';
import { timingSafeEqual } from 'node:crypto';
import { deliverMail, type MailTransport } from './modules/accounts/mail.js';

export interface AppDependencies {
  database: Database;
  logRequest?: (entry: RequestLog) => void;
  now?: () => Date;
  mailTransport?: MailTransport;
}

export function createApp(config: Config, dependencies: AppDependencies) {
  const app = express();
  const contract = loadContract();
  app.disable('x-powered-by');
  // Do not trust proxy headers until the deployment proxy topology is configured.
  app.set('trust proxy', false);
  app.use(requestContext);
  if (dependencies.logRequest) app.use(requestLogger(dependencies.logRequest));
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origin === config.frontendOrigin) callback(null, true);
      else callback(new HttpError(403, 'FORBIDDEN', 'This request origin is not allowed.'));
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key', 'If-Match'],
    exposedHeaders: ['X-Request-Id'],
  }));
  app.use(express.json({ limit: '100kb', strict: true }));
  app.get('/api/internal/auth-maintenance', async (req, res) => {
    const expected = `Bearer ${config.cronSecret ?? ''}`, supplied = req.get('authorization') ?? '';
    if (!config.cronSecret || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) || !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid maintenance credential.');
    const prisma = dependencies.database.prisma;
    if (!prisma) throw new HttpError(503, 'DATABASE_UNAVAILABLE', 'Database unavailable.');
    await deliverMail(prisma, config, dependencies.mailTransport);
    await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lte: new Date() } }, { createdAt: { lte: new Date(Date.now() - 7 * 86_400_000) } }] } });
    await prisma.authRateLimit.deleteMany({ where: { expiresAt: { lte: new Date() } } });
    await prisma.authEmailJob.deleteMany({ where: { expiresAt: { lte: new Date(Date.now() - 86_400_000) } } });
    res.json({ data: { message: 'Authentication maintenance completed.' } });
  });

  app.get('/health/live', (_req, res) => {
    res.json({ data: { status: 'ok', service: 'brightloop-backend' } });
  });
  app.get('/health/ready', async (_req, res) => {
    const database = await dependencies.database.probe();
    res.status(database === 'connected' ? 200 : 503).json({
      data: { status: database === 'connected' ? 'ready' : 'not_ready', database },
    });
  });
  if (config.nodeEnv !== 'production') {
    app.get('/api/v1/openapi.json', (_req, res) => { res.json(contract); });
  }
  app.use('/api/v1', (req, _res, next) => {
    const hasBody = Number(req.get('content-length') ?? 0) > 0 || Boolean(req.get('transfer-encoding'));
    if (hasBody && !req.is('application/json')) {
      next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Send request bodies as application/json.'));
      return;
    }
    next();
  }, prototypeRouter(dependencies.database.prisma, config, dependencies.now, dependencies.mailTransport), createApiRouter(contract));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
