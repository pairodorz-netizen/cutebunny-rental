import type { PrismaClient } from '@prisma/client';

export interface MessengerConfig {
  enabled: boolean;
  baseFee: number;
  perKmFee: number;
  baseDistanceKm: number;
  maxDistanceKm: number;
  shopOriginLat: number;
  shopOriginLng: number;
}

export interface MessengerEstimate {
  available: boolean;
  distanceKm: number;
  fee: number;
  baseFee: number;
  perKmFee: number;
  paymentMode: string;
  estimatedMinutes: number;
  reason?: string;
  maxDistanceKm?: number;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseConfigNum(value: unknown, fallback: number): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function parseConfigBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return fallback;
}

export async function getMessengerConfig(
  db: PrismaClient,
): Promise<MessengerConfig> {
  const keys = [
    'messenger_enabled',
    'messenger_base_fee',
    'messenger_per_km_fee',
    'messenger_base_distance_km',
    'messenger_max_distance_km',
    'shop_origin_lat',
    'shop_origin_lng',
  ];

  const rows = await db.systemConfig.findMany({
    where: { key: { in: keys } },
  });

  const map = new Map(rows.map((r) => [r.key, r.value]));

  return {
    enabled: parseConfigBool(map.get('messenger_enabled'), false),
    baseFee: parseConfigNum(map.get('messenger_base_fee'), 100),
    perKmFee: parseConfigNum(map.get('messenger_per_km_fee'), 15),
    baseDistanceKm: parseConfigNum(map.get('messenger_base_distance_km'), 5),
    maxDistanceKm: parseConfigNum(map.get('messenger_max_distance_km'), 50),
    shopOriginLat: parseConfigNum(map.get('shop_origin_lat'), 0),
    shopOriginLng: parseConfigNum(map.get('shop_origin_lng'), 0),
  };
}

export function calculateMessengerFee(
  distanceKm: number,
  config: MessengerConfig,
): { fee: number; basePortion: number; distancePortion: number } {
  if (distanceKm <= config.baseDistanceKm) {
    return { fee: config.baseFee, basePortion: config.baseFee, distancePortion: 0 };
  }
  const distancePortion = Math.ceil(
    (distanceKm - config.baseDistanceKm) * config.perKmFee,
  );
  const fee = config.baseFee + distancePortion;
  return { fee, basePortion: config.baseFee, distancePortion };
}

export function estimateMessenger(
  customerLat: number,
  customerLng: number,
  config: MessengerConfig,
): MessengerEstimate {
  const distanceKm = haversineDistanceKm(
    config.shopOriginLat,
    config.shopOriginLng,
    customerLat,
    customerLng,
  );

  const roundedDistance = Math.round(distanceKm * 10) / 10;

  if (roundedDistance > config.maxDistanceKm) {
    return {
      available: false,
      distanceKm: roundedDistance,
      fee: 0,
      baseFee: 0,
      perKmFee: 0,
      paymentMode: 'cod',
      estimatedMinutes: 0,
      reason: 'DISTANCE_EXCEEDED',
      maxDistanceKm: config.maxDistanceKm,
    };
  }

  const { fee, basePortion, distancePortion } = calculateMessengerFee(
    roundedDistance,
    config,
  );

  // Rough estimate: ~3 min/km in Bangkok traffic
  const estimatedMinutes = Math.max(15, Math.round(roundedDistance * 3));

  return {
    available: true,
    distanceKm: roundedDistance,
    fee,
    baseFee: basePortion,
    perKmFee: distancePortion,
    paymentMode: 'cod',
    estimatedMinutes,
  };
}

/**
 * Determine the return method based on rental duration business rules.
 * - 1-day rental: return MUST be messenger
 * - 3+ day rental: return MUST be standard
 */
export function resolveReturnMethod(
  rentalDays: number,
  _deliveryMethod: 'standard' | 'messenger',
): 'standard' | 'messenger' {
  if (rentalDays === 1) return 'messenger';
  return 'standard';
}
