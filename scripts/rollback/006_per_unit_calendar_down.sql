-- FEAT-302 ROLLBACK: Remove per-unit calendar changes
-- Reverses migration 006
-- ADR: docs/adr/003-unit-index-on-availability-calendar.md

BEGIN;

-- Step 1: Clean up multi-unit rows BEFORE reverting constraint.
-- When unit_index > 1, these rows were added by the new feature.
-- Deleting them prevents unique violations when restoring the old
-- constraint (product_id, calendar_date) which has no unit_index.
DELETE FROM availability_calendar WHERE unit_index > 1;

-- Step 2: Drop new unique constraint + backing index
ALTER TABLE availability_calendar DROP CONSTRAINT IF EXISTS product_date_unit_unique;
DROP INDEX CONCURRENTLY IF EXISTS product_date_unit_unique_idx;

-- Step 3: Remove unit_index column
ALTER TABLE availability_calendar DROP COLUMN IF EXISTS unit_index;

-- Step 4: Restore original unique constraint
ALTER TABLE availability_calendar ADD CONSTRAINT product_date_unique UNIQUE (product_id, calendar_date);

COMMIT;

-- NOTE: DROP INDEX CONCURRENTLY cannot run inside a transaction block.
-- If Postgres rejects the CONCURRENTLY inside BEGIN/COMMIT, split into
-- two steps:
--   1. Run everything except DROP INDEX CONCURRENTLY inside BEGIN/COMMIT.
--   2. Run DROP INDEX CONCURRENTLY separately outside any transaction.
-- The constraint drop in Step 2 will detach the index; the CONCURRENTLY
-- drop just cleans it up. If omitted, the index remains as a regular
-- (non-unique) index — harmless but wastes space.
