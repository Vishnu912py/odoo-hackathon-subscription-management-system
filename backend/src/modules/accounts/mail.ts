import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { Config } from '../../config.js';
import { HttpError } from '../../http/errors.js';

export interface AuthMessage { to: string; subject: string; text: string }
export type MailTransport = (message: AuthMessage) => Promise<void>;
export function requireMail(config: Config) {
  if (!config.mail) throw new HttpError(503, 'MAIL_UNAVAILABLE', 'Email delivery is not configured. Contact the administrator.');
  return config.mail;
}
export function decryptMessage(value: string, key: string): AuthMessage {
  const [iv, tag, data] = value.split('.');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(key, 'hex'), Buffer.from(iv!, 'hex'));
  cipher.setAuthTag(Buffer.from(tag!, 'hex'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data!, 'hex')), cipher.final()]).toString());
}
export async function queueMail(tx: Prisma.TransactionClient, config: Config, to: string, token: string, expiresAt: Date, invitation = false) {
  const message: AuthMessage = { to, subject: invitation ? 'Set up your Brightloop staff account' : 'Reset your Brightloop password',
    text: `Use this single-use link within 30 minutes:\n${config.frontendOrigin}/#reset=${token}\nIf you did not request this, ignore this email.` };
  await queueMessage(tx, config, message, expiresAt);
}
export async function queueMessage(tx: Prisma.TransactionClient, config: Config, message: AuthMessage, expiresAt: Date) {
  const mail = requireMail(config);
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', Buffer.from(mail.encryptionKey, 'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(message)), cipher.final()]);
  await tx.authEmailJob.create({ data: { expiresAt, encryptedMessage: `${iv.toString('hex')}.${cipher.getAuthTag().toString('hex')}.${data.toString('hex')}` } });
}
export function gmailTransport(config: Config): MailTransport {
  return async message => {
    const mail = requireMail(config);
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(3000),
      body: new URLSearchParams({ client_id: mail.clientId, client_secret: mail.clientSecret, refresh_token: mail.refreshToken, grant_type: 'refresh_token' }) });
    const token = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !token.access_token) throw new Error('Gmail authorization failed.');
    if (/[\r\n<>]/.test(message.to)) throw new Error('Invalid recipient.');
    const mime = [`From: ${mail.sender}`, `To: ${message.to}`, `Subject: ${message.subject}`, 'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(message.text).toString('base64')].join('\r\n');
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', signal: AbortSignal.timeout(3000),
      headers: { Authorization: `Bearer ${token.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: Buffer.from(mime).toString('base64url') }) });
    if (!response.ok) throw new Error('Gmail delivery failed.');
  };
}
// Leases allow safe recovery after a function dies. Gmail can deliver twice after an
// ambiguous timeout; both messages contain the same single-use link.
export async function deliverMail(prisma: PrismaClient, config: Config, transport: MailTransport = gmailTransport(config), maximum = 5) {
  if (!config.mail) return;
  await prisma.authEmailJob.updateMany({ where: { expiresAt: { lte: new Date() }, encryptedMessage: { not: null } }, data: { encryptedMessage: null } });
  for (let i = 0; i < maximum; i++) {
    const now = new Date();
    const job = await prisma.authEmailJob.findFirst({ where: { encryptedMessage: { not: null }, sentAt: null, expiresAt: { gt: now }, availableAt: { lte: now } }, orderBy: { availableAt: 'asc' } });
    if (!job) break;
    const claim = await prisma.authEmailJob.updateMany({ where: { id: job.id, availableAt: job.availableAt, sentAt: null }, data: { availableAt: new Date(Date.now() + 60_000), attempts: { increment: 1 } } });
    if (!claim.count) continue;
    try {
      await transport(decryptMessage(job.encryptedMessage!, config.mail.encryptionKey));
      await prisma.authEmailJob.update({ where: { id: job.id }, data: { sentAt: new Date(), encryptedMessage: null } });
    } catch {
      // No recipients, credentials or reset links in logs/database errors.
      await prisma.authEmailJob.update({ where: { id: job.id }, data: { availableAt: new Date(Date.now() + Math.min(300_000, 30_000 * 2 ** Math.min(job.attempts, 4))) } });
    }
  }
}
