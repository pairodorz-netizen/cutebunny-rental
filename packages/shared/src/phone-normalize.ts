/**
 * BUG-234: Phone number normalization for consistent search/storage.
 *
 * Thai phone numbers come in many formats:
 *   - 0891680668
 *   - 089 168 0668
 *   - 089-168-0668
 *   - (089) 168-0668
 *   - +66891680668
 *   - +66 89 168 0668
 *   - 66891680668
 *
 * This module normalizes all variations to a canonical digits-only form:
 *   → 0891680668 (local format, always starts with 0)
 */

/**
 * Strip all non-digit characters from a phone string.
 */
function stripNonDigits(phone: string): string {
  return phone.replace(/[^0-9]/g, '');
}

/**
 * Normalize a phone number for storage and search.
 *
 * Rules:
 * 1. Strip spaces, dashes, parens, dots
 * 2. If starts with +66 or 66 (Thai country code), replace with leading 0
 * 3. Result is digits-only, local format (e.g., "0891680668")
 *
 * Returns empty string if input is empty/null/undefined.
 */
export function normalizePhone(phone: string | null | undefined): string {
  if (!phone) return '';

  let digits = stripNonDigits(phone);

  // Handle +66 prefix (country code) — after stripping, starts with "66"
  // Thai mobile numbers are 10 digits (0 + 9 digits)
  // If we have 66 prefix + 9 digits = 11 chars starting with 66
  if (digits.startsWith('66') && digits.length >= 11) {
    digits = '0' + digits.slice(2);
  }

  return digits;
}

/**
 * Normalize a phone search query for comparison.
 * Same as normalizePhone but doesn't require the result to be a valid phone.
 * Useful for partial searches (e.g., "089 168" → "089168").
 */
export function normalizePhoneSearch(query: string | null | undefined): string {
  if (!query) return '';
  let digits = stripNonDigits(query);

  // If starts with country code prefix, normalize
  if (digits.startsWith('66') && digits.length >= 11) {
    digits = '0' + digits.slice(2);
  }

  return digits;
}
