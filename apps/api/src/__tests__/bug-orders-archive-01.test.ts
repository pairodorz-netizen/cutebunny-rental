// BUG-ORDERS-ARCHIVE-01 — RED gates for the 30-day archive window.
//
// Tests a pure logic module that decides whether a given order row
// should be hidden from the default /orders view. Policy:
//
//   1. Active statuses (anything NOT in {finished, cancelled}) are ALWAYS
//      visible, regardless of `updatedAt` age. Never hide work-in-progress.
//
//   2. Archived-eligible statuses (finished / cancelled) are hidden when
//      `updatedAt < now() - windowDays*86400000`. Boundary is inclusive at
//      the cutoff moment: an order whose updatedAt equals the cutoff is
//      still visible.
//
// This module also owns the pagination shape the admin list returns so
// the frontend can consume a stable `{total_pages, has_more}` contract.
//
// Gates fail at module-resolution time until
// `packages/shared/src/orders-archive-window.ts` exists.

import { describe, it, expect } from 'vitest';
import {
  ARCHIVED_STATUSES,
  computeArchiveCutoff,
  isArchived,
  applyArchiveFilter,
  computePagination,
  type ArchivableOrder,
} from '@cutebunny/shared/orders-archive-window';

const NOW = new Date('2026-04-20T12:00:00.000Z');
const CUTOFF = computeArchiveCutoff(NOW, 30);

function mkOrder(
  status: ArchivableOrder['status'],
  updatedAt: Date,
  id = 'o-' + status + '-' + updatedAt.toISOString(),
): ArchivableOrder & { id: string } {
  return { id, status, updatedAt };
}

describe('BUG-ORDERS-ARCHIVE-01 · pure archive-window classifier', () => {
  it('ARCHIVED_STATUSES freezes the enum subset subject to archive', () => {
    expect([...ARCHIVED_STATUSES].sort()).toEqual(['cancelled', 'finished']);
  });

  it('computeArchiveCutoff subtracts exactly windowDays*86_400_000 ms', () => {
    const cutoff = computeArchiveCutoff(NOW, 30);
    const delta = NOW.getTime() - cutoff.getTime();
    expect(delta).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it('computeArchiveCutoff throws on non-finite / negative windowDays', () => {
    expect(() => computeArchiveCutoff(NOW, -1)).toThrow();
    expect(() => computeArchiveCutoff(NOW, Number.NaN)).toThrow();
    expect(() => computeArchiveCutoff(NOW, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('isArchived returns true for finished + updatedAt strictly before cutoff', () => {
    const old = new Date(CUTOFF.getTime() - 1);
    expect(isArchived(mkOrder('finished', old), CUTOFF)).toBe(true);
  });

  it('isArchived returns false for finished + updatedAt just after cutoff', () => {
    const recent = new Date(CUTOFF.getTime() + 1);
    expect(isArchived(mkOrder('finished', recent), CUTOFF)).toBe(false);
  });

  it('isArchived treats cutoff exactly as inclusive (>= cutoff stays visible)', () => {
    const exact = new Date(CUTOFF.getTime());
    expect(isArchived(mkOrder('finished', exact), CUTOFF)).toBe(false);
  });

  it('isArchived returns true for cancelled orders past the cutoff', () => {
    const ancient = new Date('2024-01-01T00:00:00.000Z');
    expect(isArchived(mkOrder('cancelled', ancient), CUTOFF)).toBe(true);
  });

  it('isArchived returns false for any ACTIVE status, even ancient', () => {
    const ancient = new Date('2024-01-01T00:00:00.000Z');
    for (const active of [
      'unpaid',
      'paid_locked',
      'shipped',
      'returned',
      'cleaning',
      'repair',
    ] as const) {
      expect(isArchived(mkOrder(active, ancient), CUTOFF)).toBe(false);
    }
  });

  it('isArchived tolerates ISO-string updatedAt (API hydration path)', () => {
    const old = new Date(CUTOFF.getTime() - 1).toISOString();
    expect(
      isArchived(
        { id: 'o1', status: 'finished', updatedAt: old },
        CUTOFF,
      ),
    ).toBe(true);
  });

  it('applyArchiveFilter hides stale finished/cancelled but keeps actives + recent', () => {
    const ancient = new Date(CUTOFF.getTime() - 86_400_000);
    const recent = new Date(CUTOFF.getTime() + 86_400_000);
    const rows = [
      mkOrder('finished', ancient, 'stale-finished'),
      mkOrder('finished', recent, 'recent-finished'),
      mkOrder('cancelled', ancient, 'stale-cancelled'),
      mkOrder('cancelled', recent, 'recent-cancelled'),
      mkOrder('shipped', ancient, 'ancient-shipped'),
      mkOrder('unpaid', recent, 'recent-unpaid'),
    ];
    const visible = applyArchiveFilter(rows, { cutoff: CUTOFF });
    expect(visible.map((r) => r.id).sort()).toEqual(
      ['ancient-shipped', 'recent-cancelled', 'recent-finished', 'recent-unpaid'].sort(),
    );
  });

  it('applyArchiveFilter is a no-op when includeStale=true', () => {
    const ancient = new Date(CUTOFF.getTime() - 86_400_000);
    const rows = [
      mkOrder('finished', ancient, 'stale-finished'),
      mkOrder('cancelled', ancient, 'stale-cancelled'),
    ];
    const visible = applyArchiveFilter(rows, { cutoff: CUTOFF, includeStale: true });
    expect(visible).toEqual(rows);
  });

  it('computePagination handles exact-page boundary without reporting hasMore', () => {
    expect(computePagination({ total: 50, page: 1, pageSize: 50 })).toEqual({
      totalPages: 1,
      hasMore: false,
    });
  });

  it('computePagination reports hasMore when total > page*pageSize', () => {
    expect(computePagination({ total: 60, page: 1, pageSize: 50 })).toEqual({
      totalPages: 2,
      hasMore: true,
    });
  });

  it('computePagination reports hasMore=false on the last page', () => {
    expect(computePagination({ total: 150, page: 3, pageSize: 50 })).toEqual({
      totalPages: 3,
      hasMore: false,
    });
  });

  it('computePagination returns zero pages / no more for empty result', () => {
    expect(computePagination({ total: 0, page: 1, pageSize: 50 })).toEqual({
      totalPages: 0,
      hasMore: false,
    });
  });
});
