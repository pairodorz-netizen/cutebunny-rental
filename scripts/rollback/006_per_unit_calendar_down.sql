-- FEAT-302 ROLLBACK: Remove per-unit calendar changes
-- Reverses migration 006
-- ADR: docs/adr/003-unit-index-on-availability-calendar.md
--
-- IMPORTANT: This rollback contains DROP INDEX CONCURRENTLY which CANNOT
-- run inside a transaction block. Run each step sequentially in Supabase
-- SQL Editor or via psql with no explicit BEGIN/COMMIT wrapper.

-- Step 1: Clean up multi-unit rows BEFORE reverting constraint.
-- When unit_index > 1, these rows were added by the new feature.
-- Deleting them prevents unique violations when restoring the old
-- constraint (product_id, calendar_date) which has no unit_index.
DELETE FROM availability_calendar WHERE unit_index > 1;

-- Step 2: Drop new unique constraint (detaches backing index)
ALTER TABLE availability_calendar DROP CONSTRAINT IF EXISTS product_date_unit_unique;

-- Step 3: Drop the backing index CONCURRENTLY (no write block)
DROP INDEX CONCURRENTLY IF EXISTS product_date_unit_unique_idx;

-- Step 4: Remove unit_index column
ALTER TABLE availability_calendar DROP COLUMN IF EXISTS unit_index;

-- Step 5: Restore original unique constraint
ALTER TABLE availability_calendar ADD CONSTRAINT product_date_unique UNIQUE (product_id, calendar_date);
