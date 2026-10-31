import { createHash, randomBytes } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { Config } from '../../config.js';
import { HttpError } from '../../http/errors.js';
import { validateBody, validateQuery, uuidPattern } from '../../http/validation.js';
import { actor } from './routes.js';
import { hashPassword } from './passwords.js';
import { queueMail, requireMail, deliverMail, type MailTransport } from './mail.js';

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = () => new HttpError(422, 'RESET_TOKEN_INVALID', 'This link is invalid or expired. Request a new email.');
const include = { staffInvitation: true } as const;
type StaffRow = Prisma.UserGetPayload<{ include: typeof include }>;
function view(user: StaffRow) {
  return { id: user.id, version: user.version, created_at: user.createdAt.toISOString(), updated_at: user.updatedAt.toISOString(),
    email: user.email, display_name: user.displayName ?? user.email, role: 'staff', is_active: user.isActive,
    invitation_status: user.staffInvitation && !user.staffInvitation.acceptedAt ? 'pending' : 'accepted' };
}
export function recoveryRouter(prisma: PrismaClient, config: Config, guards: { requireUser: RequestHandler; csrf: RequestHandler; limit: RequestHandler }, transport?: MailTransport) {
  const router = Router(), { requireUser, csrf, limit } = guards;
  const admin: RequestHandler = (_req, res, next) => {
    if (actor(res).role !== 'ADMIN') throw new HttpError(403, 'FORBIDDEN', 'Administrator access is required.');
    next();
  };
  router.post('/auth/forgot-password', limit, csrf, validateBody('ForgotPasswordInput'), async (req, res) => {
    requireMail(config);
    const email = req.body.email.trim().toLowerCase();
    await prisma.$transaction(async tx => {
      const user = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, include });
      if (!user) return;
      // Serialize issuance with redemption/disable so links cannot survive revocation races.
      await tx.user.update({ where: { id: user.id }, data: { version: { increment: 0 } } });
      const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include });
      const pending = current.staffInvitation && !current.staffInvitation.acceptedAt && !current.staffInvitation.tokenHash.startsWith('revoked:');
      if (!current.isActive && !pending) return;
      const token = randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + 30 * 60_000);
      if (pending) await tx.staffInvitation.update({ where: { userId: user.id }, data: { tokenHash: digest(token), expiresAt } });
      else {
        await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
        await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt } });
      }
      await queueMail(tx, config, user.email, token, expiresAt, Boolean(pending));
    });
    await deliverMail(prisma, config, transport, 1);
    res.status(202).json({ data: { message: 'If this account is eligible, a password setup email has been queued.' } });
  });
  router.post('/auth/reset-password', limit, csrf, validateBody('ResetPasswordInput'), async (req, res) => {
    const hash = digest(req.body.token), passwordHash = await hashPassword(req.body.password);
    await prisma.$transaction(async tx => {
      const reset = await tx.passwordResetToken.findUnique({ where: { tokenHash: hash } });
      const invite = reset ? null : await tx.staffInvitation.findUnique({ where: { tokenHash: hash } });
      const target = reset ?? invite;
      if (!target) throw invalid();
      await tx.user.update({ where: { id: target.userId }, data: { version: { increment: 0 } } });
      const user = await tx.user.findUniqueOrThrow({ where: { id: target.userId } });
      const now = new Date();
      if (reset) {
        if (!user.isActive) throw invalid();
        const used = await tx.passwordResetToken.updateMany({ where: { id: reset.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
        if (!used.count) throw invalid();
      } else {
        if (user.role !== 'STAFF') throw invalid();
        const used = await tx.staffInvitation.updateMany({ where: { id: invite!.id, tokenHash: hash, acceptedAt: null, expiresAt: { gt: now } }, data: { acceptedAt: now } });
        if (!used.count) throw invalid();
      }
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, ...(invite ? { isActive: true } : {}), version: { increment: 1 } } });
      await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
      await tx.session.deleteMany({ where: { userId: user.id } });
    });
    res.json({ data: { message: 'Password saved. Sign in with your new password.' } });
  });
  router.use('/staff', requireUser, admin, (req, _res, next) => {
    if (req.method !== 'GET' && Object.keys(req.query).length) throw new HttpError(400, 'MALFORMED_REQUEST', 'Unsupported query parameters.');
    next();
  });
  router.param('id', (_req, _res, next, id: string) => { next(uuidPattern.test(id) ? undefined : new HttpError(404, 'NOT_FOUND', 'Staff not found.')); });
  router.get('/staff', validateQuery('/staff'), async (_req, res) => {
    const q = res.locals.query, page = Number(q.page ?? 1), size = Number(q.page_size ?? 20);
    if (!Number.isSafeInteger((page - 1) * size)) throw new HttpError(400, 'MALFORMED_REQUEST', 'Page is too large.');
    const where: Prisma.UserWhereInput = { role: 'STAFF', ...(q.q ? { OR: [{ email: { contains: String(q.q), mode: 'insensitive' } }, { displayName: { contains: String(q.q), mode: 'insensitive' } }] } : {}) };
    const [rows, total] = await prisma.$transaction([prisma.user.findMany({ where, include, skip: (page - 1) * size, take: size, orderBy: [{ createdAt: q.sort_order === 'asc' ? 'asc' : 'desc' }, { id: 'asc' }] }), prisma.user.count({ where })], { isolationLevel: 'RepeatableRead' });
    res.json({ data: rows.map(view), meta: { page, page_size: size, total, total_pages: Math.ceil(total / size) } });
  });
  router.get('/staff/:id', validateQuery('/staff/{id}'), async (req, res) => {
    const user = await prisma.user.findFirst({ where: { id: String(req.params.id), role: 'STAFF' }, include });
    if (!user) throw new HttpError(404, 'NOT_FOUND', 'Staff not found.');
    res.json({ data: view(user) });
  });
  const write: RequestHandler = async (req, res) => {
    const key = (req.get('Idempotency-Key') ?? '').toLowerCase(), version = req.get('If-Match');
    if (!uuidPattern.test(key)) throw new HttpError(422, 'VALIDATION_ERROR', 'Idempotency-Key must be a UUID.');
    if (req.method === 'PATCH' && !version) throw new HttpError(428, 'PRECONDITION_REQUIRED', 'Send the quoted staff version.');
    if (version && !/^"[1-9][0-9]*"$/.test(version)) throw new HttpError(422, 'VALIDATION_ERROR', 'If-Match must be a quoted version.');
    const scope = `${actor(res).id}:${req.method}:${req.path.toLowerCase()}`;
    const hash = digest(JSON.stringify({ body: Object.fromEntries(Object.entries(req.body).sort()), version }));
    const status = req.method === 'POST' ? 201 : 200;
    try {
      const result = await prisma.$transaction(async tx => {
        const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${scope + ':' + key}, 0)) AS acquired`;
        if (!lock?.acquired) throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'Retry with the same key.');
        const replay = await tx.idempotencyRecord.findUnique({ where: { scope_idempotencyKey: { scope, idempotencyKey: key } } });
        if (replay) {
          if (replay.requestHash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Key already used for a different request.');
          return replay.responseBody;
        }
        let user: StaffRow;
        if (req.method === 'POST') {
          requireMail(config);
          const token = randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + 30 * 60_000);
          user = await tx.user.create({ data: { email: req.body.email.trim().toLowerCase(), displayName: req.body.display_name, role: 'STAFF', isActive: false,
            passwordHash: 'invitation-pending', staffInvitation: { create: { tokenHash: digest(token), expiresAt } } }, include });
          await queueMail(tx, config, user.email, token, expiresAt, true);
        } else {
          const id = String(req.params.id);
          const locked = await tx.user.updateMany({ where: { id, role: 'STAFF' }, data: { version: { increment: 0 } } });
          if (!locked.count) throw new HttpError(404, 'NOT_FOUND', 'Staff not found.');
          const existing = await tx.user.findUniqueOrThrow({ where: { id }, include });
          if (`"${existing.version}"` !== version) throw new HttpError(412, 'VERSION_CONFLICT', 'Refresh the staff record.');
          if (req.body.is_active === true && existing.staffInvitation && !existing.staffInvitation.acceptedAt) throw new HttpError(409, 'INVITATION_PENDING', 'Staff must complete password setup first.');
          user = await tx.user.update({ where: { id }, data: { ...(req.body.display_name !== undefined ? { displayName: req.body.display_name } : {}),
            ...(req.body.is_active !== undefined ? { isActive: req.body.is_active } : {}), version: { increment: 1 } }, include });
          if (req.body.is_active === false) {
            await tx.session.deleteMany({ where: { userId: id } });
            await tx.passwordResetToken.updateMany({ where: { userId: id, usedAt: null }, data: { usedAt: new Date() } });
            // Pending invitations are cancelled, so recovery cannot reactivate a disabled account.
            await tx.staffInvitation.updateMany({ where: { userId: id, acceptedAt: null }, data: { tokenHash: `revoked:${randomBytes(32).toString('hex')}`, expiresAt: new Date() } });
            user = await tx.user.findUniqueOrThrow({ where: { id }, include });
          }
        }
        const body = { data: view(user) };
        await tx.idempotencyRecord.create({ data: { scope, idempotencyKey: key, requestHash: hash, statusCode: status, responseBody: body } });
        return body;
      });
      if (req.method === 'POST') await deliverMail(prisma, config, transport, 1);
      res.status(status).json(result);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError(409, 'EMAIL_EXISTS', 'Email is already registered.');
      throw error;
    }
  };
  router.post('/staff', csrf, validateBody('StaffInput'), write);
  router.patch('/staff/:id', csrf, validateBody('StaffUpdate'), write);
  return router;
}
