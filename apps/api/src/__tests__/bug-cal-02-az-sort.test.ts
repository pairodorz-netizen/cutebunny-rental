/**
 * BUG-CAL-02 — Locale-aware A–Z sort (RED → GREEN).
 *
 * Covers: default name-ASC, SKU tiebreaker, direction toggle,
 * Thai + English collation, stable across repeated sorts, and the
 * header-click state machine.
 */
import { describe, it, expect } from 'vitest';
import {
  sortCalendarRows,
  nextSortState,
  type CalendarSortableRow,
} from '@cutebunny/shared/calendar-sort';

const row = (sku: string, name: string, brand: string | null = null): CalendarSortableRow => ({
  sku,
  name,
  brand,
  display_name: name,
});

describe('BUG-CAL-02 — sortCalendarRows', () => {
  it('default sort is name ASC, case-insensitive', () => {
    const out = sortCalendarRows([row('A003', 'gamma'), row('A001', 'Alpha'), row('A002', 'BETA')]);
    expect(out.map((r) => r.name)).toEqual(['Alpha', 'BETA', 'gamma']);
  });

  it('uses SKU ASC as tiebreaker when names collide', () => {
    const out = sortCalendarRows([
      row('Z999', 'Alpha'),
      row('A001', 'Alpha'),
      row('M050', 'Alpha'),
    ]);
    expect(out.map((r) => r.sku)).toEqual(['A001', 'M050', 'Z999']);
  });

  it('direction=desc reverses primary order but keeps SKU tiebreaker ASC', () => {
    const out = sortCalendarRows(
      [row('Z999', 'Alpha'), row('A001', 'Alpha'), row('B002', 'Beta')],
      'name',
      'desc',
    );
    // Beta first (desc primary), then the two Alphas still A001 before Z999
    // (tiebreaker is deterministic irrespective of primary direction).
    expect(out.map((r) => `${r.name}:${r.sku}`)).toEqual([
      'Beta:B002',
      'Alpha:A001',
      'Alpha:Z999',
    ]);
  });

  it('sort by sku directly', () => {
    const out = sortCalendarRows(
      [row('C003', 'x'), row('A001', 'x'), row('B002', 'x')],
      'sku',
      'asc',
    );
    expect(out.map((r) => r.sku)).toEqual(['A001', 'B002', 'C003']);
  });

  it('Thai+English locale-aware collation sorts Thai letters correctly', () => {
    // กกก < ขขข < ABC when mixed: Thai letters collate among themselves,
    // English keeps its normal order. Both should group alphabetically.
    const out = sortCalendarRows([
      row('TH2', 'ขขข'),
      row('EN1', 'banana'),
      row('EN2', 'Apple'),
      row('TH1', 'กกก'),
    ]);
    const names = out.map((r) => r.name);
    // Apple < banana (English case-insensitive)
    expect(names.indexOf('Apple')).toBeLessThan(names.indexOf('banana'));
    // กกก < ขขข (Thai alphabetical)
    expect(names.indexOf('กกก')).toBeLessThan(names.indexOf('ขขข'));
  });

  it('is stable: re-sorting an already-sorted list is a no-op', () => {
    const initial = sortCalendarRows([row('A002', 'Beta'), row('A001', 'Alpha')]);
    const resorted = sortCalendarRows(initial);
    expect(resorted.map((r) => r.sku)).toEqual(initial.map((r) => r.sku));
  });

  it('does not mutate the input array', () => {
    const input = [row('B002', 'Beta'), row('A001', 'Alpha')];
    const inputCopy = [...input];
    sortCalendarRows(input);
    expect(input).toEqual(inputCopy);
  });

  it('handles empty input', () => {
    expect(sortCalendarRows([])).toEqual([]);
  });

  it('sorts numeric unit suffixes naturally (#2 before #10) via collator numeric mode', () => {
    const out = sortCalendarRows([
      { sku: 'A001', name: 'GIGI', display_name: 'GIGI #10' },
      { sku: 'A002', name: 'GIGI', display_name: 'GIGI #2' },
      { sku: 'A003', name: 'GIGI', display_name: 'GIGI #1' },
    ] as CalendarSortableRow[]);
    expect(out.map((r) => r.display_name)).toEqual(['GIGI #1', 'GIGI #2', 'GIGI #10']);
  });
});

describe('BUG-CAL-02 — nextSortState (header click machine)', () => {
  it('clicking a different column resets to ASC', () => {
    expect(nextSortState({ sortBy: 'name', direction: 'desc' }, 'sku')).toEqual({
      sortBy: 'sku',
      direction: 'asc',
    });
  });

  it('clicking the same column flips asc → desc', () => {
    expect(nextSortState({ sortBy: 'name', direction: 'asc' }, 'name')).toEqual({
      sortBy: 'name',
      direction: 'desc',
    });
  });

  it('clicking the same column flips desc → asc', () => {
    expect(nextSortState({ sortBy: 'name', direction: 'desc' }, 'name')).toEqual({
      sortBy: 'name',
      direction: 'asc',
    });
  });
});
