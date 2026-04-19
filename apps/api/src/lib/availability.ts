import type { PrismaClient, SlotStatus } from '@prisma/client';

export interface DayAvailability {
  date: string;
  status: SlotStatus;
  order_id?: string | null;
}

export interface DayAvailabilityMultiUnit {
  date: string;
  status: SlotStatus;
  available_units: number;
  total_units: number;
}

/**
 * Get month availability for a single product (legacy single-unit or aggregated multi-unit).
 * A day is "available" if ANY unit is free on that day.
 */
export async function getMonthAvailability(
  db: PrismaClient,
  productId: string,
  year: number,
  month: number,
  filters?: { size?: string; color?: string }
): Promise<DayAvailability[]> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // last day of month

  // Check if product has inventory units
  const unitWhere: Record<string, unknown> = { productId };
  if (filters?.size) unitWhere.size = filters.size;
  if (filters?.color) unitWhere.color = filters.color;

  const units = await db.inventoryUnit.findMany({
    where: unitWhere,
    select: { id: true },
  }).catch(() => []);

  if (units.length > 0) {
    // Multi-unit: check per-unit availability
    return getMonthAvailabilityMultiUnit(db, productId, year, month, units.map(u => u.id));
  }

  // Fallback: single-unit legacy behavior
  const slots = await db.availabilityCalendar.findMany({
    where: {
      productId,
      calendarDate: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { calendarDate: 'asc' },
  });

  const slotMap = new Map(
    slots.map((s) => [s.calendarDate.toISOString().split('T')[0], s.slotStatus])
  );

  const result: DayAvailability[] = [];
  const daysInMonth = endDate.getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    result.push({
      date: dateStr,
      status: slotMap.get(dateStr) ?? 'available',
    });
  }

  return result;
}

/**
 * Multi-unit availability: a day is available if at least one unit is free.
 */
async function getMonthAvailabilityMultiUnit(
  db: PrismaClient,
  productId: string,
  year: number,
  month: number,
  unitIds: string[]
): Promise<DayAvailability[]> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  // Get all slots for this product in the month
  const slots = await db.availabilityCalendar.findMany({
    where: {
      productId,
      calendarDate: { gte: startDate, lte: endDate },
    },
    orderBy: { calendarDate: 'asc' },
  });

  // Group booked slots by date → set of unitIds that are booked
  const bookedByDate = new Map<string, Set<string>>();
  const statusByDate = new Map<string, SlotStatus>();
  for (const slot of slots) {
    const dateStr = slot.calendarDate.toISOString().split('T')[0];
    if (slot.slotStatus !== 'available') {
      if (!bookedByDate.has(dateStr)) bookedByDate.set(dateStr, new Set());
      if (slot.unitId) {
        bookedByDate.get(dateStr)!.add(slot.unitId);
      } else {
        // Legacy slot without unit — counts as one booking
        bookedByDate.get(dateStr)!.add('__legacy__');
      }
      // Keep most restrictive status
      if (!statusByDate.has(dateStr)) statusByDate.set(dateStr, slot.slotStatus);
    }
  }

  const result: DayAvailability[] = [];
  const daysInMonth = endDate.getDate();
  const totalUnits = unitIds.length;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const bookedUnits = bookedByDate.get(dateStr)?.size ?? 0;
    const availableUnits = totalUnits - bookedUnits;

    result.push({
      date: dateStr,
      status: availableUnits > 0 ? 'available' : (statusByDate.get(dateStr) ?? 'booked'),
    });
  }

  return result;
}

/**
 * Get per-unit availability for admin calendar view.
 * Groups by unitIndex (always populated on availability_calendar) rather than
 * unitId (often null). Falls back to InventoryUnit labels when available.
 */
