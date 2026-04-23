/**
 * BUG-CAL-07 — SKU + Brand columns before Name (RED → GREEN).
 *
 * Locks in the calendar left-column contract:
 *   - exact order: SKU, Brand, Name  (not Name, SKU, Brand etc.)
 *   - widths  : SKU=90px, Brand=120px, Name=200px
 *   - sortKey : 'sku' | 'brand' | 'name' (matches CalendarSortKey)
 *   - all three are clickable-sortable (inherits BUG-CAL-02)
 *
 * Pure config lives in @cutebunny/shared/calendar-columns; the admin
 * calendar page renders from this array so header order and widths
 * cannot drift from the spec without this suite screaming.
 */
import { describe, it, expect } from 'vitest';
import {
  CALENDAR_LEFT_COLUMNS,
  type CalendarLeftColumn,
} from '@cutebunny/shared/calendar-columns';
import type { CalendarSortKey } from '@cutebunny/shared/calendar-sort';

describe('BUG-CAL-07 — CALENDAR_LEFT_COLUMNS', () => {
  it('has exactly 3 entries', () => {
    expect(CALENDAR_LEFT_COLUMNS).toHaveLength(3);
  });

  it('renders SKU, Brand, Name in that exact order', () => {
    expect(CALENDAR_LEFT_COLUMNS.map((c) => c.sortKey)).toEqual([
      'sku',
      'brand',
      'name',
    ] satisfies CalendarSortKey[]);
  });

  it('uses the spec widths (SKU 90 / Brand 120 / Name 200)', () => {
    expect(CALENDAR_LEFT_COLUMNS.map((c) => c.width)).toEqual([90, 120, 200]);
  });

  it('labels are stable identifiers (SKU / Brand / Name)', () => {
    expect(CALENDAR_LEFT_COLUMNS.map((c) => c.label)).toEqual(['SKU', 'Brand', 'Name']);
  });

  it('every column is marked sortable (header is clickable)', () => {
    for (const col of CALENDAR_LEFT_COLUMNS) {
      expect(col.sortable).toBe(true);
    }
  });

  it('every column has a unique testid prefix for e2e targeting', () => {
    const testIds = CALENDAR_LEFT_COLUMNS.map((c) => c.testId);
    expect(new Set(testIds).size).toBe(testIds.length);
    expect(testIds).toEqual([
      'calendar-col-sku',
      'calendar-col-brand',
      'calendar-col-name',
    ]);
  });

  it('sortKey values match CalendarSortKey union (type-level sanity)', () => {
    // If a future hand typoes 'skuu' this will blow up at compile time too.
    const keys: CalendarSortKey[] = CALENDAR_LEFT_COLUMNS.map((c) => c.sortKey);
    expect(keys).toHaveLength(3);
  });

  it('column shape includes all required fields (no partial rows)', () => {
    for (const col of CALENDAR_LEFT_COLUMNS) {
      const c: CalendarLeftColumn = col;
      expect(typeof c.sortKey).toBe('string');
      expect(typeof c.label).toBe('string');
      expect(typeof c.width).toBe('number');
      expect(typeof c.sortable).toBe('boolean');
      expect(typeof c.testId).toBe('string');
    }
  });

  it('widths are plain integers (no units baked in — CSS layer owns px)', () => {
    for (const col of CALENDAR_LEFT_COLUMNS) {
      expect(Number.isInteger(col.width)).toBe(true);
      expect(col.width).toBeGreaterThan(0);
    }
  });

  it('total left width matches brief (90+120+200 = 410px)', () => {
    const total = CALENDAR_LEFT_COLUMNS.reduce((s, c) => s + c.width, 0);
    expect(total).toBe(410);
  });
});
