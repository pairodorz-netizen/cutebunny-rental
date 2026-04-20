import { describe, it, expect } from 'vitest';
import { isProvinceEditDirty, isZoneEditDirty } from '@cutebunny/shared/forms';

// Issue #37: the Save button on the admin Shipping settings inline edit must
// be disabled when the user hasn't changed anything. These tests cover the
// pure dirty-check helper that drives the button's `disabled` + tooltip.

describe('isProvinceEditDirty', () => {
  const original = { addonFee: 20, shippingDays: 2 };

  it('returns false when both draft values equal the original (unchanged)', () => {
    expect(isProvinceEditDirty({ addonFee: '20', shippingDays: '2' }, original)).toBe(false);
  });

  it('returns true when addon fee changed', () => {
    expect(isProvinceEditDirty({ addonFee: '30', shippingDays: '2' }, original)).toBe(true);
  });

  it('returns true when shipping days changed', () => {
    expect(isProvinceEditDirty({ addonFee: '20', shippingDays: '3' }, original)).toBe(true);
  });

  it('treats numerically-equal strings as unchanged ("20" vs 20)', () => {
    expect(isProvinceEditDirty({ addonFee: '20', shippingDays: '2' }, original)).toBe(false);
  });

  it('returns false when a field is empty (invalid draft is not dirty)', () => {
    expect(isProvinceEditDirty({ addonFee: '', shippingDays: '2' }, original)).toBe(false);
    expect(isProvinceEditDirty({ addonFee: '20', shippingDays: '' }, original)).toBe(false);
  });

  it('returns false when a field is not a valid number', () => {
    expect(isProvinceEditDirty({ addonFee: 'abc', shippingDays: '2' }, original)).toBe(false);
  });
});

describe('isZoneEditDirty', () => {
  it('returns false when base fee equals original', () => {
    expect(isZoneEditDirty({ baseFee: '50' }, { baseFee: 50 })).toBe(false);
  });

  it('returns true when base fee changed', () => {
    expect(isZoneEditDirty({ baseFee: '75' }, { baseFee: 50 })).toBe(true);
  });

  it('returns false when base fee draft is empty', () => {
    expect(isZoneEditDirty({ baseFee: '' }, { baseFee: 50 })).toBe(false);
  });

  it('returns false when base fee draft is invalid', () => {
    expect(isZoneEditDirty({ baseFee: 'abc' }, { baseFee: 50 })).toBe(false);
  });
});
