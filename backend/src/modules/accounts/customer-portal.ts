import { createHash, randomBytes } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { Config } from '../../config.js';
import { HttpError } from '../../http/errors.js';
import { mutation, requireVersion, conflict } from '../../http/mutations.js';
import { validateBody, uuidPattern } from '../../http/validation.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { queueMessage, requireMail, deliverMail, type MailTransport } from './mail.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const invalid = () => new HttpError(422, 'INVITATION_INVALID', 'The invitation or password is invalid, expired, or already used.');
export function customerPortalRouter(prisma: PrismaClient, config: Config, guards: { requireUser: RequestHandler; staff: RequestHandler; csrf: RequestHandler; limit: RequestHandler }, transport?: MailTransport) {
  const router = Router();
  router.post('/customers/:id/invite', guards.requireUser, guards.staff, guards.csrf, validateBody('EmptyInput'), async (req, res) => {
    const id = String(req.params.id);
    if (!uuidPattern.test(id)) throw new HttpError(404, 'NOT_FOUND', 'Customer not found.');
    await mutation(prisma, req, res, 202, true, async tx => {
      requireMail(config);
      await tx.customer.updateMany({ where: { id }, data: { version: { increment: 0 } } });
      const customer = await tx.customer.findUnique({ where: { id } });
      if (!customer) throw new HttpError(404, 'NOT_FOUND', 'Customer not found.');
      requireVersion(req, customer.version);
      if (customer.userId) conflict('CUSTOMER_ALREADY_LINKED', 'This customer already has portal access.');
      const email = customer.billingEmail.trim().toLowerCase();
      const existing = await tx.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, include: { customer: { include: { _count: { select: { subscriptions: true } } } } } });
      if (existing && (existing.role !== 'CUSTOMER' || !existing.isActive || (existing.customer?._count.subscriptions ?? 0) > 0)) conflict('ACCOUNT_LINK_CONFLICT', 'This email already belongs to an account with another billing profile or staff role.');
      const token = randomBytes(32).toString('hex'), expiresAt = new Date(Date.now() + 30 * 60_000);
      await tx.customerPortalInvitation.updateMany({ where: { customerId: id, acceptedAt: null }, data: { expiresAt: new Date() } });
      await tx.customerPortalInvitation.create({ data: { customerId: id, email, tokenHash: hash(token), expiresAt } });
      await queueMessage(tx, config, { to: email, subject: 'Your Brightloop customer portal invitation',
        text: `You have been invited to access the billing profile ${customer.name}.\nUse this single-use link within 30 minutes:\n${config.frontendOrigin}/#invite=${token}\nIf you already have a customer login, enter its current password. Otherwise choose a new password.\nIf you did not expect this invitation, ignore it.` }, expiresAt);
      return { message: 'Customer portal invitation queued to the billing email.' };
    }, undefined, () => deliverMail(prisma, config, transport, 1));
  });
  router.post('/auth/accept-customer-invitation', guards.limit, guards.csrf, validateBody('CustomerInvitationInput'), async (req, res) => {
    const tokenHash = hash(req.body.token);
    await prisma.$transaction(async tx => {
      const invite = await tx.customerPortalInvitation.findUnique({ where: { tokenHash } });
      if (!invite) throw invalid();
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-invite:${invite.email}`}, 0))::text`;
      await tx.customer.updateMany({ where: { id: invite.customerId }, data: { version: { increment: 0 } } });
      const customer = await tx.customer.findUniqueOrThrow({ where: { id: invite.customerId } });
      const consumed = await tx.customerPortalInvitation.updateMany({ where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } }, data: { acceptedAt: new Date() } });
      if (!consumed.count || customer.userId || customer.billingEmail.trim().toLowerCase() !== invite.email) throw invalid();
      let user = await tx.user.findFirst({ where: { email: { equals: invite.email, mode: 'insensitive' } } });
      if (user) {
        await tx.user.update({ where: { id: user.id }, data: { version: { increment: 0 } } });
        user = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
        if (user.role !== 'CUSTOMER' || !user.isActive || !await verifyPassword(req.body.password, user.passwordHash)) throw invalid();
        const prior = await tx.customer.findUnique({ where: { userId: user.id } });
        if (prior) {
          await tx.customer.update({ where: { id: prior.id }, data: { version: { increment: 0 } } });
          if (await tx.subscription.count({ where: { customerId: prior.id } })) conflict('ACCOUNT_LINK_CONFLICT', 'This account already has a different billing profile with subscriptions.');
          await tx.customer.delete({ where: { id: prior.id } });
        }
      } else {
        user = await tx.user.create({ data: { email: invite.email, displayName: customer.name, role: 'CUSTOMER', passwordHash: await hashPassword(req.body.password) } });
      }
      await tx.customer.update({ where: { id: customer.id }, data: { userId: user.id, version: { increment: 1 } } });
      await tx.customerPortalInvitation.updateMany({ where: { customerId: customer.id, acceptedAt: null }, data: { expiresAt: new Date() } });
      await tx.session.deleteMany({ where: { userId: user.id } });
    }, { timeout: 15_000 });
    res.json({ data: { message: 'Portal access activated. Sign in to view your subscriptions and invoices.' } });
  });
  return router;
}
