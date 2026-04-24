/**
 * BUG-ORDERS-ARCHIVE-01-COUNT-PARITY-HOTFIX — query-key consistency gates.
 *
 * Root cause of the P0 regression: after PR #81 added a dedicated
 * `/counts` endpoint with `useQuery({ queryKey: ['admin-orders-counts', …] })`,
 * seven `invalidateQueries` call-sites in orders.tsx still referenced the
 * OLD key `'admin-orders-count'` (missing trailing `s`). React-Query
 * prefix-matching is array-element-based, so `['admin-orders-count']` does
 * NOT match `['admin-orders-counts', …]`. Result: after any mutation
 * (status change, payment verify, order create, item add/remove) the
 * counts cache was never refreshed and badges stuck at their stale values
 * (typically 0 from initial mount before data arrives).
 *
 * Gate 1 — CONSTANT VALUE: the shared constant has the expected value.
 * Gate 2 — SOURCE SCAN: orders.tsx uses ONLY the correct key string in
 *          every invalidateQueries call targeting the counts cache.
 * Gate 3 — USEQUERY CONSISTENT: the useQuery queryKey uses the same
 *          string as the invalidation calls.
 * Gate 4 — NO ORPHAN KEYS: no occurrence of 'admin-orders-count' (exact,
 *          without trailing 's') appears in orders.tsx.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  ADMIN_ORDERS_COUNTS_QUERY_KEY,
  ADMIN_ORDERS_LIST_QUERY_KEY,
  ADMIN_ORDER_DETAIL_QUERY_KEY,
  deriveStatusCounts,
} from '@cutebunny/shared/admin-orders-query-keys';

const STATUSES = [
  'unpaid',
  'paid_locked',
  'shipped',
  'returned',
  'cleaning',
  'repair',
  'finished',
  'cancelled',
] as const;

const ORDERS_TSX_PATH = path.resolve(
  __dirname,
  '../../../../apps/admin/src/pages/orders.tsx',
);

function readOrdersTsx(): string {
  return fs.readFileSync(ORDERS_TSX_PATH, 'utf-8');
}

describe('BUG-ORDERS-ARCHIVE-01-COUNT-PARITY-HOTFIX — query-key consistency', () => {
  describe('shared constants', () => {
    it('ADMIN_ORDERS_COUNTS_QUERY_KEY has the correct value', () => {
      expect(ADMIN_ORDERS_COUNTS_QUERY_KEY).toBe('admin-orders-counts');
    });

    it('ADMIN_ORDERS_LIST_QUERY_KEY has the correct value', () => {
      expect(ADMIN_ORDERS_LIST_QUERY_KEY).toBe('admin-orders');
    });

    it('ADMIN_ORDER_DETAIL_QUERY_KEY has the correct value', () => {
      expect(ADMIN_ORDER_DETAIL_QUERY_KEY).toBe('admin-order-detail');
    });
  });

  describe('orders.tsx source scan', () => {
    it('imports the shared query-key constants', () => {
      const src = readOrdersTsx();
      expect(src).toContain('ADMIN_ORDERS_COUNTS_QUERY_KEY');
      expect(src).toContain('@cutebunny/shared/admin-orders-query-keys');
    });

    it('uses the constant in useQuery queryKey (not a raw string)', () => {
      const src = readOrdersTsx();
      // The useQuery call must reference the constant, not a string literal
      expect(src).toMatch(/queryKey:\s*\[\s*ADMIN_ORDERS_COUNTS_QUERY_KEY/);
    });

    it('every invalidateQueries targeting counts uses the constant', () => {
      const src = readOrdersTsx();
      // Find all invalidateQueries lines that mention "count" in the key
      const invalidateLines = src
        .split('\n')
        .filter(
          (line) =>
            line.includes('invalidateQueries') &&
            (line.includes('count') || line.includes('COUNT')),
        );
      expect(invalidateLines.length).toBeGreaterThanOrEqual(7);
      for (const line of invalidateLines) {
        expect(line).toContain('ADMIN_ORDERS_COUNTS_QUERY_KEY');
        // Must NOT contain the raw string literal (typo or not)
        expect(line).not.toMatch(/['"]admin-orders-count/);
      }
    });

    it('has NO orphan "admin-orders-count" string literal (missing trailing s)', () => {
      const src = readOrdersTsx();
      // Match the exact string 'admin-orders-count' that is NOT followed by 's'
      // This catches both single and double quoted variants
      const orphanPattern = /['"]admin-orders-count(?!s)['"\]]/g;
      const matches = src.match(orphanPattern);
      expect(matches).toBeNull();
    });

    it('has NO raw string "admin-orders-counts" (must use constant)', () => {
      const src = readOrdersTsx();
      // The string literal should only appear in import/comment, not in code
      const codeLines = src
        .split('\n')
        .filter(
          (line) =>
            line.includes("'admin-orders-counts'") ||
            line.includes('"admin-orders-counts"'),
        )
        .filter(
          (line) =>
            !line.trimStart().startsWith('//') &&
            !line.trimStart().startsWith('*') &&
            !line.trimStart().startsWith('import'),
        );
      expect(codeLines).toHaveLength(0);
    });
  });

  describe('deriveStatusCounts — belt-and-suspenders fallback', () => {
    it('trusts /counts response when present (happy path)', () => {
      const { statusCounts, totalCount } = deriveStatusCounts({
        statuses: STATUSES,
        statusFilter: '',
        countsByStatus: { finished: 2, unpaid: 1 },
        listTotal: 3,
      });
      expect(statusCounts.finished).toBe(2);
      expect(statusCounts.unpaid).toBe(1);
      expect(statusCounts.shipped).toBe(0);
      expect(totalCount).toBe(3); // 2 + 1
    });

    it('falls back to listTotal for the currently filtered tab when counts is undefined', () => {
      const { statusCounts, totalCount } = deriveStatusCounts({
        statuses: STATUSES,
        statusFilter: 'finished',
        countsByStatus: undefined,
        listTotal: 2,
      });
      expect(statusCounts.finished).toBe(2);
      expect(statusCounts.unpaid).toBe(0);
      expect(totalCount).toBe(2);
    });

    it('keeps non-active tabs at 0 when counts is undefined (no data to derive)', () => {
      const { statusCounts } = deriveStatusCounts({
        statuses: STATUSES,
        statusFilter: 'finished',
        countsByStatus: undefined,
        listTotal: 2,
      });
      for (const s of STATUSES) {
        if (s !== 'finished') expect(statusCounts[s]).toBe(0);
      }
    });

    it('returns totalCount = 0 when both counts and listTotal are undefined', () => {
      const { statusCounts, totalCount } = deriveStatusCounts({
        statuses: STATUSES,
        statusFilter: '',
        countsByStatus: undefined,
        listTotal: undefined,
      });
      expect(totalCount).toBe(0);
      for (const s of STATUSES) {
        expect(statusCounts[s]).toBe(0);
      }
    });

    it('treats empty counts object as "unavailable" and falls back for active tab (P0 regression path)', () => {
      // Reproduces the observed regression shape: /counts returned
      // { total: 0, by_status: {} } even though listData had rows.
      // Empty `by_status` is indistinguishable from "query hasn't
      // resolved yet" — so we fall back the same way as undefined.
      const { statusCounts, totalCount } = deriveStatusCounts({
        statuses: STATUSES,
        statusFilter: 'finished',
        countsByStatus: {},
        listTotal: 2,
      });
      expect(statusCounts.finished).toBe(2);
      expect(statusCounts.unpaid).toBe(0);
      expect(totalCount).toBe(2);
    });

    it('derives totalCount from sum of counts when available (not a separate field)', () => {
      const { totalCount } = deriveStatusCounts({
        statuses: STATUSES,
        statusFilter: '',
        countsByStatus: { unpaid: 3, finished: 2, cancelled: 5 },
        listTotal: 0,
      });
      expect(totalCount).toBe(10);
    });
  });
});
