# Changelog

## [Unreleased] — 2026-05-13

### Fixed — BUG-540, 541 (customer home popular products + hero badge contrast)
- **BUG-541**: Customer home "ชุดยอดนิยมประจำสัปดาห์" showed random products with 0 rentals instead of actual popular ones. Root cause: `sort=popular` used the stale `rentalCount` column (always 0). Fix: when `sort=popular`, uses `getProductRentalCounts()` shared helper for actual rental counts from order_items, sorts in application code, then paginates.
- **BUG-540**: Hero announcement badge had low contrast (~2:1) with pastel gradient background and white text. Fix: darkened gradient stops from `#E8837C/#D4A28A` to `#C0564F/#A67A60` for WCAG AA compliant contrast (4.5:1+).

### Fixed — BUG-538 (order line item thumbnails)
- **BUG-538**: Admin Orders page line items showed placeholder "—" instead of product thumbnails. Root cause: orders endpoint only used `product.thumbnailUrl` (often null) without checking the `images` relation. Fix: orders list and detail endpoints now use `images[0]?.url ?? thumbnailUrl` (same pattern as Products list). Added `loading="lazy"` and graceful fallback placeholder on image error.

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
