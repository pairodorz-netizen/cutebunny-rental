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

/**
 * BUG-CAL-04 — CSS contract for a single left-sticky cell.
 *
 * - All 3 left columns stick at their cumulative offset.
 * - Header cells stack above body cells (z:30 vs z:20) so the top-left
 *   cross region stays layered correctly when a user scrolls both axes.
 * - Date cells are NOT sticky (this helper only handles left columns —
 *   the page ignores it for index >= totalLeftColumns).
 * - The *rightmost* sticky column (Name, index = totalLeftColumns - 1)
 *   carries a right-edge box-shadow for visual separation from date
 *   cells scrolling horizontally underneath.
 * - Sticky cells carry an opaque background so scrolling date cells
 *   never bleed through the transparent gap.
 *
 * Keeping the numbers here (not in Tailwind classes) lets the vitest
 * suite lock the exact pixel values; ATOM 04 trusts the same numbers
 * ATOM 07 used so header + body alignment is mechanically guaranteed.
 */
export type StickyCSSPosition = 'sticky';

export interface StickyLeftStyle {
  position: StickyCSSPosition;
  left: number;
  zIndex: number;
  background: string;
  boxShadow?: string;
}

const STICKY_BG = 'hsl(var(--muted))';
const STICKY_BG_BODY = 'hsl(var(--background))';
const Z_HEADER_STICKY = 30;
const Z_BODY_STICKY = 20;
const EDGE_SHADOW = '4px 0 6px -2px rgba(0, 0, 0, 0.1)';

export function stickyLeftStyle(params: {
  index: number;
  isHeader: boolean;
  totalLeftColumns: number;
}): StickyLeftStyle {
  const { index, isHeader, totalLeftColumns } = params;
  if (index < 0 || index >= totalLeftColumns) {
    throw new RangeError(
      `stickyLeftStyle: index ${index} is out of range [0, ${totalLeftColumns})`,
    );
  }
  const offsets = cumulativeLeftOffsets(CALENDAR_LEFT_COLUMNS);
  const isLast = index === totalLeftColumns - 1;
  const style: StickyLeftStyle = {
    position: 'sticky',
    left: offsets[index],
    zIndex: isHeader ? Z_HEADER_STICKY : Z_BODY_STICKY,
    background: isHeader ? STICKY_BG : STICKY_BG_BODY,
  };
  if (isLast) style.boxShadow = EDGE_SHADOW;
  return style;
}
