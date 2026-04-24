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
 * BUG-ORDERS-ARCHIVE-01-COUNT-PARITY-HOTFIX(-3) — triple-floor
 * derivation of the tab-count badge map.
 *
 * Invariants (contract the UI relies on):
 *   1. The active tab's badge is always >= max(listTotal, visibleRowCount).
 *      User must never see a badge smaller than the rows currently
 *      rendered for that tab.
 *   2. The "All Statuses" total is always >= max(listTotal, visibleRowCount).
 *   3. Non-active tabs trust `/counts` verbatim (0 from counts is a
 *      real 0 when the user is filtered to a different status).
 *
 * History:
 *   - hotfix-1 (PR #82): fixed the query-key typo in the invalidation
 *     chain; added naive `??`-based fallback to listTotal.
 *   - hotfix-2 (PR #83): the `??` operator treats numeric 0 as a
 *     *present value*, so when `/counts` responded with a non-empty
 *     `by_status` summing to 0 the fallback never fired. Switched to
 *     MAX-over-listTotal.
 *   - hotfix-3 (this rev): owner's production smoke STILL showed 0
 *     badges despite the MAX fix, implying listTotal itself was also
 *     unreliable under some cache/race condition. Third floor added:
 *     `visibleRowCount` (= `listData?.data?.length`) is now the
 *     authoritative minimum — if rows are rendered, at least that
 *     many are reflected in the active tab and All-Statuses badges,
 *     irrespective of `/counts` or `meta.total`. Also hardened
 *     against `countsByStatus: null` from the wire, which previously
 *     threw `Object.keys(null)`.
 */
export function deriveStatusCounts(input: {
  statuses: ReadonlyArray<string>;
  statusFilter: string;
  countsByStatus: Record<string, number> | undefined;
  listTotal: number | undefined;
  /**
   * Number of rows actually rendered by the list query. When the
   * caller's list view and the counts endpoint disagree (cache race,
   * stale bucket, wire-shape drift), this is the ground truth: at
   * minimum the user sees N rows, so badges must reflect that.
   * Defaults to 0 (opt-in; hotfix-2 callers remain unchanged).
   */
  visibleRowCount?: number;
}): { statusCounts: Record<string, number>; totalCount: number } {
  // Treat `undefined`, `null`, AND an empty object as "counts
  // unavailable". Null emerged as a wire-shape edge case (see the
  // hotfix-3 test suite); Object.keys(null) would otherwise throw.
  const countsAvailable =
    input.countsByStatus !== undefined &&
    input.countsByStatus !== null &&
    Object.keys(input.countsByStatus).length > 0;
  const listTotalSafe = input.listTotal ?? 0;
  const visibleRowCountSafe = input.visibleRowCount ?? 0;
  // Floor applied to the active tab and to the All-Statuses total.
  const activeFloor = Math.max(listTotalSafe, visibleRowCountSafe);
  const statusCounts: Record<string, number> = {};
  for (const s of input.statuses) {
    const fromCounts = countsAvailable
      ? input.countsByStatus?.[s]
      : undefined;
    let value: number;
    if (fromCounts !== undefined) {
      value = fromCounts;
    } else if (s === input.statusFilter) {
      value = activeFloor;
    } else {
      value = 0;
    }
    // Invariant 1: active tab's badge never smaller than the floor.
    // Applied even when fromCounts is a present numeric value (0),
    // because `/counts` may legitimately stale-bucket the active
    // status while the list query has already refetched.
    if (s === input.statusFilter) {
      value = Math.max(value, activeFloor);
    }
    statusCounts[s] = value;
  }
  const totalFromCounts = countsAvailable
    ? Object.values(input.countsByStatus as Record<string, number>).reduce(
        (acc, n) => acc + n,
        0,
      )
    : undefined;
  const baseTotal = totalFromCounts ?? activeFloor;
  // Invariant 2: All Statuses badge never smaller than the floor.
  const totalCount = Math.max(baseTotal, activeFloor);
  return { statusCounts, totalCount };
}
