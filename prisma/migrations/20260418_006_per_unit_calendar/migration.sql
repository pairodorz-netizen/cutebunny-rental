-- FEAT-302: Per-Unit Calendar Navigation
-- Add unit_index to availability_calendar for per-unit filtering
-- Reversible: see scripts/rollback/006_per_unit_calendar_down.sql
-- ADR: docs/adr/003-unit-index-on-availability-calendar.md

-- Step 1: Add unit_index column (nullable, 1..stock_on_hand)
ALTER TABLE availability_calendar ADD COLUMN IF NOT EXISTS unit_index INTEGER;

-- Step 2: Backfill unit_index for existing rows
-- Each product's slots get unit_index = 1 (since legacy data has one slot per date)
UPDATE availability_calendar
SET unit_index = 1
WHERE unit_index IS NULL;

-- Step 3: Drop old unique constraint (if exists)
ALTER TABLE availability_calendar DROP CONSTRAINT IF EXISTS product_date_unique;

-- Step 4: Create new unique index CONCURRENTLY to avoid ACCESS EXCLUSIVE lock
-- NOTE: CONCURRENTLY cannot run inside a transaction block.
-- If running via Prisma migrate (which wraps in a transaction), use the
-- manual SQL in the PR description instead.
-- For Supabase SQL Editor (no implicit transaction), this is safe as-is.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS product_date_unit_unique_idx
  ON availability_calendar (product_id, calendar_date, unit_index);

-- Step 5: Attach the index as a table constraint
ALTER TABLE availability_calendar
  ADD CONSTRAINT product_date_unit_unique
  UNIQUE USING INDEX product_date_unit_unique_idx;
