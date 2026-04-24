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
  /**
   * Per-status breakdown of the currently-rendered rows. Used as a
   * fourth floor (hotfix-4): any tab's badge is guaranteed to be at
   * least the number of rows of that status the user can actually
   * see, regardless of what `/counts` reports for that bucket. Fixes
   * the case where the active tab is "All Statuses" and the Finished
   * tab's badge would otherwise trust `/counts` verbatim even though
   * Finished rows are visibly rendered.
   */
  visibleRowCountsByStatus?: Record<string, number>;
  /**
   * hotfix-5: the raw list-query array the render path consumes. If
   * provided, the helper does its own per-status groupBy here so the
   * caller cannot accidentally pass an empty `visibleRowCountsByStatus`
   * due to wire-shape drift. When `countsByStatus` looks meaningful
   * but sums to 0 AND `ordersSource.length > 0`, the helper ignores
   * `/counts` entirely and treats the client-side groupBy as the sole
   * source of truth — defensive against an all-zeros `/counts` bucket
   * (stale cache, archive-cutoff mis-applied, wire drift, …).
   *
   * Takes precedence over a provided `visibleRowCountsByStatus` when
   * both are passed (the live groupBy is always fresher than any
   * pre-computed map).
   */
  ordersSource?: ReadonlyArray<{ status: string }>;
}): { statusCounts: Record<string, number>; totalCount: number } {
  // Treat `undefined`, `null`, AND an empty object as "counts
  // unavailable". Null emerged as a wire-shape edge case (see the
  // hotfix-3 test suite); Object.keys(null) would otherwise throw.
  let countsAvailable =
    input.countsByStatus !== undefined &&
    input.countsByStatus !== null &&
    Object.keys(input.countsByStatus).length > 0;
  const listTotalSafe = input.listTotal ?? 0;
  const visibleRowCountSafe = input.visibleRowCount ?? 0;
  // hotfix-5: derive the per-status map from the raw array when
  // provided. Wins over any pre-computed map the caller passed.
  const groupedFromSource: Record<string, number> = {};
  if (input.ordersSource && Array.isArray(input.ordersSource)) {
    for (const o of input.ordersSource) {
      if (!o || typeof o.status !== 'string') continue;
      groupedFromSource[o.status] = (groupedFromSource[o.status] ?? 0) + 1;
    }
  }
  const sourceHasRows = Object.keys(groupedFromSource).length > 0;
  const visibleByStatus: Record<string, number> = sourceHasRows
    ? groupedFromSource
    : input.visibleRowCountsByStatus ?? {};
  // hotfix-5: when `/counts` is present but every bucket is 0 AND the
  // client has visible rows, treat `/counts` as unavailable. This is
  // the scenario the owner's production smoke kept hitting after
  // hotfix-4: a stale `/counts` bucket was silently overriding the
  // live groupBy floor because `visibleRowCountsByStatus` was being
  // passed in empty from the component (wire-shape drift).
  if (countsAvailable && sourceHasRows) {
    const countsTotal = Object.values(
      input.countsByStatus as Record<string, number>,
    ).reduce((acc, n) => acc + (n ?? 0), 0);
    if (countsTotal === 0) {
      countsAvailable = false;
    }
  }
  // Floor applied to the active tab and to the All-Statuses total.
  const activeFloor = Math.max(listTotalSafe, visibleRowCountSafe);
  const statusCounts: Record<string, number> = {};
  for (const s of input.statuses) {
    const fromCounts = countsAvailable
      ? input.countsByStatus?.[s]
      : undefined;
    const perStatusFloor = visibleByStatus[s] ?? 0;
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
    // Invariant 3 (hotfix-4): every tab's badge never smaller than
    // the number of rows of that status visibly rendered. Fixes the
    // case where non-active tab badges stay at 0 despite matching
    // rows being on-screen.
    value = Math.max(value, perStatusFloor);
    statusCounts[s] = value;
  }
  const totalFromCounts = countsAvailable
    ? Object.values(input.countsByStatus as Record<string, number>).reduce(
        (acc, n) => acc + n,
        0,
      )
    : undefined;
  const baseTotal = totalFromCounts ?? activeFloor;
  // Invariant 2: All Statuses badge never smaller than the floor
  // OR the sum of per-status visible-row floors.
  const visibleByStatusSum = Object.values(visibleByStatus).reduce(
    (acc, n) => acc + (n ?? 0),
    0,
  );
  const totalCount = Math.max(baseTotal, activeFloor, visibleByStatusSum);
  return { statusCounts, totalCount };
}
