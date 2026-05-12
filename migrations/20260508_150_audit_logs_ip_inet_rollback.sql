-- ============================================================
-- BUG-508 Phase 2 — Rollback: audit_logs.ip_address INET → TEXT
-- Idempotent: safe to run multiple times
-- Run in: Supabase SQL Editor (production)
-- WARNING: Run ONLY after reverting Worker code (double-deploy rollback)
-- ============================================================

BEGIN;

-- Safety timeouts
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

-- Only alter if the column is currently inet
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs'
      AND column_name = 'ip_address'
      AND data_type = 'inet'
  ) THEN
    ALTER TABLE "audit_logs"
      ALTER COLUMN "ip_address" TYPE text
      USING host("ip_address")::text;
    RAISE NOTICE 'audit_logs.ip_address reverted from INET to TEXT';
  ELSE
    RAISE NOTICE 'audit_logs.ip_address is already TEXT or does not exist — skipping';
  END IF;
END$$;

COMMIT;

-- ============================================================
-- Verification (run after COMMIT)
-- ============================================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'audit_logs'
  AND column_name = 'ip_address';
-- Expected: data_type = 'text'