export async function getMonthAvailabilityPerUnit(
  db: PrismaClient,
  productId: string,
  year: number,
  month: number,
  unitIndexFilter?: number,
  totalUnits?: number
): Promise<{ unit_id: string | null; unit_label: string; days: DayAvailability[] }[]> {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  // Optionally fetch InventoryUnit records for richer labels
  const inventoryUnits = await db.inventoryUnit.findMany({
    where: { productId },
    orderBy: { unitIndex: 'asc' },
  }).catch(() => []);

  // Fetch availability_calendar slots, optionally filtered by unitIndex
  const slots = await db.availabilityCalendar.findMany({
    where: {
      productId,
      calendarDate: { gte: startDate, lte: endDate },
      ...(unitIndexFilter ? { unitIndex: unitIndexFilter } : {}),
    },
    orderBy: { calendarDate: 'asc' },
  });

  // Determine the set of unit indices to return calendars for
  const product = await db.product.findUnique({ where: { id: productId }, select: { stockOnHand: true } });
  const maxUnits = totalUnits ?? Math.max(
    product?.stockOnHand ?? 1,
    inventoryUnits.length,
    ...slots.map(s => s.unitIndex ?? 1)
  );

  // If filtering to a specific unit, only show that unit
  const unitIndices: number[] = unitIndexFilter
    ? [unitIndexFilter]
    : Array.from({ length: maxUnits }, (_, i) => i + 1);

  // Group slots by unitIndex → date → { status, orderId }
  const slotsByUnitIndex = new Map<number, Map<string, { status: SlotStatus; orderId: string | null }>>();
  for (const slot of slots) {
    const idx = slot.unitIndex ?? 1;
    if (!slotsByUnitIndex.has(idx)) slotsByUnitIndex.set(idx, new Map());
    slotsByUnitIndex.get(idx)!.set(slot.calendarDate.toISOString().split('T')[0], {
      status: slot.slotStatus,
      orderId: slot.orderId,
    });
  }

  const daysInMonth = endDate.getDate();

  return unitIndices.map((unitIdx) => {
    const invUnit = inventoryUnits.find(u => u.unitIndex === unitIdx);
    const unitSlots = slotsByUnitIndex.get(unitIdx) ?? new Map();
    const days: DayAvailability[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const slotData = unitSlots.get(dateStr);
      days.push({
        date: dateStr,
        status: slotData?.status ?? 'available',
        order_id: slotData?.orderId ?? null,
      });
    }
    return {
      unit_id: invUnit?.id ?? null,
      unit_label: invUnit?.label ?? `Unit ${unitIdx}`,
      days,
    };
  });
}

export async function checkAvailability(
  db: PrismaClient,
  productId: string,
  startDate: Date,
  rentalDays: number
): Promise<{ available: boolean; conflictDates: string[] }> {
  const dates: Date[] = [];
  for (let i = 0; i < rentalDays; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dates.push(d);
  }

  const slots = await db.availabilityCalendar.findMany({
    where: {
      productId,
      calendarDate: { in: dates },
      slotStatus: { not: 'available' },
    },
  });

  const conflictDates = slots.map((s) => s.calendarDate.toISOString().split('T')[0]);

  return {
    available: conflictDates.length === 0,
    conflictDates,
  };
}

export async function createTentativeHolds(
  db: PrismaClient,
  productId: string,
  startDate: Date,
  rentalDays: number,
  orderId?: string
): Promise<void> {
  for (let i = 0; i < rentalDays; i++) {
    const calDate = new Date(startDate);
    calDate.setDate(calDate.getDate() + i);
    const dateOnly = new Date(calDate.toISOString().split('T')[0] + 'T00:00:00.000Z');

    await db.availabilityCalendar.upsert({
      where: {
        product_date_unit_unique: {
          productId,
          calendarDate: dateOnly,
          unitIndex: 1,
        },
      },
      update: {
        slotStatus: 'tentative',
        orderId: orderId ?? null,
      },
      create: {
        productId,
        calendarDate: dateOnly,
        unitIndex: 1,
        slotStatus: 'tentative',
        orderId: orderId ?? null,
      },
    });
  }
}

