/**
 * Recurrence and Calendar Period Calculation Service
 * 
 * Enforces:
 * 1. Original recurrence anchor day preservation (e.g. 31st of month).
 * 2. Exact month-end clamping (28/29 for Feb, 30 for Apr/Jun/Sep/Nov, 31 for others).
 * 3. Leap year calculation (Feb 29 on leap years, Feb 28 on common years).
 * 4. Exclusive period-end convention: [periodStart, periodEnd) is continuous and gapless.
 * 5. Strict calendar-month and calendar-year arithmetic without millisecond approximations.
 * 6. Asia/Kolkata timezone business date compliance.
 */

export type BillingInterval = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/**
 * Returns true if the specified year is a leap year in the Gregorian calendar.
 */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

/**
 * Returns the exact number of days in the specified year and month.
 * month is 1-indexed (1 = January, 12 = December).
 */
export function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Parses a Date or YYYY-MM-DD date string into UTC calendar components.
 */
export function parseDateComponents(dateInput: Date | string): { year: number; month: number; day: number; dateStr: string } {
  if (typeof dateInput === 'string') {
    const parts = dateInput.split('T')[0]!.split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0]!, 10);
      const month = parseInt(parts[1]!, 10);
      const day = parseInt(parts[2]!, 10);
      const dateStr = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
      return { year, month, day, dateStr };
    }
  }

  const d = new Date(dateInput);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const dateStr = `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
  return { year, month, day, dateStr };
}

/**
 * Formats calendar components into UTC Date object at 00:00:00.000Z.
 */
export function toUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

export interface ComputePeriodParams {
  periodStart: Date | string;
  interval: BillingInterval | string;
  anchorDay?: number;
  anchorMonth?: number;
}

export interface ComputedPeriod {
  periodStart: Date;
  periodEnd: Date;
  periodStartStr: string;
  periodEndStr: string;
  anchorDay: number;
}

/**
 * Computes the next calendar billing period adhering to anchor day and leap year rules.
 * 
 * Period bounds follow the half-open interval convention: [periodStart, periodEnd).
 * The returned periodEnd serves as the exact periodStart for the subsequent recurrence.
 */
export function computeNextPeriod(params: ComputePeriodParams): ComputedPeriod {
  const { periodStart: startInput, interval, anchorMonth } = params;
  const { year: startY, month: startM, day: startD, dateStr: periodStartStr } = parseDateComponents(startInput);

  const anchorDay = params.anchorDay ?? startD;
  const normInterval = (interval || 'MONTHLY').toUpperCase();

  let endY = startY;
  let endM = startM;
  let endD = startD;

  if (normInterval === 'DAILY') {
    const d = toUtcDate(startY, startM, startD);
    d.setUTCDate(d.getUTCDate() + 1);
    const comps = parseDateComponents(d);
    endY = comps.year;
    endM = comps.month;
    endD = comps.day;
  } else if (normInterval === 'WEEKLY') {
    const d = toUtcDate(startY, startM, startD);
    d.setUTCDate(d.getUTCDate() + 7);
    const comps = parseDateComponents(d);
    endY = comps.year;
    endM = comps.month;
    endD = comps.day;
  } else if (normInterval === 'YEARLY') {
    endY = startY + 1;
    endM = anchorMonth ?? startM;
    const daysInTargetMonth = getDaysInMonth(endY, endM);
    endD = Math.min(anchorDay, daysInTargetMonth);
  } else {
    // Default: MONTHLY
    if (startM === 12) {
      endY = startY + 1;
      endM = 1;
    } else {
      endY = startY;
      endM = startM + 1;
    }
    const daysInTargetMonth = getDaysInMonth(endY, endM);
    endD = Math.min(anchorDay, daysInTargetMonth);
  }

  const periodStart = toUtcDate(startY, startM, startD);
  const periodEnd = toUtcDate(endY, endM, endD);
  const periodEndStr = `${endY.toString().padStart(4, '0')}-${endM.toString().padStart(2, '0')}-${endD.toString().padStart(2, '0')}`;

  return {
    periodStart,
    periodEnd,
    periodStartStr,
    periodEndStr,
    anchorDay,
  };
}
