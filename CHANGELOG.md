# Changelog

## [Unreleased] — 2026-05-13

### Fixed — BUG-536, 537 (finance deposit accounting + rental count consistency)
- **BUG-537**: `deposit_returned` was incorrectly classified as an expense, inflating Total Expenses (4,140 THB) and distorting Net Profit. Fix: deposit types (`deposit_received`, `deposit_returned`) are now separated from revenue/expense categories as `DEPOSIT` type with dedicated `deposit_received`, `deposit_returned`, `net_deposit` fields in summary/report responses.
- **BUG-536**: Finance Top Products rental count (2) didn't match Dashboard Top Products (1) for Bohemian Maxi Dress. Root cause: Finance counted `financeTransaction` rows per product, Dashboard counted `order_items` via `getProductRentalCounts()`. Fix: Finance summary now uses the same `getProductRentalCounts()` shared helper for rental counts, keeping revenue calculation from finance transactions.

### Fixed — BUG-532, 533, 534, 535 (aggregator polish)
- **BUG-532/534/535**: Dashboard Top Products showed 0 rentals — two root causes: (1) `PAID_STATUSES` included `'ready'` which is not a valid `OrderStatus` enum value, causing Prisma validation errors silently caught by try/catch; (2) PrismaNeon adapter on Cloudflare Workers doesn't reliably support Prisma query builder patterns (groupBy, findMany with nested relation filters, nested selects). Fix: removed invalid `'ready'` from `PAID_STATUSES` and switched `getProductRentalCounts()` to raw SQL via `$queryRaw`.
- **BUG-533**: Per-product ROI endpoint (`/:id/roi`) formula aligned with `/roi/summary` — now subtracts `totalExpenses` before dividing by `purchaseCost`.

### Fixed — BUG-521..528, 530, 531

#### Group A: Rental-count + finance aggregation
- **BUG-521**: Finance Transactions now shows `deposit_returned` as negative amount (outflow) and excludes it from Total Revenue; included in Total Expenses in summary/report endpoints.
- **BUG-523**: Finance Categories tab falls back to aggregated `finance_transaction` rows grouped by `txType` when `financeCategory` table is empty.
- **BUG-525**: ROI Rankings Net Profit formula changed to `TotalRevenue − TotalExpenses − PurchaseCost` to be consistent with ROI% sign.
- **BUG-526**: Dashboard Top Products widget now computes rental counts from actual `order_items` (paid statuses) instead of the stale `products.rental_count` column.
- **BUG-528**: Products list `Rentals` column and Customers list `Rentals`/`Total Payment` columns now use actual order-based aggregation via shared `rental-stats` helper.

#### Group B: Soft-deleted filter + minor UI
- **BUG-522**: Finance Transactions `Category` column now falls back to a formatted `txType` label (e.g. "Deposit Returned") when `categoryName` is null.
- **BUG-524**: ROI Rankings query now filters `deletedAt: null` to exclude soft-deleted products.
- **BUG-527**: Admin `/dashboard` route now renders the Dashboard page instead of blank.

#### Group C: Customer-facing UX
- **BUG-530**: Customer home page Popular section (`sort=popular`) now orders by `rentalCount` desc; New Arrivals (`sort=newest`) orders by `createdAt` desc.
- **BUG-531**: Categories endpoint filters out categories with 0 active (non-deleted) products for frontend display.

### Added
- `apps/api/src/lib/rental-stats.ts` — shared helpers `getProductRentalCounts()` and `getCustomerRentalStats()` for unified rental aggregation across all admin endpoints.
- New test files: `bug-521-deposit-returned-sign.test.ts`, `bug-525-roi-sign-consistency.test.ts`, `bug-526-528-rental-count-parity.test.ts`.
- Updated `bug-516-top-products-filter.test.ts` to match new query shape (BUG-526 refactor).
