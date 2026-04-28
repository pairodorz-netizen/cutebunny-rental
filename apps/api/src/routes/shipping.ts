import { Hono } from 'hono';
import { getDb } from '../lib/db';
import { success, error } from '../lib/response';
import { calculateShippingFee, getShippingFeeEnabled } from '../lib/shipping';
import { getMessengerConfig, estimateMessenger } from '../lib/messenger';

const shipping = new Hono();

// GET /api/v1/shipping/calculate — Shipping fee calculator
shipping.get('/calculate', async (c) => {
  const db = getDb();
  const provinceCode = c.req.query('province_code');
  const itemCount = parseInt(c.req.query('item_count') ?? '1', 10);

  if (!provinceCode) {
    return error(c, 400, 'VALIDATION_ERROR', 'province_code is required');
  }

  // Apply the global shipping_fee_enabled toggle (issue #36). When off,
  // fees collapse to 0 while shipping_days stays intact.
  const feeEnabled = await getShippingFeeEnabled(db);
  const result = await calculateShippingFee(db, provinceCode, itemCount, { feeEnabled });

  if (!result) {
    return error(c, 404, 'NOT_FOUND', `No shipping zone found for province code: ${provinceCode}`);
  }

  return success(c, {
    province_code: provinceCode,
    zone: result.zone,
    base_fee: result.baseFee,
    addon_fee: result.addonFee,
    total_fee: result.totalFee,
    shipping_days: result.shippingDays,
    fee_enabled: feeEnabled,
    currency: 'THB',
  });
});

// GET /api/v1/shipping/messenger-estimate — Messenger fee calculator
shipping.get('/messenger-estimate', async (c) => {
  const db = getDb();
  const lat = parseFloat(c.req.query('lat') ?? '');
  const lng = parseFloat(c.req.query('lng') ?? '');

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return error(c, 400, 'VALIDATION_ERROR', 'lat and lng are required');
  }

  const config = await getMessengerConfig(db);
  if (!config.enabled) {
    return success(c, {
      available: false,
      reason: 'MESSENGER_DISABLED',
    });
  }

  if (config.shopOriginLat === 0 && config.shopOriginLng === 0) {
    return success(c, {
      available: false,
      reason: 'SHOP_ORIGIN_NOT_CONFIGURED',
    });
  }

  const estimate = estimateMessenger(lat, lng, config);

  return success(c, {
    available: estimate.available,
    distance_km: estimate.distanceKm,
    fee: estimate.fee,
    base_fee: estimate.baseFee,
    per_km_fee: estimate.perKmFee,
    currency: 'THB',
    payment_mode: estimate.paymentMode,
    estimated_minutes: estimate.estimatedMinutes,
    ...(estimate.reason ? { reason: estimate.reason } : {}),
    ...(estimate.maxDistanceKm !== undefined ? { max_distance_km: estimate.maxDistanceKm } : {}),
  });
});

export default shipping;
