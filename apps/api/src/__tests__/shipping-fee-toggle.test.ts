import { describe, it, expect } from 'vitest';
import {
  calculateShippingFee,
  calculateShippingFeeSync,
  getShippingFeeEnabled,
} from '../lib/shipping';
import type { PrismaClient } from '@prisma/client';

// Issue #36 — Global shipping fee toggle.
//
// When `shipping_fee_enabled === false` the shipping-cost calculation must
// short-circuit to 0 across the board while `shipping_days` from the
// per-province config is preserved. Per-province fee values must NOT be
// deleted — only the runtime calculation is affected.

type MockDbOverride = {
  configValue?: unknown;
  configRow?: null | { key: string; value: unknown };
  provinceConfig?: {
    addonFee: number;
    shippingDays: number;
    zone: { zoneName: string; baseFee: number };
  } | null;
  throwOnConfig?: boolean;
};

function mockDb(overrides: MockDbOverride = {}): PrismaClient {
  const {
    configRow = { key: 'shipping_fee_enabled', value: overrides.configValue ?? 'true' },
    provinceConfig = {
      addonFee: 50,
      shippingDays: 2,
      zone: { zoneName: 'Central', baseFee: 100 },
    },
    throwOnConfig = false,
  } = overrides;

  return {
    systemConfig: {
      findUnique: async () => {
        if (throwOnConfig) throw new Error('db unavailable');
        return configRow;
      },
    },
    shippingProvinceConfig: {
      findFirst: async () => provinceConfig,
    },
  } as unknown as PrismaClient;
}

describe('getShippingFeeEnabled', () => {
  it('defaults to true when the config row does not exist', async () => {
    const db = mockDb({ configRow: null });
    await expect(getShippingFeeEnabled(db)).resolves.toBe(true);
  });

  it('returns true when the value is the string "true"', async () => {
    const db = mockDb({ configValue: 'true' });
    await expect(getShippingFeeEnabled(db)).resolves.toBe(true);
  });

  it('returns false when the value is the string "false"', async () => {
    const db = mockDb({ configValue: 'false' });
    await expect(getShippingFeeEnabled(db)).resolves.toBe(false);
  });

  it('returns the value when stored as a native boolean', async () => {
    const dbTrue = mockDb({ configValue: true });
    const dbFalse = mockDb({ configValue: false });
    await expect(getShippingFeeEnabled(dbTrue)).resolves.toBe(true);
    await expect(getShippingFeeEnabled(dbFalse)).resolves.toBe(false);
  });

  it('defaults to true on DB errors so legacy installs keep charging fees', async () => {
    const db = mockDb({ throwOnConfig: true });
    await expect(getShippingFeeEnabled(db)).resolves.toBe(true);
  });
});

describe('calculateShippingFee — toggle ON (fees charged as configured)', () => {
  it('returns the normal base + addon totals', async () => {
    const db = mockDb({ configValue: 'true' });
    const result = await calculateShippingFee(db, 'BKK', 1);
    expect(result).not.toBeNull();
    expect(result).toEqual({
      zone: 'Central',
      baseFee: 100,
      addonFee: 50,
      totalFee: 150,
      shippingDays: 2,
    });
  });

  it('honors an explicit feeEnabled=true option', async () => {
    const db = mockDb({ configValue: 'false' }); // DB says OFF
    const result = await calculateShippingFee(db, 'BKK', 1, { feeEnabled: true });
    expect(result?.totalFee).toBe(150);
  });

  it('returns null for unknown province code even when enabled', async () => {
    const db = mockDb({ provinceConfig: null });
    const result = await calculateShippingFee(db, 'XYZ', 1, { feeEnabled: true });
    expect(result).toBeNull();
  });
});

describe('calculateShippingFee — toggle OFF (free shipping)', () => {
  it('collapses baseFee, addonFee and totalFee to 0 when DB says OFF', async () => {
    const db = mockDb({ configValue: 'false' });
    const result = await calculateShippingFee(db, 'BKK', 1);
    expect(result).not.toBeNull();
    expect(result?.baseFee).toBe(0);
    expect(result?.addonFee).toBe(0);
    expect(result?.totalFee).toBe(0);
  });

  it('preserves shipping_days from the per-province config when OFF', async () => {
    const db = mockDb({
      configValue: 'false',
      provinceConfig: {
        addonFee: 50,
        shippingDays: 5,
        zone: { zoneName: 'Far North', baseFee: 200 },
      },
    });
    const result = await calculateShippingFee(db, 'CMI', 1);
    expect(result?.shippingDays).toBe(5);
    expect(result?.zone).toBe('Far North');
    expect(result?.totalFee).toBe(0);
  });

  it('honors an explicit feeEnabled=false option even when DB says ON', async () => {
    const db = mockDb({ configValue: 'true' });
    const result = await calculateShippingFee(db, 'BKK', 1, { feeEnabled: false });
    expect(result?.totalFee).toBe(0);
    expect(result?.shippingDays).toBe(2);
  });

  it('still returns null for unknown province codes (404 stays a 404)', async () => {
    const db = mockDb({ provinceConfig: null, configValue: 'false' });
    const result = await calculateShippingFee(db, 'XYZ', 1);
    expect(result).toBeNull();
  });
});

describe('calculateShippingFeeSync — toggle OFF', () => {
  it('returns 0 when feeEnabled option is false', () => {
    expect(calculateShippingFeeSync(100, 50, 1, { feeEnabled: false })).toBe(0);
  });

  it('returns base + addon when feeEnabled is true or unset', () => {
    expect(calculateShippingFeeSync(100, 50)).toBe(150);
    expect(calculateShippingFeeSync(100, 50, 1, { feeEnabled: true })).toBe(150);
  });
});
