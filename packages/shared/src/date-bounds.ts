/**
 * BUG-229 — Maximum booking date validation.
 *
 * Rental bookings cannot be made more than MAX_BOOKING_YEARS (2) years
 * into the future. This module provides helpers for both frontend (HTML max
 * attribute) and backend (Zod/API validation).
 */

/** Maximum number of years ahead a booking date is allowed. */
export const MAX_BOOKING_YEARS = 2;

/**
 * Returns the maximum allowed booking date as `YYYY-MM-DD`.
 * Defaults to today + MAX_BOOKING_YEARS.
 *
 * @param referenceDate - Optional reference date (defaults to now).
 */
export function getMaxBookingDate(referenceDate?: Date): string {
  const ref = referenceDate ?? new Date();
  const maxDate = new Date(ref.getFullYear() + MAX_BOOKING_YEARS, ref.getMonth(), ref.getDate());
  const y = maxDate.getFullYear();
  const m = String(maxDate.getMonth() + 1).padStart(2, '0');
  const d = String(maxDate.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns today's date as `YYYY-MM-DD`.
 */
export function getTodayDate(referenceDate?: Date): string {
  const ref = referenceDate ?? new Date();
  const y = ref.getFullYear();
  const m = String(ref.getMonth() + 1).padStart(2, '0');
  const d = String(ref.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Checks whether a date string (YYYY-MM-DD) is within the allowed booking window.
 * Returns true if the date is valid (today or within MAX_BOOKING_YEARS).
 *
 * @param dateStr - The date to validate in YYYY-MM-DD format.
 * @param referenceDate - Optional reference date (defaults to now).
 */
export function isDateWithinBookingWindow(dateStr: string, referenceDate?: Date): boolean {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const maxDate = getMaxBookingDate(referenceDate);
  return dateStr <= maxDate;
}

/**
 * Returns the maximum allowed year+month for calendar navigation.
 * { year, month } where month is 1-indexed.
 */
export function getMaxBookingMonth(referenceDate?: Date): { year: number; month: number } {
  const ref = referenceDate ?? new Date();
  return {
    year: ref.getFullYear() + MAX_BOOKING_YEARS,
    month: ref.getMonth() + 1,
  };
}

/**
 * Checks whether navigating to a given year+month would exceed the booking window.
 * Returns true if the month is still navigable (within bounds).
 */
export function isMonthNavigable(year: number, month: number, referenceDate?: Date): boolean {
  const max = getMaxBookingMonth(referenceDate);
  if (year < max.year) return true;
  if (year === max.year && month <= max.month) return true;
  return false;
}
