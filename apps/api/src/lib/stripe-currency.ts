/**
 * Stripe currency conversion helpers for THB (Thai Baht).
 *
 * Stripe represents THB amounts in the smallest currency unit: satang.
 * 1 THB = 100 satang. Our database stores amounts in whole THB (Int).
 *
 * These helpers ensure consistent conversion across:
 * - Checkout session creation (THB → satang)
 * - Webhook processing (satang → THB)
 * - Refund handling (satang → THB)
 */

/**
 * Convert THB (database unit) to Stripe satang (smallest currency unit).
 * @param thb Amount in Thai Baht (e.g. 1500 = ฿1,500)
 * @returns Amount in satang (e.g. 150000)
 */
export function thbToSatang(thb: number): number {
  return Math.round(thb * 100);
}

/**
 * Convert Stripe satang (smallest currency unit) to THB (database unit).
 * @param satang Amount in satang (e.g. 150000)
 * @returns Amount in Thai Baht (e.g. 1500)
 */
export function satangToThb(satang: number): number {
  return Math.round(satang / 100);
}

/** Stripe currency code for Thai Baht. */
export const STRIPE_CURRENCY = 'thb';
