# ADR-003: Add unit_index to availability_calendar

**Status:** Accepted  
**Date:** 2026-04-18  
**Authors:** Devin AI, Qew Cut Clip  
**Supersedes:** spec-stock-v3.0.0 §3.1 (Option A selected)  
**Spec version:** spec-stock-v3.1.0  
**Related:** FEAT-302 (Per-Unit Calendar Navigation), BUG-301 (Stock Log Dedup)

## Context

CuteBunny Rental manages dress inventory where a single product (e.g., "Ivory Lace Bridal Gown") can have multiple physical units (`stock_on_hand = N`). The admin needs to view calendar availability **per unit** — for example, Unit 1 is booked May 1–3 but Unit 2 is free — so they can make informed rental decisions.

Before this change, `availability_calendar` had a unique constraint on `(product_id, calendar_date)`, meaning only **one** availability slot existed per product per day. This made it impossible to track per-unit booking status.

spec-stock-v3.0.0 §3.1 proposed two options:
- **Option A:** Add `unit_index` column to `availability_calendar` (chosen)
- **Option B:** Create a new `order_items` or `booking_units` join table

## Decision

Add an `INTEGER` column `unit_index` (1-based, nullable) to `availability_calendar` and change the unique constraint from `(product_id, calendar_date)` to `(product_id, calendar_date, unit_index)`.

### Why unit_index on availability_calendar (not order_items)?

We evaluated three alternatives per spec §3.1:

1. **Option B: New `order_items` / `booking_units` join table** — Would require a significant schema refactor: new table, new API endpoints, migration of existing booking logic, and changes to the order flow. This is a higher-complexity path for a feature that only needs to partition existing calendar slots by unit. The calendar already stores per-day availability; adding a unit dimension to the same table is the minimal extension.

2. **Denormalize into a JSON column on `availability_calendar`** — Loses queryability. Cannot enforce uniqueness or filter by unit in SQL. Makes aggregated views harder. Violates the existing relational pattern of the schema.

3. **Option A: Add `unit_index` to existing `availability_calendar` table (chosen)** — Minimal schema change (one column + constraint). Backward-compatible: existing rows get `unit_index = 1` via backfill. The calendar API already queries this table; adding `WHERE unit_index = ?` is trivial. Aggregated "all units" view computes in the API layer (green if ANY unit is free on a given day).

### Rationale for choosing Option A over Option B

- **Incremental change:** One column addition vs. an entirely new table with FK relationships
- **No booking flow changes:** The order creation flow does not need to be modified; unit assignment happens at the calendar level
- **Rollback simplicity:** Delete multi-unit rows, drop column, restore old constraint — no data migration between tables required
- **Query performance:** Single-table queries with an index are faster than joins across a booking_units table

## Tradeoffs Accepted

- **Pro:** Single-column addition, no new tables, backward-compatible backfill.
- **Pro:** Unique constraint prevents double-booking the same unit on the same day.
- **Pro:** Rollback is straightforward: delete multi-unit rows, drop column, restore old constraint.
- **Con:** Table row count grows linearly with `stock_on_hand` (N rows per product per day instead of 1). For typical rental inventory (20–200 products, 30-day window), this is ~6,000 rows max — negligible.
- **Con:** `unit_index` is an integer position, not a foreign key to `inventory_units.id`. This keeps the migration simple but means the calendar doesn't enforce referential integrity to specific unit records. The API layer validates unit bounds at query time (`UNIT_OUT_OF_RANGE` error for out-of-bounds values).
- **Con:** If unit semantics become richer (e.g., unit-specific metadata affecting availability), a dedicated join table may become necessary. This ADR accepts that as future work.

## Migration Strategy

- **Forward (5 steps, no transaction wrapper):**
  1. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS unit_index INTEGER` (instant DDL)
  2. `UPDATE ... SET unit_index = 1 WHERE unit_index IS NULL` (row-level locks only)
  3. `CREATE UNIQUE INDEX CONCURRENTLY ... product_date_unit_unique_idx` (SHARE UPDATE EXCLUSIVE — no write block)
  4. `ADD CONSTRAINT ... UNIQUE USING INDEX` with idempotent DO $$ guard (~2ms exclusive lock)
  5. `DROP CONSTRAINT IF EXISTS product_date_unique` (instant DDL)
- **Tested on 100k rows:** ~10ms total exclusive lock time. Writes are NOT blocked during index creation.
- **Cannot run inside a transaction** due to `CONCURRENTLY`. Must run via Supabase SQL Editor or psql directly.
- **Rollback:** Delete rows where `unit_index > 1`, drop constraint, drop index concurrently, drop column, restore old constraint. See `scripts/rollback/006_per_unit_calendar_down.sql`.

## Consequences

- Calendar API now accepts `?unit=all|1|2|...` parameter with validation (`UNIT_OUT_OF_RANGE`, `VALIDATION_ERROR` for invalid input).
- "All" view aggregates across units (available if ANY unit is free).
- UI adds chevron navigation to cycle through units.
- `product_date_unique` constraint is replaced by `product_date_unit_unique`.
- Future work: if per-unit booking becomes more complex, consider promoting `unit_index` to a proper FK relationship with `inventory_units`.
