/**
 * BUG-CAL-07 — Shared spec for the admin calendar's left-side columns.
 *
 * Order: SKU → Brand → Name, with brief-specified widths (90 / 120 / 200 px).
 * All three are sortable (see BUG-CAL-02). ATOM 04 (sticky-left) reads the
 * same widths to compute `left:` offsets, and the end-of-wave Playwright
 * spec reads the `testId` values for deterministic targeting.
 *
 * This module is pure config. Rendering lives in `calendar.tsx`; the page
 * iterates over `CALENDAR_LEFT_COLUMNS` so header order and widths cannot
 * drift from the spec without the matching vitest suite failing.
 */
import type { CalendarSortKey } from './calendar-sort';

export interface CalendarLeftColumn {
  /** Matches `CalendarSortKey` so the click handler can drive sort. */
  sortKey: CalendarSortKey;
  /** Display label (literal — no i18n key yet; see follow-up). */
  label: string;
  /** Integer pixel width; CSS layer appends `px`. */
  width: number;
  /** Whether the header is clickable for sort toggling. */
  sortable: boolean;
  /** Stable `data-testid` prefix for the Playwright regression spec. */
  testId: string;
}

export const CALENDAR_LEFT_COLUMNS: readonly CalendarLeftColumn[] = [
  { sortKey: 'sku', label: 'SKU', width: 90, sortable: true, testId: 'calendar-col-sku' },
  { sortKey: 'brand', label: 'Brand', width: 120, sortable: true, testId: 'calendar-col-brand' },
  { sortKey: 'name', label: 'Name', width: 200, sortable: true, testId: 'calendar-col-name' },
];

/**
 * Cumulative left-offsets for ATOM 04 sticky positioning.
 * [0, 90, 210] — SKU anchors at 0, Brand at 90, Name at 210.
 */
export function cumulativeLeftOffsets(
  columns: readonly CalendarLeftColumn[] = CALENDAR_LEFT_COLUMNS,
): number[] {
  const offsets: number[] = [];
  let running = 0;
  for (const col of columns) {
    offsets.push(running);
    running += col.width;
  }
  return offsets;
}
