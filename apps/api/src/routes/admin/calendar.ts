import { Hono } from 'hono';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import { parseLocale, localizeField } from '../../lib/i18n';

const adminCalendar = new Hono();

// A06: GET /api/v1/admin/calendar — Master calendar view
adminCalendar.get('/', async (c) => {
  const db = getDb();
  const locale = parseLocale(c.req.query('locale'));
  const dateFrom = c.req.query('date_from');
  const dateTo = c.req.query('date_to');

  if (!dateFrom || !dateTo) {
    return error(c, 400, 'VALIDATION_ERROR', 'date_from and date_to are required');
  }

  const startDate = new Date(dateFrom);
  const endDate = new Date(dateTo);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid date format');
  }

  // Get all products with their availability slots in the date range
  const products = await db.product.findMany({
    where: { available: true },
    select: {
      id: true,
      sku: true,
      name: true,
      nameI18n: true,
      category: true,
      thumbnailUrl: true,
      availabilitySlots: {
        where: {
          calendarDate: { gte: startDate, lte: endDate },
        },
        select: {
          calendarDate: true,
          slotStatus: true,
          orderId: true,
        },
        orderBy: { calendarDate: 'asc' },
      },
    },
    orderBy: { sku: 'asc' },
  });

  const data = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: localizeField(p.nameI18n as Record<string, string> | null, p.name, locale),
    category: p.category,
    thumbnail: p.thumbnailUrl,
    slots: p.availabilitySlots.map((slot) => ({
      date: slot.calendarDate.toISOString().split('T')[0],
      status: slot.slotStatus,
      order_id: slot.orderId,
    })),
  }));

  return success(c, data, {
    date_from: dateFrom,
    date_to: dateTo,
    product_count: data.length,
  });
});

export default adminCalendar;
