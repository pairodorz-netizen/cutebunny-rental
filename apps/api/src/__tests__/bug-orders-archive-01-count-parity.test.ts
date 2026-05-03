// BUG-ORDERS-ARCHIVE-01-COUNT-PARITY — RED gates pinning the single
// source of truth for the admin /orders list WHERE clause, shared
// between the list and the (new) counts endpoints.
//
// Owner-reported regression after PR #80 merged:
//
//   • 'All Time' + 'Show all (incl. archived)' returns both finished
//     orders in the TABLE (data query correct), but the tab-count
//     BADGES all still read 0.
//
// Root cause: the frontend was firing 8 per-status list queries with
// `page_size=1` and summing `meta.total` — an architecture that (a)
// wastes 8 round-trips, (b) makes parallel cache invalidation
// error-prone, and (c) silently shows 0 if any of the 8 parallel
// list calls returns a non-matching shape or misses the cache. Worse,
// the list route's WHERE builder was inlined in the handler so any
// future counts path would have to re-derive it by hand — exactly
// the kind of drift the owner called out.
//
// Fix: extract the WHERE builder into `apps/api/src/lib/orders-query.ts`
// and have BOTH the list route and a new `/counts` route consume it.
// The counts route returns `{ total, by_status: { <status>: N, ... } }`
// in a single `groupBy({ by: ['status'], _count })` pass. Because list
// and counts share the same helper, the owner's contract — "tab
// badges match the filtered row count, always" — is pinned at the
// function level, not the handler level.

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { buildOrdersWhere, buildOrdersCountsWhere } from '../lib/orders-query';
import {
  buildOrdersWindowFilter,
  computeArchiveCutoff,
  DEFAULT_ARCHIVE_WINDOW_DAYS,
} from '@cutebunny/shared/orders-archive-window';

const NOW = new Date('2026-04-24T12:00:00.000Z');

