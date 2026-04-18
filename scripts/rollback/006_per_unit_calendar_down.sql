-- FEAT-302 ROLLBACK: Remove per-unit calendar changes
-- Reverses migration 006

BEGIN;

-- Step 1: Drop new unique constraint
ALTER TABLE availability_calendar DROP CONSTRAINT IF EXISTS product_date_unit_unique;

-- Step 2: Remove unit_index column
ALTER TABLE availability_calendar DROP COLUMN IF EXISTS unit_index;

-- Step 3: Restore original unique constraint
ALTER TABLE availability_calendar ADD CONSTRAINT product_date_unique UNIQUE (product_id, calendar_date);

COMMIT;
