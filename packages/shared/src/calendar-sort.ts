/**
 * BUG-CAL-02 — Locale-aware A–Z sort for the admin calendar matrix.
 *
 * - Default: name ASC (case-insensitive, Thai+English collation).
 * - Tiebreaker: SKU ASC (case-insensitive).
 * - Toggleable by column: 'name' | 'sku' (ATOM 07 will add 'brand').
 *
 * Uses `Intl.Collator(['th', 'en'], { sensitivity: 'base' })` which:
 *   - treats letters as equal across case (`a` === `A`)
 *   - treats `th` characters correctly (Thai has combining marks
 *     that simple `.toLowerCase()` sorts would mis-order)
 *   - falls back gracefully in older environments that only speak `en`.
 *
 * The helper is pure: same input → same output, no Date/Math.random,
 * no DB lookups. It takes whatever rows the frontend has in React
 * Query cache and re-sorts them in memory on header click.
 */

export type CalendarSortKey = 'name' | 'sku' | 'brand';
export type CalendarSortDirection = 'asc' | 'desc';

export interface CalendarSortableRow {
  sku: string;
  name: string;
  brand?: string | null;
  display_name?: string;
}

let _collator: Intl.Collator | null = null;
function getCollator(): Intl.Collator {
  if (!_collator) {
    _collator = new Intl.Collator(['th', 'en'], { sensitivity: 'base', numeric: true });
  }
  return _collator;
}

function fieldFor(row: CalendarSortableRow, key: CalendarSortKey): string {
  switch (key) {
    case 'name':
      return row.display_name ?? row.name ?? '';
    case 'sku':
      return row.sku ?? '';
    case 'brand':
      return row.brand ?? '';
  }
}

export function sortCalendarRows<R extends CalendarSortableRow>(
  rows: readonly R[],
  sortBy: CalendarSortKey = 'name',
  direction: CalendarSortDirection = 'asc',
): R[] {
  const collator = getCollator();
  const multiplier = direction === 'desc' ? -1 : 1;
  const copy = [...rows];
  copy.sort((a, b) => {
    const primary = collator.compare(fieldFor(a, sortBy), fieldFor(b, sortBy));
    if (primary !== 0) return primary * multiplier;
    // Tiebreaker is always SKU ASC (never inverted by direction toggle
    // — tiebreakers should stay deterministic regardless of primary dir).
    if (sortBy !== 'sku') {
      const tie = collator.compare(a.sku ?? '', b.sku ?? '');
      if (tie !== 0) return tie;
    }
    return 0;
  });
  return copy;
}

/**
 * Toggle state machine for header clicks:
 *   - click a different column -> sort by it, asc
 *   - click the same column -> flip direction
 */
export function nextSortState(
  current: { sortBy: CalendarSortKey; direction: CalendarSortDirection },
  clickedKey: CalendarSortKey,
): { sortBy: CalendarSortKey; direction: CalendarSortDirection } {
  if (current.sortBy === clickedKey) {
    return { sortBy: clickedKey, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { sortBy: clickedKey, direction: 'asc' };
}
