import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import type { Config } from '../../config.js';
import { HttpError } from '../../http/errors.js';
import { validateBody, validateQuery } from '../../http/validation.js';
import { hashPassword, verifyPassword } from './passwords.js';
import type { MailTransport } from './mail.js';
import { recoveryRouter } from './recovery.js';

const cookieName = 'brightloop_session';
const lifetime = 24 * 60 * 60 * 1000;
export type SessionRecord = Prisma.SessionGetPayload<{ include: { user: { include: { customer: true } } } }>;
export type Actor = NonNullable<SessionRecord['user']>;
export function actor(res: Response): Actor { return res.locals.actor as Actor; }
function digest(token: string) { return createHash('sha256').update(token).digest('hex'); }
function tokenFrom(req: Request) {
  return (req.headers.cookie ?? '').split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}
export function userView(user: Actor) {
  return { id: user.id, email: user.email, display_name: user.displayName ?? user.email,
    role: user.role.toLowerCase(), customer_id: user.customer?.id ?? null, is_active: user.isActive };
}
function sessionView(session: SessionRecord) {
  return { user: userView(session.user!), csrf_token: session.csrfToken, expires_at: session.expiresAt.toISOString() };
}

export function authentication(prisma: PrismaClient, config: Config, transport?: MailTransport) {
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: config.nodeEnv === 'production', path: '/' };
  async function lookup(req: Request) {
    const token = tokenFrom(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await prisma.session.findUnique({ where: { sessionTokenHash: digest(token) }, include: { user: { include: { customer: true } } } });
    return session && session.expiresAt > new Date() && session.createdAt.getTime() + 7 * lifetime > Date.now() ? session : null;
  }
  async function issue(res: Response, userId: string | null, expectedPassword?: string) {
    const token = randomBytes(32).toString('hex');
    const session = await prisma.$transaction(async tx => {
      if (userId) {
        await tx.user.update({ where: { id: userId }, data: { version: { increment: 0 } } });
        const current = await tx.user.findUniqueOrThrow({ where: { id: userId } });
        if (!current.isActive || current.passwordHash !== expectedPassword) throw new HttpError(401, 'UNAUTHENTICATED', 'Account changed. Sign in again.');
      }
      return tx.session.create({ data: { sessionTokenHash: digest(token), csrfToken: randomBytes(32).toString('hex'),
      userId, expiresAt: new Date(Date.now() + lifetime) }, include: { user: { include: { customer: true } } } });
    });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetime });
    return session;
  }
  const requireUser: RequestHandler = async (req, res, next) => {
    const session = await lookup(req);
    if (!session?.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    if (!session.user.isActive) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account is disabled.');
    res.locals.session = session;
    res.locals.actor = session.user;
    session.expiresAt = new Date(Math.min(Date.now() + lifetime, session.createdAt.getTime() + 7 * lifetime));
    const refreshed = await prisma.session.updateMany({ where: { id: session.id }, data: { expiresAt: session.expiresAt } });
    if (!refreshed.count) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in again.');
    // Refresh the cookie's idle lifetime without revealing its opaque value in JSON.
    res.cookie(cookieName, tokenFrom(req)!, { ...cookieOptions, maxAge: lifetime });
    next();
  };
  const csrf: RequestHandler = async (req, res, next) => {
    if (req.get('origin') !== config.frontendOrigin) throw new HttpError(403, 'CSRF_INVALID', 'A trusted Origin is required.');
    const session = (res.locals.session as SessionRecord | undefined) ?? await lookup(req);
    const supplied = req.get('X-CSRF-Token') ?? '';
    if (!session || Buffer.byteLength(supplied) !== Buffer.byteLength(session.csrfToken) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(session.csrfToken))) {
      throw new HttpError(403, 'CSRF_INVALID', 'Refresh the session and try again.');
    }
    res.locals.session = session;
    next();
  };
  const staff: RequestHandler = (_req, res, next) => {
    if (actor(res).role === 'CUSTOMER') throw new HttpError(403, 'FORBIDDEN', 'Staff access is required.');
    next();
  };
  // Fixed-window counters are shared by all Vercel instances; hashes avoid storing IP/email.
  const limit: RequestHandler = async (req, res, next) => {
    const window = Math.floor(Date.now() / 60_000);
    const ip = config.vercel ? (req.get('x-vercel-forwarded-for') ?? req.ip ?? 'unknown') : (req.ip ?? 'unknown');
    const identities = [`ip:${ip}:${req.path}`];
    if (typeof req.body?.email === 'string') identities.push(`email:${req.body.email.trim().toLowerCase()}:${req.path}`);
    for (const identity of identities) {
      const row = await prisma.authRateLimit.upsert({ where: { key: digest(`${window}:${identity}`) },
        create: { key: digest(`${window}:${identity}`), expiresAt: new Date((window + 1) * 60_000) }, update: { count: { increment: 1 } } });
      if (row.count > (req.path === '/auth/forgot-password' ? 5 : 20)) {
        res.setHeader('Retry-After', String(60 - Math.floor(Date.now() / 1000) % 60));
        throw new HttpError(429, 'RATE_LIMITED', 'Wait a minute before trying again.');
      }
    }
    next();
  };
  const router = Router();
  router.use((req, res, next) => {
    if (req.path.startsWith('/auth/') && req.method === 'POST' && Object.keys(req.query).length) throw new HttpError(400, 'MALFORMED_REQUEST', 'Authentication mutations do not accept query parameters.');
    next();
  });
  router.get('/auth/csrf', validateQuery('/auth/csrf'), limit, async (req, res) => {
    const session = await lookup(req) ?? await issue(res, null);
    res.json({ data: { csrf_token: session.csrfToken } });
  });
  router.get('/auth/me', requireUser, validateQuery('/auth/me'), (_req, res) => { res.json({ data: sessionView(res.locals.session as SessionRecord) }); });
  router.post('/auth/login', limit, csrf, validateBody('LoginInput'), async (req, res) => {
    const user = await prisma.user.findFirst({ where: { email: { equals: req.body.email.trim().toLowerCase(), mode: 'insensitive' } }, include: { customer: true } });
    // Do equivalent scrypt work for unknown accounts.
    const fallback = `scrypt:${'0'.repeat(32)}:${'0'.repeat(128)}`;
    if (!await verifyPassword(req.body.password, user?.passwordHash ?? fallback) || !user) throw new HttpError(401, 'UNAUTHENTICATED', 'Email or password is incorrect.');
    if (!user.isActive) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account is disabled.');
    await prisma.session.deleteMany({ where: { id: (res.locals.session as SessionRecord).id } });
    res.json({ data: sessionView(await issue(res, user.id, user.passwordHash)) });
  });
  router.post('/auth/register', limit, csrf, validateBody('RegisterInput'), async (req, res) => {
    const passwordHash = await hashPassword(req.body.password);
    try {
      const user = await prisma.user.create({ data: { email: req.body.email.trim().toLowerCase(), passwordHash,
        displayName: req.body.display_name, role: 'CUSTOMER', customer: { create: { name: req.body.display_name,
          companyName: req.body.company_name ?? null, billingEmail: req.body.email.trim().toLowerCase() } } }, include: { customer: true } });
      res.status(201).json({ data: userView(user) });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new HttpError(409, 'EMAIL_EXISTS', 'This email is already registered.');
      throw error;
    }
  });
  router.post('/auth/logout', requireUser, csrf, validateBody('EmptyInput'), async (_req, res) => {
    await prisma.session.deleteMany({ where: { id: (res.locals.session as SessionRecord).id } });
    res.clearCookie(cookieName, cookieOptions).status(204).end();
  });
  router.use(recoveryRouter(prisma, config, { requireUser, csrf, limit }, transport));
  return { router, requireUser, csrf, staff };
}
