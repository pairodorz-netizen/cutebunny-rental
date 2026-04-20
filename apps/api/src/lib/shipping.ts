import type { PrismaClient } from '@prisma/client';

export interface ShippingFeeResult {
  zone: string;
  baseFee: number;
  addonFee: number;
  totalFee: number;
  shippingDays: number;
}

export interface ShippingFeeOptions {
  /**
   * Global fee toggle. When `false`, the calculation short-circuits to
   * `baseFee = addonFee = totalFee = 0` but the per-province `shippingDays`
   * is preserved (see issue #36 — free-shipping mode).
   *
   * Defaults to `true` (fees charged as configured).
   */
  feeEnabled?: boolean;
}

/**
 * Reads the `shipping_fee_enabled` system setting. Defaults to `true` when
 * the row doesn't exist or the value can't be parsed so legacy installs
 * keep charging shipping fees like before.
 */
export async function getShippingFeeEnabled(db: PrismaClient): Promise<boolean> {
  try {
    const row = await db.systemConfig.findUnique({ where: { key: 'shipping_fee_enabled' } });
    if (!row) return true;
    const v = row.value;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v.toLowerCase() !== 'false';
    return true;
  } catch {
    return true;
  }
}

export async function calculateShippingFee(
  db: PrismaClient,
  provinceCode: string,
  _itemCount: number = 1,
  options?: ShippingFeeOptions,
): Promise<ShippingFeeResult | null> {
  const config = await db.shippingProvinceConfig.findFirst({
    where: { provinceCode },
    include: { zone: true },
  });

  if (!config) return null;

  const feeEnabled = options?.feeEnabled ?? (await getShippingFeeEnabled(db));

  // Free-shipping mode: fees collapse to 0 but shipping_days still come from
  // the per-province config (issue #36). Existing per-province fee config is
  // preserved in the database — only the runtime calculation is short-circuited.
  if (!feeEnabled) {
    return {
      zone: config.zone.zoneName,
      baseFee: 0,
      addonFee: 0,
      totalFee: 0,
      shippingDays: config.shippingDays,
    };
  }

  const baseFee = config.zone.baseFee;
  const addonFee = config.addonFee;

  return {
    zone: config.zone.zoneName,
    baseFee,
    addonFee,
    totalFee: baseFee + addonFee,
    shippingDays: config.shippingDays,
  };
}

export function calculateShippingFeeSync(
  baseFee: number,
  addonFee: number,
  _itemCount: number = 1,
  options?: ShippingFeeOptions,
): number {
  if (options && options.feeEnabled === false) return 0;
  return baseFee + addonFee;
}
