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
