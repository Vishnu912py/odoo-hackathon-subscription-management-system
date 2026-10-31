import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { HttpError } from './errors.js';
import { uuidPattern } from './validation.js';
import { actor } from '../modules/accounts/routes.js';

export function invalid(message: string): never { throw new HttpError(422, 'VALIDATION_ERROR', message); }
export function conflict(code: string, message: string): never { throw new HttpError(409, code, message); }
export function requireVersion(req: Request, version: number) {
  if (req.get('If-Match') !== `"${version}"`) throw new HttpError(412, 'VERSION_CONFLICT', 'This record changed. Refresh before submitting a new action.');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function mutation(prisma: PrismaClient, req: Request, res: Response, status: number, versioned: boolean,
  work: (tx: Prisma.TransactionClient) => Promise<unknown>, authorize?: (tx: Prisma.TransactionClient) => Promise<void>, afterCommit?: () => Promise<void>) {
  if (Object.keys(req.query).length) throw new HttpError(400, 'INVALID_QUERY', 'Mutations do not accept query parameters.');
  const key = (req.get('Idempotency-Key') ?? '').toLowerCase();
  if (!key) throw new HttpError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Send a fresh UUID Idempotency-Key for this action.');
  if (!uuidPattern.test(key)) invalid('Idempotency-Key must be a UUID.');
  const version = req.get('If-Match');
  if (versioned && !version) throw new HttpError(428, 'PRECONDITION_REQUIRED', 'Send the quoted record version in If-Match.');
  if (version && !/^"[1-9][0-9]*"$/.test(version)) invalid('If-Match must be a quoted positive version.');
  const scope = `${actor(res).id}:${req.method}:${req.path.toLowerCase().replace(/\/$/, '')}`;
  const hash = createHash('sha256').update(canonical({ body: req.body, version: version ?? null })).digest('hex');
  try {
    const result = await prisma.$transaction(async tx => {
      if (authorize) await authorize(tx);
      const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtextextended(${scope + ':' + key}, 0)) AS acquired`;
      if (!lock?.acquired) { res.setHeader('Retry-After', '1'); conflict('REQUEST_IN_PROGRESS', 'Retry the same action with the same key.'); }
      const replay = await tx.idempotencyRecord.findUnique({ where: { scope_idempotencyKey: { scope, idempotencyKey: key } } });
      if (replay) {
        if (replay.requestHash !== hash) conflict('IDEMPOTENCY_CONFLICT', 'This key was used with different request contents.');
        return replay.responseBody;
      }
      const body = JSON.parse(JSON.stringify({ data: await work(tx) })) as Prisma.InputJsonObject;
      await tx.idempotencyRecord.create({ data: { scope, idempotencyKey: key, requestHash: hash, statusCode: status, responseBody: body } });
      return body;
    }, { timeout: 15_000 });
    if (afterCommit) await afterCommit();
    res.status(status).json(result);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') conflict('INVALID_TRANSITION', 'A record with these unique values already exists.');
      if (['P2003', 'P2025'].includes(error.code)) invalid('A referenced record no longer exists or is in use.');
      if (['P2000', 'P2020', 'P2004'].includes(error.code)) invalid('Values exceed the supported bounds or violate a data constraint.');
    }
    throw error;
  }
}

export function pagination(q: Record<string, unknown>) {
  const page = Number(q.page ?? 1), size = Number(q.page_size ?? 20), skip = (page - 1) * size;
  if (!Number.isSafeInteger(skip)) throw new HttpError(400, 'INVALID_QUERY', 'Page is too large.');
  return { page, size, skip, take: size };
}
export const pageMeta = (page: number, size: number, total: number) => ({ page, page_size: size, total, total_pages: Math.ceil(total / size) });
