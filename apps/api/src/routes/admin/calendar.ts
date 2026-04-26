import { Hono } from 'hono';
import { z } from 'zod';
import { getDb } from '../../lib/db';
import { success, error } from '../../lib/response';
import { parseLocale, localizeField } from '../../lib/i18n';
import { getAdmin, requireRole } from '../../middleware/auth';
import { expandProductsToUnitRows, type CalendarInputProduct } from '../../lib/calendar-row-expansion';
import {
  SLOT_STATES,
  canTransition,
  type SlotState,
} from '@cutebunny/shared/calendar-state-machine';

const adminCalendar = new Hono();

async function safeAuditLog(
  db: ReturnType<typeof getDb>,
  data: Parameters<ReturnType<typeof getDb>['auditLog']['create']>[0]['data'],
): Promise<void> {
  try {
    await db.auditLog.create({ data });
  } catch {
    // Audit log is non-critical; swallow errors from schema drift.
  }
}

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

// ─── BUG-CAL-05 ─ PATCH /api/v1/admin/calendar/cell ──────────────────────
//
// Click-to-edit: admin opens a cell popover, picks a new state, this
// route enforces the shared state-machine rules and writes an audit log
// row. Destructive transitions (anything → 'available') demand an
// explicit `confirmed: true` flag, matching the UI confirm dialog.
// Works for both per-unit rows (`unit_index` provided) and legacy
// aggregate rows (`unit_index: null`).

const patchCellSchema = z.object({
  product_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
  unit_index: z.number().int().min(1).nullable(),
  new_state: z.enum(SLOT_STATES as readonly [SlotState, ...SlotState[]]),
  confirmed: z.boolean().optional().default(false),
});

adminCalendar.patch('/cell', requireRole('staff'), async (c) => {
  const db = getDb();
  const admin = getAdmin(c);
  const body = await c.req.json().catch(() => null);
  const parsed = patchCellSchema.safeParse(body);
  if (!parsed.success) {
    return error(c, 400, 'VALIDATION_ERROR', 'Invalid cell patch', parsed.error.flatten());
  }
  const { product_id, date, unit_index, new_state, confirmed } = parsed.data;

  // Find existing slot (may not exist — calendar rendering synthesises
  // 'available' for missing rows, so we treat absence as `from=available`).
  const calendarDate = new Date(`${date}T00:00:00.000Z`);
  const existing = await db.availabilityCalendar.findFirst({
    where: {
      productId: product_id,
      calendarDate,
      ...(unit_index === null ? { unitIndex: null } : { unitIndex: unit_index }),
    },
  });

  const from: SlotState = (existing?.slotStatus as SlotState) ?? 'available';
  const transition = canTransition(from, new_state);

  if (!transition.ok) {
    return error(c, 400, 'INVALID_TRANSITION', transition.reason);
  }
  if ('noop' in transition && transition.noop) {
    return success(c, { from, to: new_state, noop: true });
  }
  if ('confirm' in transition && transition.confirm && !confirmed) {
    return error(c, 409, 'CONFIRM_REQUIRED', transition.reason);
  }

  // Persist: update-or-create so we don't require a pre-existing row.
  let savedId: string;
  if (existing) {
    const updated = await db.availabilityCalendar.update({
      where: { id: existing.id },
      data: { slotStatus: new_state },
    });
    savedId = updated.id;
  } else {
    const created = await db.availabilityCalendar.create({
      data: {
        productId: product_id,
        calendarDate,
        slotStatus: new_state,
        unitIndex: unit_index,
      },
    });
    savedId = created.id;
  }

  await safeAuditLog(db, {
    adminId: admin.sub,
    action: 'UPDATE',
    resource: 'availability_calendar',
    resourceId: savedId,
    details: {
      product_id,
      date,
      unit_index,
      from_state: from,
      to_state: new_state,
    },
  });

  return success(c, { id: savedId, from, to: new_state, noop: false });
});

export default adminCalendar;
