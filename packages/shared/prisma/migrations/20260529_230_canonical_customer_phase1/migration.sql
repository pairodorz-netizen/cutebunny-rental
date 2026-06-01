-- Phase 1: Canonical Customer Identity
-- 1. Add last_login_at to customers (nullable, no default — no table lock)
-- 2. Replace anonymous merged_into FK with explicit ON DELETE RESTRICT

-- 1. last_login_at
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "last_login_at" TIMESTAMPTZ;

-- 2. merged_into FK → ON DELETE RESTRICT
-- Drop the anonymous FK created in migration 220, then re-add with explicit action.
DO $$
DECLARE fk_name TEXT;
BEGIN
  SELECT tc.constraint_name INTO fk_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_name = 'customers'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'merged_into';

  IF fk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "customers" DROP CONSTRAINT %I', fk_name);
  END IF;
END $$;

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_merged_into_fkey"
  FOREIGN KEY ("merged_into") REFERENCES "customers"("id") ON DELETE RESTRICT;
