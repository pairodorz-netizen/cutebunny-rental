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
