import { computeNextPeriod, getDaysInMonth } from '../billing/recurrence.js';
import { invalid } from '../../http/mutations.js';

// Jump directly to the original calendar anchor; never iterate over historical periods.
export function boundary(start: string, interval: string, target: string): string {
  if (target <= start) return start;
  const a = new Date(start), b = new Date(target);
  if (interval === 'DAILY' || interval === 'WEEKLY') {
    const step = interval === 'DAILY' ? 1 : 7;
    return new Date(a.getTime() + Math.ceil((b.getTime() - a.getTime()) / 86400000 / step) * step * 86400000).toISOString().slice(0, 10);
  }
  const y = b.getUTCFullYear(), m = interval === 'YEARLY' ? a.getUTCMonth() + 1 : b.getUTCMonth() + 1;
  const candidate = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(a.getUTCDate(), getDaysInMonth(y, m))).padStart(2, '0')}`;
  return candidate >= target ? candidate : computeNextPeriod({ periodStart: candidate, interval, anchorDay: a.getUTCDate(), anchorMonth: a.getUTCMonth() + 1 }).periodEndStr;
}
export function validateExpiry(start: string, expiry: string | null, interval: string, autoClose: boolean) {
  if (start < '0100-01-01' || start > '9998-12-31') invalid('Start date must be between years 0100 and 9998.');
  if (!expiry) { if (autoClose) invalid('Auto-close requires a finite expiry.'); return; }
  if (expiry <= start || expiry > '9999-12-31' || boundary(start, interval, expiry) !== expiry) invalid('Expiry must be a later original recurrence boundary.');
}
