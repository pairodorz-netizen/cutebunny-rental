/**
 * Pure helpers for the admin Shipping settings inline-edit forms.
 *
 * Used to decide whether a "Save" button should be enabled: if the user
 * hasn't changed any value in the inline-edit row, the button should be
 * disabled (and a tooltip should explain why).
 *
 * Kept framework-agnostic so they can be unit-tested without a DOM.
 */

export interface ProvinceEditOriginal {
  addonFee: number;
  shippingDays: number;
}

export interface ProvinceEditDraft {
  addonFee: string;
  shippingDays: string;
}

export interface ZoneEditOriginal {
  baseFee: number;
}

export interface ZoneEditDraft {
  baseFee: string;
}

/**
 * Returns true if `draft` has a numerically different value from `original`
 * for any tracked field. Empty strings and non-numeric inputs are treated
 * as invalid (not dirty) to avoid false-positive enablement.
 */
export function isProvinceEditDirty(
  draft: ProvinceEditDraft,
  original: ProvinceEditOriginal,
): boolean {
  const addonNum = Number(draft.addonFee);
  const daysNum = Number(draft.shippingDays);
  if (draft.addonFee.trim() === '' || !Number.isFinite(addonNum)) return false;
  if (draft.shippingDays.trim() === '' || !Number.isFinite(daysNum)) return false;
  return addonNum !== original.addonFee || daysNum !== original.shippingDays;
}

export function isZoneEditDirty(
  draft: ZoneEditDraft,
  original: ZoneEditOriginal,
): boolean {
  const n = Number(draft.baseFee);
  if (draft.baseFee.trim() === '' || !Number.isFinite(n)) return false;
  return n !== original.baseFee;
}
