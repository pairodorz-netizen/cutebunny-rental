import { Hono } from 'hono';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import { parseLocale, localizeField } from '../../lib/i18n';

const adminShipping = new Hono();

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
      total_fee: z.baseFee + p.addonFee,
    })),
  }));

  return success(c, data);
});

// A20: GET /api/v1/admin/orders/:id/shipping-label — Label data
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

  return success(c, {
    order_number: order.orderNumber,
    sender: {
      name: 'CuteBunny Rental',
      phone: '+66-XX-XXX-XXXX',
      address: 'Bangkok, Thailand',
    },
    recipient: {
      name: shippingData?.name ?? `${order.customer.firstName} ${order.customer.lastName}`,
      phone: shippingData?.phone ?? order.customer.phone,
      address: shippingData?.address ?? '',
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
    tracking_number: (shippingData?.tracking_number as string) ?? null,
  });
});

export default adminShipping;
