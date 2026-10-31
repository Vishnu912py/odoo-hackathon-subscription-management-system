import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import type { PrismaClient, Prisma } from '../../generated/prisma/client.js';
import type { Config } from '../../config.js';
import { HttpError } from '../../http/errors.js';
import { validateBody, validateQuery } from '../../http/validation.js';
import { hashPassword, verifyPassword } from './passwords.js';

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

export function authentication(prisma: PrismaClient, config: Config) {
  const cookieOptions = { httpOnly: true, sameSite: 'lax' as const, secure: config.nodeEnv === 'production', path: '/' };
  async function lookup(req: Request) {
    const token = tokenFrom(req);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const session = await prisma.session.findUnique({ where: { sessionTokenHash: digest(token) }, include: { user: { include: { customer: true } } } });
    return session && session.expiresAt > new Date() ? session : null;
  }
  async function issue(res: Response, userId: string | null) {
    const token = randomBytes(32).toString('hex');
    const session = await prisma.session.create({ data: { sessionTokenHash: digest(token), csrfToken: randomBytes(32).toString('hex'),
      userId, expiresAt: new Date(Date.now() + lifetime) }, include: { user: { include: { customer: true } } } });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: lifetime });
    return session;
  }
  const requireUser: RequestHandler = async (req, res, next) => {
    const session = await lookup(req);
    if (!session?.user) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    if (!session.user.isActive) throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account is disabled.');
    res.locals.session = session;
    res.locals.actor = session.user;
    session.expiresAt = new Date(Date.now() + lifetime);
    await prisma.session.updateMany({ where: { id: session.id }, data: { expiresAt: session.expiresAt } });
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
  // Bounded, process-local protection for prototype credential endpoints. Distributed limits are a deployment follow-up.
  const attempts = new Map<string, { count: number; until: number }>();
  const limit: RequestHandler = (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    const key = req.ip ?? 'unknown';
    const value = attempts.get(key) ?? { count: 0, until: now + 60_000 };
    if (++value.count > 20 || attempts.size >= 10_000) {
      res.setHeader('Retry-After', '60');
      throw new HttpError(429, 'RATE_LIMITED', 'Wait a minute before trying again.');
    }
    attempts.set(key, value); next();
  };
  const router = Router();
  router.use((req, _res, next) => {
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
    res.json({ data: sessionView(await issue(res, user.id)) });
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
  return { router, requireUser, csrf, staff };
}
