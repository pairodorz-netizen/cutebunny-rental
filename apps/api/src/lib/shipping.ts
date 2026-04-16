import type { PrismaClient } from '@prisma/client';

export interface ShippingFeeResult {
  zone: string;
  baseFee: number;
  addonFee: number;
  totalFee: number;
}

export async function calculateShippingFee(
  db: PrismaClient,
  provinceCode: string,
  _itemCount: number = 1
): Promise<ShippingFeeResult | null> {
  const config = await db.shippingProvinceConfig.findFirst({
    where: { provinceCode },
    include: { zone: true },
  });

  if (!config) return null;

  const baseFee = config.zone.baseFee;
  const addonFee = config.addonFee;

  return {
    zone: config.zone.zoneName,
    baseFee,
    addonFee,
    totalFee: baseFee + addonFee,
  };
}

export function calculateShippingFeeSync(
  baseFee: number,
  addonFee: number,
  _itemCount: number = 1
): number {
  return baseFee + addonFee;
}
