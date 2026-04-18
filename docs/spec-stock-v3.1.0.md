# Stock Management Spec v3.1.0

**Supersedes:** spec-stock-v3.0.0  
**Date:** 2026-04-18  
**Status:** In Progress (Wave 4)

## Changes from v3.0.0

### Wave 3 (PR #2 — merged)
- **BUG-301:** Stock log dedup fix — generation counter + Map-based dedup
- **FEAT-302:** Per-unit calendar navigation — `unit_index` on `availability_calendar`
- **ADR-003:** unit_index placement rationale (Option A vs Option B)
- **Migration:** `CREATE UNIQUE INDEX CONCURRENTLY` pattern (ADR-003 §Migration Strategy)

### Wave 4 (this wave)
- **OQ-W3-01:** URL persistence for unit nav — `?unit=` query param survives refresh/share
- **OQ-W3-02:** Calendar cell tooltips — date, status, order reference, unit context
- **API enrichment:** `order_id` field added to calendar day response for tooltip content
- **Tech debt filed:** TD-001 logFetchRef → React Query migration

### Schema changes (v3.1.0)
- `availability_calendar.unit_index` INTEGER (nullable, 1-based)
- Unique constraint: `product_date_unit_unique (product_id, calendar_date, unit_index)`
- No new schema changes in Wave 4 (UI + API enrichment only)

## Remaining DoD (Wave 5+)
- Backfill non-zero stock for active products
- `DELETE /admin/products/:id` → 409 when active rentals
- `stock_on_hand` atomic with log creation
- Stock column red/normal colouring
- DeleteProductDialog blocks active rentals
- AddStockDialog live preview
- Stock History paginated + running balance
- Low Stock Alert uses `available_stock`
- All E2E pass on staging
- `tsc --noEmit` clean
- No order management regression
