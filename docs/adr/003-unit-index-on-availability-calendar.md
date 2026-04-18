# ADR-003: Add unit_index to availability_calendar

**Status:** Accepted  
**Date:** 2026-04-18  
**Authors:** Devin AI, Qew Cut Clip  
**Related:** FEAT-302 (Per-Unit Calendar Navigation), BUG-301 (Stock Log Dedup)

## Context

CuteBunny Rental manages dress inventory where a single product (e.g., "Ivory Lace Bridal Gown") can have multiple physical units (`stock_on_hand = N`). The admin needs to view calendar availability **per unit** — for example, Unit 1 is booked May 1–3 but Unit 2 is free — so they can make informed rental decisions.

Before this change, `availability_calendar` had a unique constraint on `(product_id, calendar_date)`, meaning only **one** availability slot existed per product per day. This made it impossible to track per-unit booking status.

## Decision

Add an `INTEGER` column `unit_index` (1-based, nullable) to `availability_calendar` and change the unique constraint from `(product_id, calendar_date)` to `(product_id, calendar_date, unit_index)`.

### Why unit_index on availability_calendar (vs. a separate table)?

We considered three alternatives:

1. **New `order_items` or `booking_units` join table** — Would require a significant schema refactor, new API endpoints, and migration of existing booking logic. Higher complexity for a feature that only needs to partition existing calendar slots by unit.

2. **Denormalize into a JSON column** — Loses queryability. Cannot enforce uniqueness or filter by unit in SQL. Makes aggregated views harder.

3. **Add `unit_index` to existing table (chosen)** — Minimal schema change (one column + constraint). Backward-compatible: existing rows get `unit_index = 1`. The calendar API already works with this table; adding a `WHERE unit_index = ?` filter is trivial. Aggregated "all units" view computes in the API layer (green if ANY unit is free).

## Tradeoffs

- **Pro:** Single-column addition, no new tables, backward-compatible backfill.
- **Pro:** Unique constraint prevents double-booking the same unit on the same day.
- **Pro:** Rollback is straightforward: delete multi-unit rows, drop column, restore old constraint.
- **Con:** Table row count grows linearly with `stock_on_hand` (N rows per product per day instead of 1). For typical rental inventory (20–200 products, 30-day window), this is ~6,000 rows max — negligible.
- **Con:** `unit_index` is an integer position, not a foreign key to `inventory_units.id`. This keeps the migration simple but means the calendar doesn't enforce referential integrity to specific unit records. The API layer validates unit bounds at query time.

## Migration Strategy

- **Forward:** `CREATE UNIQUE INDEX CONCURRENTLY` to avoid write-locks on production. Backfill sets `unit_index = 1` for all existing rows.
- **Rollback:** Delete rows where `unit_index > 1` (multi-unit data added by new feature), drop constraint, drop column, restore old `(product_id, calendar_date)` constraint. See `scripts/rollback/006_per_unit_calendar_down.sql`.

## Consequences

- Calendar API now accepts `?unit=all|1|2|...` parameter.
- "All" view aggregates across units (available if ANY unit is free).
- UI adds chevron navigation to cycle through units.
- Future work: if per-unit booking becomes more complex, consider promoting `unit_index` to a proper FK relationship with `inventory_units`.
