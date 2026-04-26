/**
 * BUG-CAL-03 — Filter header (RED → GREEN).
 *
 * Pure logic only. UI debounce + URL-sync are owned by the admin page
 * and will be covered end-to-end in apps/admin/e2e/calendar-ux.spec.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  filterCalendarRows,
  filtersToQuery,
  filtersFromQuery,
  type CalendarFilterableRow,
} from '@cutebunny/shared/calendar-filter';

const row = (
  sku: string,
  name: string,
  brand: string | null = null,
  display_name = name,
): CalendarFilterableRow => ({ sku, name, brand, display_name });

describe('BUG-CAL-03 — filterCalendarRows', () => {
  const rows: CalendarFilterableRow[] = [
    row('A001', 'Gigi', 'Acme'),
    row('A002', 'Gigi', 'Acme', 'Gigi #2'),
    row('B050', 'Rocky', 'BunnyCo'),
    row('Z999', 'Pixel', 'Acme'),
  ];

  it('empty filters return a copy of all rows (not the same reference)', () => {
    const out = filterCalendarRows(rows, {});
    expect(out).toHaveLength(rows.length);
    expect(out).not.toBe(rows);
  });

  it('filters by name substring, case-insensitive', () => {
    expect(filterCalendarRows(rows, { name: 'gi' }).map((r) => r.sku)).toEqual([
      'A001',
      'A002',
    ]);
  });

  it('name match prefers display_name so #N suffix matches', () => {
    expect(filterCalendarRows(rows, { name: '#2' }).map((r) => r.sku)).toEqual(['A002']);
  });

  it('filters by sku substring', () => {
    expect(filterCalendarRows(rows, { sku: 'a0' }).map((r) => r.sku)).toEqual(['A001', 'A002']);
  });

  it('filters by brand substring', () => {
    expect(filterCalendarRows(rows, { brand: 'bunny' }).map((r) => r.sku)).toEqual(['B050']);
  });

  it('combines filters with AND semantics', () => {
    expect(
      filterCalendarRows(rows, { sku: 'a', brand: 'acme', name: 'gigi' }).map((r) => r.sku),
    ).toEqual(['A001', 'A002']);
  });

  it('whitespace-only fields are treated as empty', () => {
    expect(filterCalendarRows(rows, { name: '   ' })).toHaveLength(rows.length);
  });

  it('empty input array returns empty array', () => {
    expect(filterCalendarRows([], { name: 'gigi' })).toEqual([]);
  });

  it('null/undefined brand does not break match when brand filter is set', () => {
    const noBrand = row('X001', 'Muffin', null);
    expect(filterCalendarRows([noBrand], { brand: 'acme' })).toEqual([]);
  });

  it('Thai substring match works', () => {
    const thai = [row('TH1', 'กระต่าย', 'ไทย'), row('TH2', 'แมว', 'ไทย')];
    expect(filterCalendarRows(thai, { name: 'กระ' }).map((r) => r.sku)).toEqual(['TH1']);
  });
});

describe('BUG-CAL-03 — filtersToQuery', () => {
  it('drops empty and whitespace-only values', () => {
    expect(filtersToQuery({ sku: 'A01', brand: '', name: '   ' })).toEqual({ sku: 'A01' });
  });

  it('keeps all three keys when all are set', () => {
    expect(filtersToQuery({ sku: 'A', brand: 'B', name: 'N' })).toEqual({
      sku: 'A',
      brand: 'B',
      name: 'N',
    });
  });

  it('returns empty object for all-empty', () => {
    expect(filtersToQuery({})).toEqual({});
  });
});

describe('BUG-CAL-03 — filtersFromQuery', () => {
  it('reads present keys and defaults missing ones to empty string', () => {
    const params = new URLSearchParams('sku=A01&name=gigi');
    expect(filtersFromQuery(params)).toEqual({ sku: 'A01', brand: '', name: 'gigi' });
  });

  it('round-trips through toQuery -> URLSearchParams -> fromQuery', () => {
    const original = { sku: 'A01', brand: 'Acme', name: 'Gigi' };
    const params = new URLSearchParams(filtersToQuery(original));
    expect(filtersFromQuery(params)).toEqual(original);
  });

  it('empty URLSearchParams yields all-empty filters', () => {
    expect(filtersFromQuery(new URLSearchParams())).toEqual({ sku: '', brand: '', name: '' });
  });
});
