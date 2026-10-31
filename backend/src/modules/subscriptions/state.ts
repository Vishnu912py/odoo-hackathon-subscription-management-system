import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { day } from '../projections.js';

// Materialize pending dates before authenticated reads/actions. Preserve an earlier
// billing cursor even on closure so the billing worker can recover historical debt.
export async function reconcileSubscriptions(prisma: PrismaClient, today: string, scope: Prisma.SubscriptionWhereInput = {}) {
  const date = new Date(today);
  const candidates = await prisma.subscription.findMany({ where: { ...scope, status: 'ACTIVE', OR: [
    { pauseEffectiveDate: { lte: date }, isPaused: false }, { resumeEffectiveDate: { lte: date } },
    { closeEffectiveDate: { lte: date } }, { expiryDate: { lte: date } },
  ] }, select: { id: true } });
  for (const { id } of candidates) await prisma.$transaction(async tx => {
    await tx.subscription.updateMany({ where: { id }, data: { version: { increment: 0 } } });
    const r = await tx.subscription.findUniqueOrThrow({ where: { id } });
    if (r.status !== 'ACTIVE') return;
    const close = r.closeEffectiveDate && day(r.closeEffectiveDate)! <= today ? r.closeEffectiveDate :
      r.expiryDate && day(r.expiryDate)! <= today && r.autoCloseSnapshot ? r.expiryDate : null;
    const ended = r.expiryDate && day(r.expiryDate)! <= today;
    const paused = !!r.pauseEffectiveDate && day(r.pauseEffectiveDate)! <= today && (!r.resumeEffectiveDate || day(r.resumeEffectiveDate)! > today);
    const resumed = !!r.resumeEffectiveDate && day(r.resumeEffectiveDate)! <= today;
    const stop = close ?? (ended ? r.expiryDate : null);
    const clearCursor = stop && r.nextBillingDate && r.nextBillingDate >= stop;
    if (!close && r.isPaused === paused && !resumed && !clearCursor) return;
    await tx.subscription.update({ where: { id }, data: { version: { increment: 1 }, isPaused: close ? false : paused,
      ...(close ? { status: 'CLOSED', closedAt: close, closeEffectiveDate: close } : {}),
      ...(paused && !r.isPaused ? { pausedAt: r.pauseEffectiveDate } : {}),
      ...(resumed ? { pauseEffectiveDate: null, resumeEffectiveDate: null, pausedAt: null } : {}),
      ...(clearCursor ? { nextBillingDate: null } : {}),
    } });
  });
}
