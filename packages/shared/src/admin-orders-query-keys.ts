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
 * BUG-ORDERS-ARCHIVE-01-COUNT-PARITY-HOTFIX — belt-and-suspenders
 * derivation of the tab-count badge map. Trusts `/counts` first; falls
 * back to the list query's `meta.total` for the currently filtered tab
 * (and for "All Statuses" total) so the user never sees a stale 0
 * badge while rows are visible. Non-active tabs stay at 0 when counts
 * is missing — we have no data to derive them from.
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
  const statusCounts: Record<string, number> = {};
  for (const s of input.statuses) {
    const fromCounts = countsAvailable
      ? input.countsByStatus?.[s]
      : undefined;
    if (fromCounts !== undefined) {
      statusCounts[s] = fromCounts;
    } else if (s === input.statusFilter) {
      statusCounts[s] = input.listTotal ?? 0;
    } else {
      statusCounts[s] = 0;
    }
  }
  const totalFromCounts = countsAvailable
    ? Object.values(input.countsByStatus as Record<string, number>).reduce(
        (acc, n) => acc + n,
        0,
      )
    : undefined;
  const totalCount = totalFromCounts ?? input.listTotal ?? 0;
  return { statusCounts, totalCount };
}