describe('BUG-ORDERS-ARCHIVE-01-COUNT-PARITY · buildOrdersWhere helper', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('include_stale=true with bounds STILL applies createdAt bounds but skips archive cutoff', () => {
    // Rescoped in BUG-ORDERS-DATE-FILTER-01: include_stale=true means
    // "show archived rows within the selected window", not "drop the
    // date filter entirely". Only preset="all" (empty-string bounds)
    // clears the createdAt filter.
    const where = buildOrdersWhere({
      include_stale: 'true',
      from: '2026-03-25',
      to: '2026-04-24',
    });
    expect(where.createdAt).toBeDefined();
    expect((where.createdAt as { gte?: Date; lte?: Date }).gte).toEqual(
      new Date('2026-03-25'),
    );
    expect((where.createdAt as { gte?: Date; lte?: Date }).lte).toEqual(
      new Date('2026-04-24T23:59:59.999Z'),
    );
    // Archive cutoff must still be absent (that's the ONLY thing
    // include_stale=true bypasses under the new contract).
    const conds = (where.AND ?? []) as Array<Record<string, unknown>>;
    const hasCutoff = conds.some((c) =>
      JSON.stringify(c).includes('updatedAt'),
    );
    expect(hasCutoff).toBe(false);
  });

  it('include_stale=true with EMPTY-STRING bounds (preset="all") clears createdAt entirely', () => {
    const where = buildOrdersWhere({
      include_stale: 'true',
      from: '',
      to: '',
    });
    expect(where.createdAt).toBeUndefined();
    const conds = (where.AND ?? []) as Array<Record<string, unknown>>;
    const hasCutoff = conds.some((c) =>
      JSON.stringify(c).includes('updatedAt'),
    );
    expect(hasCutoff).toBe(false);
  });

  it('include_stale=false + both bounds produces createdAt.gte/lte AND archive cutoff condition', () => {
    const where = buildOrdersWhere({
      include_stale: 'false',
      from: '2026-03-25',
      to: '2026-04-24',
    });
    expect(where.createdAt).toEqual(
      buildOrdersWindowFilter({
        includeStale: false,
        dateFrom: '2026-03-25',
        dateTo: '2026-04-24',
        now: NOW,
      }).createdAt,
    );
    // And the archive-cutoff OR condition must be present in where.AND.
    const conds = (where.AND ?? []) as Array<Record<string, unknown>>;
    const cutoffCond = conds.find((c) =>
      JSON.stringify(c).includes('updatedAt'),
    );
    expect(cutoffCond).toBeDefined();
  });

  it('include_stale omitted defaults to false (default archive window applied)', () => {
    const where = buildOrdersWhere({});
    expect(where.createdAt).toBeUndefined(); // no bounds provided
    const conds = (where.AND ?? []) as Array<Record<string, unknown>>;
    const hasCutoff = conds.some((c) =>
      JSON.stringify(c).includes('updatedAt'),
    );
    expect(hasCutoff).toBe(true);
  });

  it('status filter passes through to where.status', () => {
    expect(buildOrdersWhere({ status: 'finished', include_stale: 'true' }).status).toBe('finished');
    expect(buildOrdersWhere({ include_stale: 'true' }).status).toBeUndefined();
  });

  it('legacy date_from / date_to aliases are honored when from/to missing', () => {
    const where = buildOrdersWhere({
      include_stale: 'false',
      date_from: '2026-03-25',
      date_to: '2026-04-24',
    });
    const expected = buildOrdersWindowFilter({
      includeStale: false,
      dateFrom: '2026-03-25',
      dateTo: '2026-04-24',
      now: NOW,
    }).createdAt;
    expect(where.createdAt).toEqual(expected);
  });

  it('search field passthrough: search_sku / search_customer_phone land in where.AND', () => {
    const where = buildOrdersWhere({
      include_stale: 'true',
      search_sku: 'SKU-123',
      search_customer_phone: '089',
    });
    const json = JSON.stringify(where.AND);
    expect(json).toContain('SKU-123');
    expect(json).toContain('089');
  });

  it('empty/undefined values never emit empty AND blocks', () => {
    const where = buildOrdersWhere({
      include_stale: 'true',
      search_sku: '',
      search_product_name: undefined,
    });
    // With include_stale=true there are no automatic AND conditions.
    expect(where.AND).toBeUndefined();
  });

  it('include_stale=1 (numeric truthy) is accepted identically to "true"', () => {
    expect(buildOrdersWhere({ include_stale: '1' }).createdAt).toBeUndefined();
    const conds = (buildOrdersWhere({ include_stale: '1' }).AND ?? []) as Array<Record<string, unknown>>;
    const hasCutoff = conds.some((c) =>
      JSON.stringify(c).includes('updatedAt'),
    );
    expect(hasCutoff).toBe(false);
  });

  describe('buildOrdersCountsWhere · parity with buildOrdersWhere', () => {
    it('ignores the caller-supplied status so the tab bar always sees every bucket', () => {
      const withStatus = buildOrdersCountsWhere({
        status: 'finished',
        include_stale: 'true',
      });
      const withoutStatus = buildOrdersCountsWhere({ include_stale: 'true' });
      expect(withStatus).toEqual(withoutStatus);
      expect(withStatus.status).toBeUndefined();
    });

    it('preserves every other filter — date bounds, search, include_stale', () => {
      const input = {
        from: '2026-03-25',
        to: '2026-04-24',
        include_stale: 'false',
        search_sku: 'SKU-42',
        search_customer_phone: '0899',
      } as const;
      const listWhere = buildOrdersWhere(input);
      const countsWhere = buildOrdersCountsWhere(input);
      // Everything except `.status` must be identical — that's the
      // whole point of sharing the helper.
      const { status: _listStatus, ...listRest } = listWhere;
      const { status: _countsStatus, ...countsRest } = countsWhere;
      void _listStatus;
      void _countsStatus;
      expect(countsRest).toEqual(listRest);
    });

    it('include_stale=true with bounds: list and counts keep createdAt; both drop archive cutoff (BUG-ORDERS-DATE-FILTER-01 rescope)', () => {
      const input = {
        from: '2026-03-25',
        to: '2026-04-24',
        include_stale: 'true',
      } as const;
      const listWhere = buildOrdersWhere(input);
      const countsWhere = buildOrdersCountsWhere(input);
      expect(listWhere.createdAt).toBeDefined();
      expect(countsWhere.createdAt).toBeDefined();
      // Neither may carry an archive-cutoff AND-condition.
      const listConds = (listWhere.AND ?? []) as Array<Record<string, unknown>>;
      const countsConds = (countsWhere.AND ?? []) as Array<Record<string, unknown>>;
      expect(listConds.some((c) => JSON.stringify(c).includes('updatedAt'))).toBe(false);
      expect(countsConds.some((c) => JSON.stringify(c).includes('updatedAt'))).toBe(false);
    });

    it('include_stale=true with empty-string bounds (All Time): list and counts drop everything', () => {
      const input = {
        from: '',
        to: '',
        include_stale: 'true',
      } as const;
      const listWhere = buildOrdersWhere(input);
      const countsWhere = buildOrdersCountsWhere(input);
      expect(listWhere.createdAt).toBeUndefined();
      expect(countsWhere.createdAt).toBeUndefined();
      expect(listWhere.AND).toBeUndefined();
      expect(countsWhere.AND).toBeUndefined();
    });
  });

  it('archive cutoff boundary matches computeArchiveCutoff for DEFAULT window', () => {
    // Lock the math: the archive cutoff condition in where.AND must be
    // the exact boundary the shared helper computes — not a handler-
    // local re-derivation that could drift.
    const where = buildOrdersWhere({ include_stale: 'false' });
    const conds = (where.AND ?? []) as Array<Record<string, unknown>>;
    const cutoffCond = conds.find((c) =>
      JSON.stringify(c).includes('updatedAt'),
    );
    expect(cutoffCond).toBeDefined();
    // We can't pin `now` from here, but we can pin the window length:
    // the cutoff must use DEFAULT_ARCHIVE_WINDOW_DAYS.
    const or = (cutoffCond as { OR: Array<{ updatedAt?: { gte: Date } }> }).OR;
    const gte = or.find((b) => b.updatedAt)?.updatedAt?.gte;
    expect(gte).toBeInstanceOf(Date);
    const nowGuess = Date.now();
    const deltaDays = (nowGuess - (gte as Date).getTime()) / 86_400_000;
    expect(deltaDays).toBeGreaterThan(DEFAULT_ARCHIVE_WINDOW_DAYS - 1);
    expect(deltaDays).toBeLessThan(DEFAULT_ARCHIVE_WINDOW_DAYS + 1);
    // Sanity: matches shared computeArchiveCutoff for "approximately now".
    const expected = computeArchiveCutoff(new Date(nowGuess), DEFAULT_ARCHIVE_WINDOW_DAYS);
    expect(Math.abs((gte as Date).getTime() - expected.getTime())).toBeLessThan(1000);
  });
});
