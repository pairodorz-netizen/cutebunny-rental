import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, created as created_response, error } from '../../lib/response';
import { parseLocale, localizeField } from '../../lib/i18n';

const THAI_CARRIERS = [
  { code: 'kerry', name: 'Kerry Express', tracking_url: 'https://th.kerryexpress.com/en/track/?track=' },
  { code: 'thailand_post', name: 'Thailand Post', tracking_url: 'https://track.thailandpost.co.th/?trackNumber=' },
  { code: 'flash', name: 'Flash Express', tracking_url: 'https://www.flashexpress.co.th/tracking/?se=' },
  { code: 'jt', name: 'J&T Express', tracking_url: 'https://www.jtexpress.co.th/trajectoryQuery?waybillNo=' },
];

const adminShipping = new Hono();

// GET /api/v1/admin/shipping/carriers — List supported carriers
adminShipping.get('/carriers', (c) => {
  return success(c, THAI_CARRIERS);
});

// A19: GET /api/v1/admin/shipping/zones — Shipping zone config
adminShipping.get('/zones', async (c) => {
  const db = getDb();
  const locale = parseLocale(c.req.query('locale'));

  const zones = await db.shippingZone.findMany({
    include: {
      provinceConfigs: {
        orderBy: { provinceCode: 'asc' },
      },
    },
    orderBy: { baseFee: 'asc' },
  });

  const data = zones.map((z) => ({
    id: z.id,
    zone_name: localizeField(z.nameI18n as Record<string, string> | null, z.zoneName, locale),
    base_fee: z.baseFee,
    provinces: z.provinceConfigs.map((p) => ({
      id: p.id,
      province_code: p.provinceCode,
      province_name: p.provinceName,
      addon_fee: p.addonFee,
      shipping_days: p.shippingDays,
      total_fee: z.baseFee + p.addonFee,
    })),
  }));

  return success(c, data);
});

// A20: GET /api/v1/admin/shipping/orders/:id/shipping-label — Label data
adminShipping.get('/orders/:id/shipping-label', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      customer: {
        select: { firstName: true, lastName: true, phone: true, email: true },
      },
      items: {
        select: { productName: true, size: true, quantity: true },
      },
    },
  });

  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  const shippingData = order.shippingSnapshot as Record<string, unknown> | null;
  const carrierCode = (shippingData?.carrier as string) ?? null;
  const carrier = THAI_CARRIERS.find((cr) => cr.code === carrierCode) ?? null;
  const trackingNumber = (shippingData?.tracking_number as string) ?? null;

  return success(c, {
    order_number: order.orderNumber,
    order_id: order.id,
    status: order.status,
    sender: {
      name: 'CuteBunny Rental',
      phone: '+66-98-765-4321',
      address: '123 Sukhumvit Rd, Khlong Toei, Bangkok 10110',
    },
    recipient: {
      name: shippingData?.name ?? `${order.customer.firstName} ${order.customer.lastName}`,
      phone: shippingData?.phone ?? order.customer.phone,
      address: shippingData?.address ?? '',
      subdistrict: (shippingData?.subdistrict as string) ?? '',
      district: (shippingData?.district as string) ?? '',
      province: (shippingData?.province as string) ?? '',
      postal_code: (shippingData?.postal_code as string) ?? '',
    },
    items: order.items.map((i) => ({
      name: i.productName,
      size: i.size,
      quantity: i.quantity,
    })),
    rental_period: {
      start: order.rentalStartDate.toISOString().split('T')[0],
      end: order.rentalEndDate.toISOString().split('T')[0],
    },
    tracking_number: trackingNumber,
    carrier: carrier
      ? { code: carrier.code, name: carrier.name, tracking_url: trackingNumber ? carrier.tracking_url + trackingNumber : null }
      : null,
    qr_data: `CUTEBUNNY|${order.orderNumber}|${trackingNumber ?? 'PENDING'}`,
  });
});

