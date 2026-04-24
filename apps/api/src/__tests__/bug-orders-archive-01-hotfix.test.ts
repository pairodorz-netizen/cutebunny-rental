// BUG-ORDERS-ARCHIVE-01-HOTFIX — RED gates for the include_stale=true
// short-circuit + empty-bounds handling on the admin /orders list.
//
// Regression reported by owner after PR #79 merged:
//
//   1. Default view (Last 30d, from=today-30, to=today) → 0 rows even
//      when the DB holds eligible orders. Owner's test orders have
//      createdAt timestamps older than 30d even though the rental
//      period falls inside the window.
//
//   2. Toggling `Show all (incl. archived)` ON → still 0 rows because
//      the backend kept the createdAt bounds filter applied.
//
//   3. Clicking the "All Time" preset (which clears from/to and sets
//      include_stale=true) → still 0 rows for the same reason.
//
// Owner's explicit expected contract:
//   "'All Time + include_stale=true' must return ALL orders regardless
//    of date window."
//
// The hotfix adds a pure decision helper `buildOrdersWindowFilter` so
// both the backend route and any post-query consumers agree on when
// createdAt bounds apply and when the archive cutoff applies. The
// single source of truth replaces the pair of conditional branches in
// the route, which previously could never short-circuit createdAt when
// include_stale=true was set.

import { describe, it, expect } from 'vitest';
import {
  buildOrdersWindowFilter,
  computeArchiveCutoff,
  DEFAULT_ARCHIVE_WINDOW_DAYS,
  resolveOrdersDatePreset,
} from '@cutebunny/shared/orders-archive-window';

const NOW = new Date('2026-04-24T12:00:00.000Z');

describe('BUG-ORDERS-ARCHIVE-01-HOTFIX · buildOrdersWindowFilter', () => {
  it('includeStale=true short-circuits BOTH createdAt bounds and archive cutoff', () => {
    const result = buildOrdersWindowFilter({
      includeStale: true,
      dateFrom: '2026-03-25',
      dateTo: '2026-04-24',
      now: NOW,
    });
    expect(result.createdAt).toBeUndefined();
    expect(result.archiveCutoff).toBeUndefined();
  });

  it('includeStale=true with no bounds returns an entirely empty filter (total bypass)', () => {
    const result = buildOrdersWindowFilter({
      includeStale: true,
      now: NOW,
    });
    expect(result).toEqual({});
  });

  it('includeStale=false applies BOTH createdAt gte/lte AND the 30d archive cutoff', () => {
    const result = buildOrdersWindowFilter({
      includeStale: false,
      dateFrom: '2026-03-25',
      dateTo: '2026-04-24',
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-03-25'));
    expect(result.createdAt?.lte).toEqual(new Date('2026-04-24T23:59:59.999Z'));
    expect(result.archiveCutoff).toEqual(computeArchiveCutoff(NOW, DEFAULT_ARCHIVE_WINDOW_DAYS));
  });

  it('includeStale=false with NO bounds still applies the archive cutoff', () => {
    const result = buildOrdersWindowFilter({
      includeStale: false,
      now: NOW,
    });
    expect(result.createdAt).toBeUndefined();
    expect(result.archiveCutoff).toEqual(computeArchiveCutoff(NOW, DEFAULT_ARCHIVE_WINDOW_DAYS));
  });

  it('includeStale=false with only dateFrom applies gte without lte', () => {
    const result = buildOrdersWindowFilter({
      includeStale: false,
      dateFrom: '2026-03-25',
      now: NOW,
    });
    expect(result.createdAt?.gte).toEqual(new Date('2026-03-25'));
    expect(result.createdAt?.lte).toBeUndefined();
    expect(result.archiveCutoff).toBeDefined();
  });

  it('includeStale=false with only dateTo applies lte without gte', () => {
    const result = buildOrdersWindowFilter({
      includeStale: false,
      dateTo: '2026-04-24',
      now: NOW,
    });
    expect(result.createdAt?.gte).toBeUndefined();
    expect(result.createdAt?.lte).toEqual(new Date('2026-04-24T23:59:59.999Z'));
    expect(result.archiveCutoff).toBeDefined();
  });

  it('empty-string bounds behave identically to undefined (matches frontend preset="all")', () => {
    // Frontend applyPreset('all') sets dateFrom='' and dateTo='' and
    // includeStale=true. The route receives these as URL params only
    // when truthy, but defensive: even if '' leaks through, treat as
    // "no bound".
    const result = buildOrdersWindowFilter({
      includeStale: true,
      dateFrom: '',
      dateTo: '',
      now: NOW,
    });
    expect(result).toEqual({});
  });

  it('windowDays override propagates to archiveCutoff', () => {
    const result = buildOrdersWindowFilter({
      includeStale: false,
      windowDays: 90,
      now: NOW,
    });
    expect(result.archiveCutoff).toEqual(computeArchiveCutoff(NOW, 90));
  });
});

describe('BUG-ORDERS-ARCHIVE-01-HOTFIX · resolveOrdersDatePreset', () => {
  it('"all" preset clears BOTH date bounds AND sets includeStale=true (owner contract)', () => {
    // Owner verbatim: "'All Time + include_stale=true' must return ALL
    // orders regardless of date window." This gate pins the frontend
    // half of that contract so the preset chip can never regress to
    // leaving stale bounds in place while the toggle is flipped.
    expect(resolveOrdersDatePreset('all', NOW)).toEqual({
      from: '',
      to: '',
      includeStale: true,
    });
  });

  it('"today" preset sets from=to=today with includeStale=false', () => {
    expect(resolveOrdersDatePreset('today', NOW)).toEqual({
      from: '2026-04-24',
      to: '2026-04-24',
      includeStale: false,
    });
  });

  it('"7" / "30" / "90" presets rewind by N days exactly, always includeStale=false', () => {
    expect(resolveOrdersDatePreset('7', NOW).from).toBe('2026-04-17');
    expect(resolveOrdersDatePreset('30', NOW).from).toBe('2026-03-25');
    expect(resolveOrdersDatePreset('90', NOW).from).toBe('2026-01-24');
    for (const p of ['7', '30', '90'] as const) {
      expect(resolveOrdersDatePreset(p, NOW).includeStale).toBe(false);
      expect(resolveOrdersDatePreset(p, NOW).to).toBe('2026-04-24');
    }
  });

  it('"year" preset anchors from to Jan 1 of the current year', () => {
    expect(resolveOrdersDatePreset('year', NOW)).toEqual({
      from: '2026-01-01',
      to: '2026-04-24',
      includeStale: false,
    });
  });

  it('only "all" sets includeStale=true; every other preset leaves it false', () => {
    const presets = ['today', '7', '30', '90', 'year', 'all'] as const;
    for (const p of presets) {
      expect(resolveOrdersDatePreset(p, NOW).includeStale).toBe(p === 'all');
    }
  });
});
