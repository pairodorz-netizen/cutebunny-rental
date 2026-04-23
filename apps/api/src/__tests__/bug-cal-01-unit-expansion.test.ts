/**
 * BUG-CAL-01 — Stock Unit Expansion (RED → GREEN).
 *
 * Pure-logic gates for `expandProductsToUnitRows`. The calendar matrix
 * must expose one row per inventory unit, with `#N` suffix when the
 * product has stock > 1.
 */
import { describe, it, expect } from 'vitest';
import {
  expandProductToUnitRows,
  expandProductsToUnitRows,
  type CalendarInputProduct,
} from '../lib/calendar-row-expansion';

const baseProduct = (overrides: Partial<CalendarInputProduct> = {}): CalendarInputProduct => ({
  id: 'p-1',
  sku: 'A001',
  name: 'GIGI',
  brand: 'Wedding Atelier',
  category: 'wedding',
  thumbnail: null,
  stock_on_hand: 1,
  units: [],
  slots: [],
  ...overrides,
});

describe('BUG-CAL-01 — expandProductToUnitRows', () => {
  it('stock 1 → single row, plain name, no suffix, unit_index = 1', () => {
    const rows = expandProductToUnitRows(baseProduct());
    expect(rows).toHaveLength(1);
    expect(rows[0].display_name).toBe('GIGI');
    expect(rows[0].name).toBe('GIGI');
    expect(rows[0].unit_index).toBe(1);
  });

  it('stock 3 with full InventoryUnit coverage → 3 rows, #1/#2/#3, real unit_ids', () => {
    const rows = expandProductToUnitRows(
      baseProduct({
        stock_on_hand: 3,
        units: [
          { id: 'u-1', unit_index: 1 },
          { id: 'u-2', unit_index: 2 },
          { id: 'u-3', unit_index: 3 },
        ],
      }),
    );
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.display_name)).toEqual(['GIGI #1', 'GIGI #2', 'GIGI #3']);
    expect(rows.map((r) => r.unit_id)).toEqual(['u-1', 'u-2', 'u-3']);
    expect(rows.map((r) => r.unit_index)).toEqual([1, 2, 3]);
  });

  it('stock > 1 with zero InventoryUnit rows → synthesised rows with unit_id null', () => {
    const rows = expandProductToUnitRows(baseProduct({ stock_on_hand: 2, units: [] }));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.unit_id === null)).toBe(true);
    expect(rows.map((r) => r.display_name)).toEqual(['GIGI #1', 'GIGI #2']);
  });

  it('slots are filtered by unit_index per row', () => {
    const rows = expandProductToUnitRows(
      baseProduct({
        stock_on_hand: 2,
        units: [
          { id: 'u-1', unit_index: 1 },
          { id: 'u-2', unit_index: 2 },
        ],
        slots: [
          { date: '2026-04-15', status: 'booked', order_id: 'o-1', unit_index: 1 },
          { date: '2026-04-16', status: 'cleaning', order_id: null, unit_index: 2 },
          { date: '2026-04-17', status: 'booked', order_id: 'o-2', unit_index: 1 },
        ],
      }),
    );
    expect(rows[0].slots).toEqual([
      { date: '2026-04-15', status: 'booked', order_id: 'o-1' },
      { date: '2026-04-17', status: 'booked', order_id: 'o-2' },
    ]);
    expect(rows[1].slots).toEqual([
      { date: '2026-04-16', status: 'cleaning', order_id: null },
    ]);
  });

  it('legacy null-unit_index slots attach to unit 1 only', () => {
    const rows = expandProductToUnitRows(
      baseProduct({
        stock_on_hand: 2,
        units: [
          { id: 'u-1', unit_index: 1 },
          { id: 'u-2', unit_index: 2 },
        ],
        slots: [
          { date: '2026-04-15', status: 'booked', order_id: null, unit_index: null },
        ],
      }),
    );
    expect(rows[0].slots).toHaveLength(1);
    expect(rows[1].slots).toHaveLength(0);
  });

  it('stock 0 (edge case) → still emits a single unit row so the product is visible', () => {
    const rows = expandProductToUnitRows(baseProduct({ stock_on_hand: 0 }));
    expect(rows).toHaveLength(1);
    expect(rows[0].unit_index).toBe(1);
    expect(rows[0].display_name).toBe('GIGI');
  });

  it('preserves product-level metadata on every row (sku, brand, category, thumbnail)', () => {
    const rows = expandProductToUnitRows(
      baseProduct({
        sku: 'A002',
        brand: 'Evening Line',
        category: 'evening',
        thumbnail: 'https://cdn.example/gigi.jpg',
        stock_on_hand: 2,
      }),
    );
    for (const r of rows) {
      expect(r.sku).toBe('A002');
      expect(r.brand).toBe('Evening Line');
      expect(r.category).toBe('evening');
      expect(r.thumbnail).toBe('https://cdn.example/gigi.jpg');
    }
  });
});

describe('BUG-CAL-01 — expandProductsToUnitRows (batch)', () => {
  it('empty input → empty output', () => {
    expect(expandProductsToUnitRows([])).toEqual([]);
  });

  it('expands multiple products independently, preserving order', () => {
    const rows = expandProductsToUnitRows([
      baseProduct({ id: 'p-1', sku: 'A001', name: 'ALPHA', stock_on_hand: 1 }),
      baseProduct({
        id: 'p-2',
        sku: 'A002',
        name: 'BETA',
        stock_on_hand: 2,
        units: [
          { id: 'u-1', unit_index: 1 },
          { id: 'u-2', unit_index: 2 },
        ],
      }),
    ]);
    expect(rows.map((r) => r.display_name)).toEqual(['ALPHA', 'BETA #1', 'BETA #2']);
  });
});
