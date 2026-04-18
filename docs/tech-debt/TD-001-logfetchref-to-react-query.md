# TD-001: Migrate logFetchRef to React Query

**Status:** Open  
**Priority:** Low  
**Created:** 2026-04-18  
**Component:** `apps/admin/src/pages/product-detail.tsx`

## Problem

The stock log fetching in `ProductDetailPage` uses a manual `useRef` generation counter (`logFetchRef`) to guard against concurrent/duplicate fetches (BUG-301 fix). This works but is fragile:

- Manual dedup via `Map<string, StockLog>` on every state update
- Manual cursor tracking (`logCursor`, `hasMoreLogs`)
- Manual `useEffect` with setTimeout for initial load
- Manual `IntersectionObserver` for infinite scroll
- No cache invalidation, stale-while-revalidate, or background refetch

## Proposed Solution

Replace the entire stock log fetching mechanism with `@tanstack/react-query`'s `useInfiniteQuery`:

```typescript
const {
  data: logsData,
  fetchNextPage,
  hasNextPage,
  isFetchingNextPage,
} = useInfiniteQuery({
  queryKey: ['stock-logs', id, logTypeFilter, logDateFrom, logDateTo],
  queryFn: ({ pageParam }) =>
    adminApi.products.stockLogs(id!, {
      limit: '20',
      ...(pageParam ? { cursor: pageParam } : {}),
      ...(logTypeFilter ? { type: logTypeFilter } : {}),
      ...(logDateFrom ? { date_from: logDateFrom } : {}),
      ...(logDateTo ? { date_to: logDateTo } : {}),
    }),
  getNextPageParam: (lastPage) =>
    lastPage.meta?.has_more ? lastPage.meta.cursor : undefined,
  enabled: !!id,
});
```

### Benefits
- Automatic dedup (React Query deduplicates by query key)
- Built-in stale-while-revalidate
- No manual generation counter needed
- Simpler infinite scroll with `fetchNextPage` + `hasNextPage`
- Cache invalidation via `queryClient.invalidateQueries(['stock-logs', id])`

### Files to Change
- `apps/admin/src/pages/product-detail.tsx` — replace manual fetch with `useInfiniteQuery`
- Remove: `logFetchRef`, `allStockLogs` state, `logCursor` state, `hasMoreLogs` state, `isLoadingLogs` state, `loadStockLogs` callback, the `useEffect` with generation counter, the `IntersectionObserver` useEffect

### Risk
Low — purely frontend refactor, no API changes needed. The `useInfiniteQuery` approach is already used elsewhere in the app (`@tanstack/react-query` is a dependency).

## Acceptance Criteria
- [ ] Stock logs load correctly on page load
- [ ] Infinite scroll works (load more on scroll)
- [ ] Filters (type, date range) trigger refetch
- [ ] After Add Stock, logs invalidate and refetch (no duplicates)
- [ ] No `logFetchRef` or manual dedup code remains