// PATCH /api/v1/admin/shipping/orders/:id/carrier — Set carrier + tracking
adminShipping.patch('/orders/:id/carrier', async (c) => {
  const db = getDb();
  const orderId = c.req.param('id');

  const bodySchema = z.object({
    carrier_code: z.enum(['kerry', 'thailand_post', 'flash', 'jt']),
    tracking_number: z.string().min(1).optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid carrier data', parsed.error.flatten());
  }

  const order = await db.order.findUnique({ where: { id: orderId } });
  if (!order) {
    return error(c, 404, 'NOT_FOUND', 'Order not found');
  }

  const existingSnapshot = (order.shippingSnapshot as Record<string, unknown>) ?? {};

  await db.order.update({
    where: { id: orderId },
    data: {
      shippingSnapshot: {
        ...existingSnapshot,
        carrier: parsed.data.carrier_code,
        ...(parsed.data.tracking_number && { tracking_number: parsed.data.tracking_number }),
      },
    },
  });

  const carrier = THAI_CARRIERS.find((cr) => cr.code === parsed.data.carrier_code);

  return success(c, {
    carrier_code: parsed.data.carrier_code,
    carrier_name: carrier?.name ?? parsed.data.carrier_code,
    tracking_number: parsed.data.tracking_number ?? (existingSnapshot.tracking_number as string) ?? null,
  });
});

// POST /api/v1/admin/shipping/zones — Create a new shipping zone
adminShipping.post('/zones', async (c) => {
  const db = getDb();

  const bodySchema = z.object({
    zone_name: z.string().min(1),
    base_fee: z.number().min(0).default(0),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid zone data', parsed.error.flatten());
  }

  const existing = await db.shippingZone.findUnique({ where: { zoneName: parsed.data.zone_name } });
  if (existing) {
    return error(c, 409, 'CONFLICT', `Zone "${parsed.data.zone_name}" already exists`);
  }

  const zone = await db.shippingZone.create({
    data: {
      zoneName: parsed.data.zone_name,
      baseFee: parsed.data.base_fee,
    },
  });

  return created_response(c, {
    id: zone.id,
    zone_name: zone.zoneName,
    base_fee: zone.baseFee,
  });
});

// PATCH /api/v1/admin/shipping/zones/:id — Update zone base fee
adminShipping.patch('/zones/:id', async (c) => {
  const db = getDb();
  const zoneId = c.req.param('id');

  const bodySchema = z.object({
    zone_name: z.string().min(1).optional(),
    base_fee: z.number().min(0).optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid zone data', parsed.error.flatten());
  }

  const zone = await db.shippingZone.findUnique({ where: { id: zoneId } });
  if (!zone) {
    return error(c, 404, 'NOT_FOUND', 'Shipping zone not found');
  }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.zone_name) {
    updateData.zoneName = parsed.data.zone_name;
    // Also update nameI18n so localizeField returns the new name
    const existingI18n = (zone.nameI18n as Record<string, string> | null) ?? {};
    updateData.nameI18n = { ...existingI18n, en: parsed.data.zone_name };
  }
  if (parsed.data.base_fee !== undefined) {
    updateData.baseFee = parsed.data.base_fee;
  }

  const updated = await db.shippingZone.update({
    where: { id: zoneId },
    data: updateData,
  });

  return success(c, {
    id: updated.id,
    zone_name: updated.zoneName,
    base_fee: updated.baseFee,
  });
});

// PATCH /api/v1/admin/shipping/provinces/:id — Update province addon fee
adminShipping.patch('/provinces/:id', async (c) => {
  const db = getDb();
  const provinceId = c.req.param('id');

  const bodySchema = z.object({
    addon_fee: z.number().min(0).optional(),
    shipping_days: z.number().int().min(1).max(30).optional(),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid province data', parsed.error.flatten());
  }

  const province = await db.shippingProvinceConfig.findUnique({ where: { id: provinceId } });
  if (!province) {
    return error(c, 404, 'NOT_FOUND', 'Province config not found');
  }

  const updated = await db.shippingProvinceConfig.update({
    where: { id: provinceId },
    data: {
      ...(parsed.data.addon_fee !== undefined && { addonFee: parsed.data.addon_fee }),
      ...(parsed.data.shipping_days !== undefined && { shippingDays: parsed.data.shipping_days }),
    },
  });

  return success(c, {
    id: updated.id,
    province_code: updated.provinceCode,
    province_name: updated.provinceName,
    addon_fee: updated.addonFee,
    shipping_days: updated.shippingDays,
  });
});

// POST /api/v1/admin/shipping/zones/:id/provinces — Add province to zone
adminShipping.post('/zones/:id/provinces', async (c) => {
  const db = getDb();
  const zoneId = c.req.param('id');

  const bodySchema = z.object({
    province_code: z.string().min(2).max(10),
    province_name: z.string().min(1),
    addon_fee: z.number().min(0).default(0),
    shipping_days: z.number().int().min(1).max(30).default(2),
  });

  const body = await c.req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid province data', parsed.error.flatten());
  }

  const zone = await db.shippingZone.findUnique({ where: { id: zoneId } });
  if (!zone) {
    return error(c, 404, 'NOT_FOUND', 'Shipping zone not found');
  }

  const existing = await db.shippingProvinceConfig.findFirst({
    where: { provinceCode: parsed.data.province_code },
  });
  if (existing) {
    return error(c, 409, 'CONFLICT', `Province ${parsed.data.province_code} already assigned to a zone`);
  }

  const created = await db.shippingProvinceConfig.create({
    data: {
      provinceCode: parsed.data.province_code,
      provinceName: parsed.data.province_name,
      addonFee: parsed.data.addon_fee,
      shippingDays: parsed.data.shipping_days,
      zoneId,
    },
  });

  return created_response(c, {
    id: created.id,
    province_code: created.provinceCode,
    province_name: created.provinceName,
    addon_fee: created.addonFee,
    shipping_days: created.shippingDays,
  });
});

// DELETE /api/v1/admin/shipping/provinces/:id — Remove province from zone
adminShipping.delete('/provinces/:id', async (c) => {
  const db = getDb();
  const provinceId = c.req.param('id');

  const province = await db.shippingProvinceConfig.findUnique({ where: { id: provinceId } });
  if (!province) {
    return error(c, 404, 'NOT_FOUND', 'Province config not found');
  }

  await db.shippingProvinceConfig.delete({ where: { id: provinceId } });

  return success(c, { deleted: true });
});

export default adminShipping;