export async function confirmHolds(
  db: PrismaClient,
  productId: string,
  startDate: Date,
  rentalDays: number,
  orderId: string
): Promise<void> {
  for (let i = 0; i < rentalDays; i++) {
    const calDate = new Date(startDate);
    calDate.setDate(calDate.getDate() + i);
    const dateOnly = new Date(calDate.toISOString().split('T')[0] + 'T00:00:00.000Z');

    await db.availabilityCalendar.upsert({
      where: {
        product_date_unit_unique: {
          productId,
          calendarDate: dateOnly,
          unitIndex: 1,
        },
      },
      update: {
        slotStatus: 'booked',
        orderId,
      },
      create: {
        productId,
        calendarDate: dateOnly,
        unitIndex: 1,
        slotStatus: 'booked',
        orderId,
      },
    });
  }
}

/**
 * FEAT-402: Create lifecycle blocking windows around a booking.
 *
 * For a rental R_start..R_end to customer in province P:
 * - Pre-block: D days before R_start (shipping to customer) → status 'shipping'
 * - Post-block: D days after R_end (return shipping) → status 'shipping'
 * - Post-wash: W days after return shipping → status 'washing'
 *
 * Example: R=15-17, Chonburi(D=2), W=1
 *   shipping: 13,14 (pre) + 18,19 (post-return)
 *   washing: 20 (post-wash)
 */
export async function createLifecycleBlocks(
  db: PrismaClient,
  productId: string,
  rentalStartDate: Date,
  rentalEndDate: Date,
  shippingDays: number,
  washDurationDays: number,
  orderId: string,
  unitIndex: number = 1
): Promise<{ shippingBlocked: number; washingBlocked: number }> {
  let shippingBlocked = 0;
  let washingBlocked = 0;

  // Pre-block: D days before rental start (shipping to customer)
  for (let i = 1; i <= shippingDays; i++) {
    const d = new Date(rentalStartDate);
    d.setDate(d.getDate() - i);
    const dateOnly = new Date(d.toISOString().split('T')[0] + 'T00:00:00.000Z');

    await db.availabilityCalendar.upsert({
      where: {
        product_date_unit_unique: { productId, calendarDate: dateOnly, unitIndex },
      },
      update: { slotStatus: 'shipping', orderId },
      create: { productId, calendarDate: dateOnly, unitIndex, slotStatus: 'shipping', orderId },
    });
    shippingBlocked++;
  }

  // Post-block: D days after rental end (return shipping)
  for (let i = 1; i <= shippingDays; i++) {
    const d = new Date(rentalEndDate);
    d.setDate(d.getDate() + i);
    const dateOnly = new Date(d.toISOString().split('T')[0] + 'T00:00:00.000Z');

    await db.availabilityCalendar.upsert({
      where: {
        product_date_unit_unique: { productId, calendarDate: dateOnly, unitIndex },
      },
      update: { slotStatus: 'shipping', orderId },
      create: { productId, calendarDate: dateOnly, unitIndex, slotStatus: 'shipping', orderId },
    });
    shippingBlocked++;
  }

  // Post-wash: W days after return shipping window
  for (let i = 1; i <= washDurationDays; i++) {
    const d = new Date(rentalEndDate);
    d.setDate(d.getDate() + shippingDays + i);
    const dateOnly = new Date(d.toISOString().split('T')[0] + 'T00:00:00.000Z');

    await db.availabilityCalendar.upsert({
      where: {
        product_date_unit_unique: { productId, calendarDate: dateOnly, unitIndex },
      },
      update: { slotStatus: 'washing', orderId },
      create: { productId, calendarDate: dateOnly, unitIndex, slotStatus: 'washing', orderId },
    });
    washingBlocked++;
  }

  return { shippingBlocked, washingBlocked };
}
