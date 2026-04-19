-- FEAT-403: Add shipping_days column to shipping_province_configs
-- Default 2 days for existing provinces

ALTER TABLE shipping_province_configs ADD COLUMN IF NOT EXISTS shipping_days INTEGER NOT NULL DEFAULT 2;

-- Backfill: BKK zone provinces get 1 day, nationwide get 3 days
-- (Default 2 covers central zone)
UPDATE shipping_province_configs SET shipping_days = 1
WHERE province_code IN ('BKK', 'NBI', 'PTH', 'SMK', 'NPT', 'SUT');

UPDATE shipping_province_configs SET shipping_days = 3
WHERE province_code IN ('CMI', 'PKT');
