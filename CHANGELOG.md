# Changelog

## [Unreleased] — 2026-05-13

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
