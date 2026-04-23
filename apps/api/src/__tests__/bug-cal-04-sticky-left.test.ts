/**
 * BUG-CAL-04 — Sticky left columns anti-overlap (RED → GREEN).
 *
 * Locks in the pure-CSS contract returned by `stickyLeftStyle()`:
 *   - all 3 left columns (SKU, Brand, Name) get `position: sticky`
 *   - `left` offset comes from `cumulativeLeftOffsets()` (no hardcoded numbers)
 *   - headers get a higher `zIndex` than body cells so the top-left cross
 *     region stays layered correctly during horizontal + vertical scroll
 *   - the *rightmost* sticky column (Name) carries a box-shadow on its
 *     right edge for visual separation when date cells scroll under it
 *   - date cells (index >= totalLeftColumns) get no sticky styling
 *
 * Rendering lives in calendar.tsx; this suite is the contract doc for what
 * it applies per cell.
 */
import { describe, it, expect } from 'vitest';
import {
  CALENDAR_LEFT_COLUMNS,
  cumulativeLeftOffsets,
  stickyLeftStyle,
} from '@cutebunny/shared/calendar-columns';

const TOTAL = CALENDAR_LEFT_COLUMNS.length; // 3

describe('BUG-CAL-04 — stickyLeftStyle', () => {
  it('SKU header: sticky, left=0, header zIndex, no box-shadow', () => {
    const style = stickyLeftStyle({ index: 0, isHeader: true, totalLeftColumns: TOTAL });
    expect(style.position).toBe('sticky');
    expect(style.left).toBe(0);
    expect(style.zIndex).toBeGreaterThan(0);
    expect(style.boxShadow).toBeUndefined();
  });

  it('Brand header: sticky, left=90, header zIndex, no box-shadow', () => {
    const style = stickyLeftStyle({ index: 1, isHeader: true, totalLeftColumns: TOTAL });
    expect(style.position).toBe('sticky');
    expect(style.left).toBe(90);
    expect(style.boxShadow).toBeUndefined();
  });

  it('Name header: sticky, left=210, header zIndex, box-shadow on right edge', () => {
    const style = stickyLeftStyle({ index: 2, isHeader: true, totalLeftColumns: TOTAL });
    expect(style.position).toBe('sticky');
    expect(style.left).toBe(210);
    expect(style.boxShadow).toBeTruthy();
    // Box-shadow must be on the right edge (positive x-offset).
    expect(style.boxShadow).toMatch(/^\d+px\s+\d+px/);
  });

  it('Name body cell: sticky, left=210, body zIndex, box-shadow still present', () => {
    const body = stickyLeftStyle({ index: 2, isHeader: false, totalLeftColumns: TOTAL });
    const header = stickyLeftStyle({ index: 2, isHeader: true, totalLeftColumns: TOTAL });
    expect(body.position).toBe('sticky');
    expect(body.left).toBe(210);
    expect(body.boxShadow).toBeTruthy();
    // Header must stack above body (higher zIndex).
    expect(header.zIndex).toBeGreaterThan(body.zIndex);
  });

  it('SKU body cell: sticky, left=0, lower zIndex than header', () => {
    const body = stickyLeftStyle({ index: 0, isHeader: false, totalLeftColumns: TOTAL });
    const header = stickyLeftStyle({ index: 0, isHeader: true, totalLeftColumns: TOTAL });
    expect(body.position).toBe('sticky');
    expect(body.left).toBe(0);
    expect(header.zIndex).toBeGreaterThan(body.zIndex);
  });

  it('all left offsets come from cumulativeLeftOffsets (no hardcoded numbers)', () => {
    const offsets = cumulativeLeftOffsets();
    for (let i = 0; i < TOTAL; i++) {
      expect(stickyLeftStyle({ index: i, isHeader: true, totalLeftColumns: TOTAL }).left).toBe(
        offsets[i],
      );
      expect(stickyLeftStyle({ index: i, isHeader: false, totalLeftColumns: TOTAL }).left).toBe(
        offsets[i],
      );
    }
  });

  it('only the last left column carries the separator box-shadow', () => {
    for (let i = 0; i < TOTAL; i++) {
      const style = stickyLeftStyle({ index: i, isHeader: true, totalLeftColumns: TOTAL });
      if (i === TOTAL - 1) {
        expect(style.boxShadow).toBeTruthy();
      } else {
        expect(style.boxShadow).toBeUndefined();
      }
    }
  });

  it('header zIndex > body zIndex at every index (vertical scroll safety)', () => {
    for (let i = 0; i < TOTAL; i++) {
      const h = stickyLeftStyle({ index: i, isHeader: true, totalLeftColumns: TOTAL });
      const b = stickyLeftStyle({ index: i, isHeader: false, totalLeftColumns: TOTAL });
      expect(h.zIndex).toBeGreaterThan(b.zIndex);
    }
  });

  it('sticky columns carry background so scrolling cells never bleed through', () => {
    for (let i = 0; i < TOTAL; i++) {
      const h = stickyLeftStyle({ index: i, isHeader: true, totalLeftColumns: TOTAL });
      const b = stickyLeftStyle({ index: i, isHeader: false, totalLeftColumns: TOTAL });
      expect(h.background).toBeTruthy();
      expect(b.background).toBeTruthy();
    }
  });

  it('throws on out-of-range index (guards hand-wiring mistakes)', () => {
    expect(() => stickyLeftStyle({ index: -1, isHeader: true, totalLeftColumns: TOTAL })).toThrow();
    expect(() =>
      stickyLeftStyle({ index: TOTAL, isHeader: true, totalLeftColumns: TOTAL }),
    ).toThrow();
  });

  it('snapshot — exact CSS values for the three left columns (header)', () => {
    const snap = [0, 1, 2].map((i) =>
      stickyLeftStyle({ index: i, isHeader: true, totalLeftColumns: TOTAL }),
    );
    expect(snap).toMatchInlineSnapshot(`
      [
        {
          "background": "hsl(var(--muted))",
          "left": 0,
          "position": "sticky",
          "zIndex": 30,
        },
        {
          "background": "hsl(var(--muted))",
          "left": 90,
          "position": "sticky",
          "zIndex": 30,
        },
        {
          "background": "hsl(var(--muted))",
          "boxShadow": "4px 0 6px -2px rgba(0, 0, 0, 0.1)",
          "left": 210,
          "position": "sticky",
          "zIndex": 30,
        },
      ]
    `);
  });
});
