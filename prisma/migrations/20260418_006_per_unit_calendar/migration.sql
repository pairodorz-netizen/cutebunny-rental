-- FEAT-302: Per-Unit Calendar Navigation
-- Add unit_index to availability_calendar for per-unit filtering
-- Reversible: see scripts/rollback/006_per_unit_calendar_down.sql

-- Step 1: Add unit_index column (nullable, 1..stock_on_hand)
ALTER TABLE availability_calendar ADD COLUMN IF NOT EXISTS unit_index INTEGER;

-- Step 2: Drop old unique constraint and create new one including unit_index
-- This allows multiple slots per product per date (one per unit)
ALTER TABLE availability_calendar DROP CONSTRAINT IF EXISTS product_date_unique;
ALTER TABLE availability_calendar ADD CONSTRAINT product_date_unit_unique UNIQUE (product_id, calendar_date, unit_index);

-- Step 3: Backfill unit_index round-robin by product_id ordered by calendar_date
-- Each product's slots get unit_index = 1 (since legacy data has one slot per date)
UPDATE availability_calendar
SET unit_index = 1
WHERE unit_index IS NULL;
