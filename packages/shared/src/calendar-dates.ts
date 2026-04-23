/**
 * BUG-CAL-06 — month boundary fix.
 *
 * The old calendar used a `while (d <= endD) { d.setDate(d.getDate()+1) }`
 * loop with `toISOString().split('T')[0]` to stringify each day. That mixes
 * UTC (from toISOString) with local-month anchors from `new Date(yyyy-mm-dd)`,
 * so in a non-UTC timezone March 31 could shift to April 1 — the bug that
 * made the 31st wrap into column 1 of the same matrix row.
 *
 * This module owns the fix: generate the list of ISO `YYYY-MM-DD` strings
 * for each day in the anchor month purely from integer year/month/day math
 * with no UTC conversion, no date-fns dep, and no surprise rollover.
 *
 * Behaviour matches `date-fns eachDayOfInterval({start:startOfMonth(d), end:endOfMonth(d)})`
 * but without the library.
 */

function parseYMD(anchor: string | Date): { year: number; month: number } {
  if (anchor instanceof Date) {
    return { year: anchor.getFullYear(), month: anchor.getMonth() + 1 };
  }
  const [y, m] = anchor.split('-').map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`calendar-dates: invalid anchor "${anchor}"`);
  }
  return { year: y, month: m };
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Returns the number of days in the given month.
 * Uses `new Date(year, month, 0)` which rolls back to the last day of the
 * previous 0-indexed month — i.e. the last day of `month` in 1-indexed terms.
 */
export function daysInMonth(year: number, month1Indexed: number): number {
  return new Date(year, month1Indexed, 0).getDate();
}

/**
 * Returns `YYYY-MM-DD` strings for every day in the anchor month, in order.
 *
 * `anchor` may be an ISO date string (`2026-03-15`) or a `Date`. Only the
 * year+month are used; the day-of-month of the anchor is ignored.
 *
 * Guarantees:
 *   - exact length = days in month (28/29/30/31)
 *   - first entry is the 1st of the month
 *   - last entry is the last day of the month (never the 1st of the next)
 *   - zero-padded month and day components
 */
export function generateMonthDays(anchor: string | Date): string[] {
  const { year, month } = parseYMD(anchor);
  const total = daysInMonth(year, month);
  const out: string[] = [];
  for (let d = 1; d <= total; d++) {
    out.push(`${year}-${pad2(month)}-${pad2(d)}`);
  }
  return out;
}

/**
 * Extract the day-of-month number from a `YYYY-MM-DD` string.
 * Does NOT parse through `new Date` so it's immune to timezone drift.
 */
export function dayOfMonth(ymd: string): number {
  const [, , dStr] = ymd.split('-');
  const d = Number(dStr);
  if (!Number.isInteger(d) || d < 1 || d > 31) {
    throw new Error(`calendar-dates: invalid day in "${ymd}"`);
  }
  return d;
}

/**
 * Returns the first day (`YYYY-MM-01`) of the anchor month.
 */
export function startOfMonthYMD(anchor: string | Date): string {
  const { year, month } = parseYMD(anchor);
  return `${year}-${pad2(month)}-01`;
}

/**
 * Returns the last day (`YYYY-MM-<lastDay>`) of the anchor month.
 */
export function endOfMonthYMD(anchor: string | Date): string {
  const { year, month } = parseYMD(anchor);
  return `${year}-${pad2(month)}-${pad2(daysInMonth(year, month))}`;
}
