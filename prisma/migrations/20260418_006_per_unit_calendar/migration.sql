-- FEAT-302: Per-Unit Calendar Navigation
-- Add unit_index to availability_calendar for per-unit filtering
-- Reversible: see scripts/rollback/006_per_unit_calendar_down.sql
-- ADR: docs/adr/003-unit-index-on-availability-calendar.md
--
-- IMPORTANT: This migration uses CREATE INDEX CONCURRENTLY which CANNOT
-- run inside a transaction block. Do NOT run via `prisma migrate deploy`
-- (which wraps in a transaction). Run each step manually in Supabase SQL
-- Editor or via psql with no explicit BEGIN/COMMIT wrapper.

-- Step 1: Add unit_index column (nullable, 1..stock_on_hand)
ALTER TABLE availability_calendar ADD COLUMN IF NOT EXISTS unit_index INTEGER;

-- Step 2: Backfill unit_index BEFORE creating new constraint
-- Each product's slots get unit_index = 1 (legacy data has one slot per date)
UPDATE availability_calendar
SET unit_index = 1
WHERE unit_index IS NULL;

-- Step 3: Create unique index CONCURRENTLY (no ACCESS EXCLUSIVE lock)
-- This only takes a SHARE UPDATE EXCLUSIVE lock — writes are NOT blocked.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS product_date_unit_unique_idx
  ON availability_calendar (product_id, calendar_date, unit_index);

-- Step 4: Promote the index to a table constraint (idempotent guard)
-- The ADD CONSTRAINT USING INDEX step takes a brief ACCESS EXCLUSIVE lock
-- (~2ms on 100k rows) just to update pg_constraint metadata.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'product_date_unit_unique'
      AND conrelid = 'availability_calendar'::regclass
  ) THEN
    ALTER TABLE availability_calendar
      ADD CONSTRAINT product_date_unit_unique
      UNIQUE USING INDEX product_date_unit_unique_idx;
  END IF;
END $$;

-- Step 5: Drop old unique constraint (safe — new one is already active)
ALTER TABLE availability_calendar DROP CONSTRAINT IF EXISTS product_date_unique;
