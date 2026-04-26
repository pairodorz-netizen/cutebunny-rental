/**
 * BUG-CAL-03 — Filter helper for the admin calendar matrix.
 *
 * Applies case-insensitive substring matching on sku, brand, and name
 * independently; rows must match every *provided* (non-empty) filter.
 *
 * Empty / whitespace-only filter fields are ignored, so passing
 * `{ sku: '', brand: '', name: 'gi' }` only filters by name.
 *
 * Pure: same input -> same output. No DB / no fetch / no Date.
 *
 * Locale is kept simple here on purpose — Thai substring match is the
 * default JS behaviour (`"ขขข".toLowerCase().includes("ข")` works).
 * Diacritic folding is out of scope for this atom; if needed later
 * we can layer `String.prototype.normalize('NFD')` on top.
 */

export interface CalendarFilterableRow {
  sku: string;
  name: string;
  display_name?: string;
  brand?: string | null;
}

export interface CalendarFilters {
  sku?: string;
  brand?: string;
  name?: string;
}

function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

export function filterCalendarRows<R extends CalendarFilterableRow>(
  rows: readonly R[],
  filters: CalendarFilters,
): R[] {
  const skuQ = norm(filters.sku);
  const brandQ = norm(filters.brand);
  const nameQ = norm(filters.name);
  if (!skuQ && !brandQ && !nameQ) return [...rows];
  return rows.filter((r) => {
    if (skuQ && !norm(r.sku).includes(skuQ)) return false;
    if (brandQ && !norm(r.brand).includes(brandQ)) return false;
    if (nameQ) {
      // Prefer display_name so `#N`-suffixed searches land on the right
      // unit row; fall back to raw name otherwise.
      const haystack = norm(r.display_name ?? r.name);
      if (!haystack.includes(nameQ)) return false;
    }
    return true;
  });
}

/**
 * Serialize filters to a URLSearchParams-style record so the page can
 * keep the browser URL in sync without pulling any extra deps.
 *
 * Empty / whitespace-only values are dropped so the URL stays clean:
 *   { sku: 'A01', brand: '', name: '' } -> { sku: 'A01' }
 */
export function filtersToQuery(filters: CalendarFilters): Record<string, string> {
  const out: Record<string, string> = {};
  const sku = filters.sku?.trim();
  const brand = filters.brand?.trim();
  const name = filters.name?.trim();
  if (sku) out.sku = sku;
  if (brand) out.brand = brand;
  if (name) out.name = name;
  return out;
}

/**
 * Parse filters back from a URLSearchParams-compatible lookup. Accepts
 * a `URLSearchParams` or the react-router `URLSearchParams` duck type
 * (anything with `.get(key)`).
 */
export function filtersFromQuery(params: { get(key: string): string | null }): CalendarFilters {
  return {
    sku: params.get('sku') ?? '',
    brand: params.get('brand') ?? '',
    name: params.get('name') ?? '',
  };
}
