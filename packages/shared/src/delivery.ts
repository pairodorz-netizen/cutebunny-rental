/**
 * Delivery configuration constants and utilities.
 *
 * Standard courier delivery takes 2-4 days. When a customer selects
 * a rental start date within this window, we warn them that delivery may not
 * arrive in time.
 */

/** Maximum calendar days for standard delivery (upper bound of "2-4 days"). */
export const MAX_STANDARD_DELIVERY_DAYS = 4;

/** Buffer days for queue collision: Bangkok (return shipping is fast). */
export const QUEUE_BUFFER_DAYS_BKK = 2;

/** Buffer days for queue collision: provinces (return shipping slower). */
export const QUEUE_BUFFER_DAYS_PROVINCE = 5;

/** Buffer days for previous return: receive + QC before next dispatch. */
export const PREVIOUS_RETURN_BUFFER_DAYS = 4;

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

/**
 * Check whether a rental end date is too close to the next booking,
 * leaving insufficient buffer for return delivery to the next customer.
 *
 * Returns true when the gap (end_date → next_booking_start) is ≤ bufferDays.
 * If nextBookingStart is null (no upcoming booking), returns false.
 */
export function isQueueCollisionRisk(
  endDate: Date,
  nextBookingStart: Date | null,
  bufferDays: number = QUEUE_BUFFER_DAYS_PROVINCE,
): boolean {
  if (!nextBookingStart) return false;
  const gap = countCalendarDays(endDate, nextBookingStart);
  return gap <= bufferDays;
}

/**
 * Check whether a rental start date is too close to the previous booking's
 * end date, leaving insufficient time for return shipping + QC.
 *
 * Returns true when the gap (previous_end → new_start) is < bufferDays.
 * If previousBookingEnd is null (no prior booking), returns false.
 */
export function isPreviousReturnRisk(
  startDate: Date,
  previousBookingEnd: Date | null,
  bufferDays: number = PREVIOUS_RETURN_BUFFER_DAYS,
): boolean {
  if (!previousBookingEnd) return false;
  const gap = countCalendarDays(previousBookingEnd, startDate);
  return gap < bufferDays;
}
