import { Hono } from 'hono';
import { getDb } from '../lib/db';
import { success, error } from '../lib/response';
import { calculateShippingFee } from '../lib/shipping';

const shipping = new Hono();

// GET /api/v1/shipping/calculate — Shipping fee calculator
shipping.get('/calculate', async (c) => {
  const db = getDb();
  const provinceCode = c.req.query('province_code');
  const itemCount = parseInt(c.req.query('item_count') ?? '1', 10);

  if (!provinceCode) {
    return error(c, 400, 'VALIDATION_ERROR', 'province_code is required');
  }

  const result = await calculateShippingFee(db, provinceCode, itemCount);

  if (!result) {
    return error(c, 404, 'NOT_FOUND', `No shipping zone found for province code: ${provinceCode}`);
  }

  return success(c, {
    province_code: provinceCode,
    zone: result.zone,
    base_fee: result.baseFee,
    addon_fee: result.addonFee,
    total_fee: result.totalFee,
    currency: 'THB',
  });
});

export default shipping;
