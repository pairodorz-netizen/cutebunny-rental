/**
 * BUG-CAL-01 — Stock Unit Expansion
 *
 * The admin `/calendar` matrix exposes one row per inventory unit, not
 * one row per product. When a product has `stock_on_hand > 1` the
 * row's `display_name` gets a `#<unit_index>` suffix (e.g. `GIGI #1`,
 * `GIGI #2`); when it's `<= 1` the bare name is kept.
 *
 * Slot attribution:
 *   - a slot whose `unit_index === N` belongs to unit N
 *   - legacy slots with `unit_index === null` (pre-FEAT-302) attach to
 *     unit 1 by convention; any reasonable reader of the calendar will
 *     surface them there without double-counting.
 *
 * When a product has `stock_on_hand > 0` but no `InventoryUnit` rows
 * (data that predates the inventory-unit migration, or a freshly
 * seeded product) the helper synthesises unit rows 1..N with
 * `unit_id === null`, so the matrix always has the expected row count.
 */

export interface CalendarInputUnit {
  id: string;
  unit_index: number;
  label?: string | null;
}

export interface CalendarInputSlot {
  date: string;
  status: string;
  order_id: string | null;
  unit_index: number | null;
}

export interface CalendarInputProduct {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  category: string;
  thumbnail: string | null;
  stock_on_hand: number;
  units: CalendarInputUnit[];
  slots: CalendarInputSlot[];
}

export interface CalendarUnitRow {
  product_id: string;
  unit_id: string | null;
  unit_index: number;
  sku: string;
  name: string;
  display_name: string;
  brand: string | null;
  category: string;
  thumbnail: string | null;
  stock_on_hand: number;
  slots: Array<{ date: string; status: string; order_id: string | null }>;
}

function stripSlotUnit(slot: CalendarInputSlot) {
  return { date: slot.date, status: slot.status, order_id: slot.order_id };
}

export function expandProductToUnitRows(p: CalendarInputProduct): CalendarUnitRow[] {
  const effectiveCount = Math.max(1, p.stock_on_hand);
  const multi = effectiveCount > 1;

  const unitByIndex = new Map<number, CalendarInputUnit>();
  for (const u of p.units) unitByIndex.set(u.unit_index, u);

  const rows: CalendarUnitRow[] = [];
  for (let idx = 1; idx <= effectiveCount; idx++) {
    const unit = unitByIndex.get(idx);
    const slotsForUnit = p.slots.filter((s) => {
      if (s.unit_index === idx) return true;
      if (s.unit_index === null && idx === 1) return true;
      return false;
    });
    rows.push({
      product_id: p.id,
      unit_id: unit?.id ?? null,
      unit_index: idx,
      sku: p.sku,
      name: p.name,
      display_name: multi ? `${p.name} #${idx}` : p.name,
      brand: p.brand,
      category: p.category,
      thumbnail: p.thumbnail,
      stock_on_hand: p.stock_on_hand,
      slots: slotsForUnit.map(stripSlotUnit),
    });
  }
  return rows;
}

export function expandProductsToUnitRows(ps: CalendarInputProduct[]): CalendarUnitRow[] {
  return ps.flatMap(expandProductToUnitRows);
}
