import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import { HttpError } from '../../http/errors.js';
import { uuidPattern } from '../../http/validation.js';
import { actor } from '../accounts/routes.js';
import { Decimal, invoiceInclude, invoiceSummary, paymentInclude, paymentView } from '../projections.js';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function recordPayment(prisma: PrismaClient, req: Request, res: Response, today: string) {
  const user = actor(res);
  const invoiceId = String(req.params.id).toLowerCase();
  const key = (req.get('Idempotency-Key') ?? '').toLowerCase();
  if (!uuidPattern.test(key)) throw new HttpError(422, 'VALIDATION_ERROR', 'Idempotency-Key must be a UUID.');
  const version = req.get('If-Match');
  if (!version) throw new HttpError(428, 'PRECONDITION_REQUIRED', 'Send the quoted invoice version in If-Match.');
  if (!/^"[1-9][0-9]*"$/.test(version)) throw new HttpError(422, 'VALIDATION_ERROR', 'If-Match must be a quoted positive version.');
  const scope = `${user.id}:POST:/invoices/${invoiceId}/payments`;
  const hash = createHash('sha256').update(canonical({ body: req.body, version })).digest('hex');
  try {
    const response = await prisma.$transaction(async tx => {
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${scope + ':' + key}, 0)) AS acquired`;
      if (!lock?.acquired) { res.setHeader('Retry-After', '1'); throw new HttpError(409, 'REQUEST_IN_PROGRESS', 'This action is in progress; retry with the same key.'); }
      const replay = await tx.idempotencyRecord.findUnique({ where: { scope_idempotencyKey: { scope, idempotencyKey: key } } });
      if (replay) {
        if (replay.requestHash !== hash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'The key was already used with different request contents.');
        return replay.responseBody;
      }
      // UPDATE acquires the invoice row lock using Prisma's schema-qualified table.
      // Any rejected action rolls this back; the final update supplies the actual new version.
      const locked = await tx.invoice.updateMany({ where: { id: invoiceId }, data: { version: { increment: 0 } } });
      if (!locked.count) throw new HttpError(404, 'NOT_FOUND', 'Invoice not found.');
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: invoiceInclude });
      if (version !== `"${invoice.version}"`) throw new HttpError(412, 'VERSION_CONFLICT', 'The invoice changed. Refresh it before submitting a new action.');
      if (invoice.status !== 'CONFIRMED') throw new HttpError(409, 'INVALID_TRANSITION', 'Payments require a confirmed invoice.');
      const amount = new Decimal(req.body.amount);
      if (!amount.gt(0) || req.body.payment_date > today) throw new HttpError(422, 'VALIDATION_ERROR', 'Use a positive amount and a payment date no later than today.');
      const paid = invoice.amountPaid.plus(amount);
      if (paid.gt(invoice.total)) throw new HttpError(409, 'PAYMENT_EXCEEDS_BALANCE', 'The amount exceeds the unpaid balance.');
      const payment = await tx.payment.create({ data: { invoiceId, recordedById: user.id, idempotencyKey: key,
        method: req.body.method, amount, paymentDate: new Date(req.body.payment_date), note: req.body.note ?? null }, include: paymentInclude });
      const updated = await tx.invoice.update({ where: { id: invoiceId }, data: { amountPaid: paid,
        status: paid.eq(invoice.total) ? 'PAID' : 'CONFIRMED', version: { increment: 1 } }, include: invoiceInclude });
      const result = { data: { payment: paymentView(payment), invoice: invoiceSummary(updated, user.role, today) } };
      await tx.idempotencyRecord.create({ data: { scope, idempotencyKey: key, requestHash: hash, statusCode: 201,
        responseBody: result as Prisma.InputJsonObject } });
      return result;
    });
    res.status(201).json(response);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'The payment key has already been used.');
    throw error;
  }
}
