// BUG-ORDERS-ARCHIVE-01-COUNT-PARITY-HOTFIX — single source of truth
// for the admin /orders React-Query keys. Both the list query and the
// tab-count query MUST invalidate using the EXACT same prefix array,
// otherwise mutations (status change, payment-slip verify, order
// create, …) silently leave the counts cache stale and tab badges
// read 0 even when rows are visible. We had 7 sites typo'd as
// `'admin-orders-count'` (missing the trailing `s`), none of which
// matched the live query key `['admin-orders-counts', …]`.
//
// Pinning the constants at the @cutebunny/shared layer makes the
// guarantee testable from the vitest suite and impossible to drift
// without a compile error.

/**
 * Prefix key for the admin /orders list query. The full key includes
 * the per-query params object as a second element.
 */
export const ADMIN_ORDERS_LIST_QUERY_KEY = 'admin-orders' as const;

/**
 * Prefix key for the admin /orders tab-count (groupBy) query. Must
 * match EXACTLY across:
 *   - `useQuery({ queryKey: [ADMIN_ORDERS_COUNTS_QUERY_KEY, params] })`
 *   - every `invalidateQueries({ queryKey: [ADMIN_ORDERS_COUNTS_QUERY_KEY] })`
 */
export const ADMIN_ORDERS_COUNTS_QUERY_KEY = 'admin-orders-counts' as const;

/**
 * Prefix key for the admin order-detail query (single order).
 */
export const ADMIN_ORDER_DETAIL_QUERY_KEY = 'admin-order-detail' as const;

export type AdminOrdersListQueryKey = typeof ADMIN_ORDERS_LIST_QUERY_KEY;
export type AdminOrdersCountsQueryKey = typeof ADMIN_ORDERS_COUNTS_QUERY_KEY;
export type AdminOrderDetailQueryKey = typeof ADMIN_ORDER_DETAIL_QUERY_KEY;

/**
 * BUG-ORDERS-ARCHIVE-01-COUNT-PARITY-HOTFIX(-2) — belt-and-suspenders
 * derivation of the tab-count badge map.
 *
 * Invariants (contract the UI relies on):
 *   1. The active tab's badge is always >= the list query's filtered
 *      `meta.total`. User must never see a badge smaller than the rows
 *      currently rendered for that tab.
 *   2. The "All Statuses" total is always >= the list query's total,
 *      for the same reason.
 *   3. Non-active tabs trust `/counts` verbatim (0 from counts is a
 *      real 0 when the user is filtered to a different status).
 *
 * History:
 *   - hotfix-1 (PR #82): fixed the query-key typo in the invalidation
 *     chain; added naive `??`-based fallback to listTotal.
 *   - hotfix-2 (this module rev): the `??` operator treats numeric 0
 *     as a *present value*, so when `/counts` responded with a
 *     non-empty `by_status` summing to 0 (e.g. `{finished: 0}` from a
 *     stale cache bucket, or a groupBy shape edge case) the fallback
 *     never fired. Switched to MAX-over-listTotal so the list's
 *     observed row count always wins when it's larger than what
 *     `/counts` reports for the current tab.
 */
export function deriveStatusCounts(input: {
  statuses: ReadonlyArray<string>;
  statusFilter: string;
  countsByStatus: Record<string, number> | undefined;
  listTotal: number | undefined;
}): { statusCounts: Record<string, number>; totalCount: number } {
  // Treat `undefined` AND an empty object as "counts unavailable" — the
  // observed P0 regression shipped `{ by_status: {} }` from the wire
  // even though listData had rows. Empty is indistinguishable from
  // "query hasn't resolved yet" from the UI's POV, so we fall back the
  // same way in both cases.
  const countsAvailable =
    input.countsByStatus !== undefined &&
    Object.keys(input.countsByStatus).length > 0;
  const listTotalSafe = input.listTotal ?? 0;
  const statusCounts: Record<string, number> = {};
  for (const s of input.statuses) {
    const fromCounts = countsAvailable
      ? input.countsByStatus?.[s]
      : undefined;
    let value: number;
    if (fromCounts !== undefined) {
      value = fromCounts;
    } else if (s === input.statusFilter) {
      value = listTotalSafe;
    } else {
      value = 0;
    }
    // Invariant 1: active tab's badge never smaller than listTotal.
    // Applied even when fromCounts is a present numeric value (0),
    // because `/counts` may legitimately stale-bucket the active
    // status while the list query has already refetched.
    if (s === input.statusFilter) {
      value = Math.max(value, listTotalSafe);
    }
    statusCounts[s] = value;
  }
  const totalFromCounts = countsAvailable
    ? Object.values(input.countsByStatus as Record<string, number>).reduce(
        (acc, n) => acc + n,
        0,
      )
    : undefined;
  const baseTotal = totalFromCounts ?? listTotalSafe;
  // Invariant 2: All Statuses badge never smaller than listTotal.
  const totalCount = Math.max(baseTotal, listTotalSafe);
  return { statusCounts, totalCount };
}
