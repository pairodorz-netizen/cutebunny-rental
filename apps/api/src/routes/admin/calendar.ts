import { Hono } from 'hono';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import { parseLocale, localizeField } from '../../lib/i18n';
import { expandProductsToUnitRows, type CalendarInputProduct } from '../../lib/calendar-row-expansion';

const adminCalendar = new Hono();

// BUG-CAL-01 — Master calendar view, expanded one-row-per-inventory-unit.
// Rows whose product has `stock_on_hand > 1` carry a `#N` suffix on
// `display_name`; rows with stock 1 keep the bare product name. See
// `apps/api/src/lib/calendar-row-expansion.ts`.
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

  const products = await db.product.findMany({
    where: { available: true },
    select: {
      id: true,
      sku: true,
      name: true,
      nameI18n: true,
      category: true,
      thumbnailUrl: true,
      stockOnHand: true,
      brand: { select: { name: true, nameI18n: true } },
      inventoryUnits: {
        select: { id: true, unitIndex: true, label: true },
        orderBy: { unitIndex: 'asc' },
      },
      availabilitySlots: {
        where: {
          calendarDate: { gte: startDate, lte: endDate },
        },
        select: {
          calendarDate: true,
          slotStatus: true,
          orderId: true,
          unitIndex: true,
        },
        orderBy: { calendarDate: 'asc' },
      },
    },
    orderBy: { sku: 'asc' },
  });

  const input: CalendarInputProduct[] = products.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: localizeField(p.nameI18n as Record<string, string> | null, p.name, locale),
    brand: p.brand
      ? localizeField(p.brand.nameI18n as Record<string, string> | null, p.brand.name, locale)
      : null,
    category: p.category,
    thumbnail: p.thumbnailUrl,
    stock_on_hand: p.stockOnHand,
    units: p.inventoryUnits.map((u) => ({
      id: u.id,
      unit_index: u.unitIndex,
      label: u.label,
    })),
    slots: p.availabilitySlots.map((s) => ({
      date: s.calendarDate.toISOString().split('T')[0],
      status: s.slotStatus,
      order_id: s.orderId,
      unit_index: s.unitIndex,
    })),
  }));

  const data = expandProductsToUnitRows(input);

  return success(c, data, {
    date_from: dateFrom,
    date_to: dateTo,
    row_count: data.length,
    product_count: products.length,
  });
});

export default adminCalendar;
