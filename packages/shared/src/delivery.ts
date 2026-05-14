/**
 * Delivery configuration constants and utilities.
 *
 * Standard courier delivery takes 2-4 days. When a customer selects
 * a rental start date within this window, we warn them that delivery may not
 * arrive in time.
 */

/** Maximum calendar days for standard delivery (upper bound of "2-4 days"). */
export const MAX_STANDARD_DELIVERY_DAYS = 4;

/**
 * Count calendar days between two dates (exclusive of start, inclusive of end).
 */
export function countCalendarDays(from: Date, to: Date): number {
  const f = new Date(from);
  f.setHours(0, 0, 0, 0);
  const t = new Date(to);
  t.setHours(0, 0, 0, 0);
  return Math.round((t.getTime() - f.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Check whether a selected rental start date is at risk of late delivery
 * via standard courier (i.e. fewer than MAX_STANDARD_DELIVERY_DAYS
 * calendar days between today and the start date).
 */
export function isDeliveryAtRisk(startDate: Date, today?: Date): boolean {
  const reference = today ?? new Date();
  const days = countCalendarDays(reference, startDate);
  return days < MAX_STANDARD_DELIVERY_DAYS;
}
