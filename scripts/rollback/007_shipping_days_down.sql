-- Rollback FEAT-403: Remove shipping_days column
ALTER TABLE shipping_province_configs DROP COLUMN IF EXISTS shipping_days;
