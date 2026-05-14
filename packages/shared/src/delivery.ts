/**
 * Delivery configuration constants and utilities.
 *
 * Standard courier delivery takes 2-4 business days. When a customer selects
 * a rental start date within this window, we warn them that delivery may not
 * arrive in time.
 */

/** Maximum business days for standard delivery (upper bound of "2-4 business days"). */
export const MAX_STANDARD_DELIVERY_BUSINESS_DAYS = 4;

/**
 * Count business days between two dates (exclusive of start, inclusive of end).
 * Business days = weekdays (Mon-Fri). Does not account for public holidays.
 */
export function countBusinessDays(from: Date, to: Date): number {
  let count = 0;
  const current = new Date(from);
  current.setHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setHours(0, 0, 0, 0);

  while (current < end) {
    current.setDate(current.getDate() + 1);
    const day = current.getDay();
    if (day !== 0 && day !== 6) {
      count++;
    }
  }
  return count;
}

/**
 * Check whether a selected rental start date is at risk of late delivery
 * via standard courier (i.e. fewer than MAX_STANDARD_DELIVERY_BUSINESS_DAYS
 * business days between today and the start date).
 */
export function isDeliveryAtRisk(startDate: Date, today?: Date): boolean {
  const reference = today ?? new Date();
  const businessDays = countBusinessDays(reference, startDate);
  return businessDays < MAX_STANDARD_DELIVERY_BUSINESS_DAYS;
}
