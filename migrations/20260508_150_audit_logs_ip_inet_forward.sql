-- ============================================================
-- BUG-508 Phase 2 — Forward Migration: audit_logs.ip_address TEXT → INET
-- Idempotent: safe to run multiple times
-- Run in: Supabase SQL Editor (production)
-- Pre-req: BUG-508 Phase 1 (PR #154) deployed with defensive code
-- ============================================================

BEGIN;

-- Safety timeouts to fail fast if table is heavily locked
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

-- Only alter if the column exists and is not already inet
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs'
      AND column_name = 'ip_address'
      AND data_type <> 'inet'
  ) THEN
    -- Safe USING clause: regex validates IP format before cast.
    -- Invalid values (e.g. "unknown", empty strings) become NULL
    -- instead of crashing the migration.
    -- Regex: ^[0-9a-fA-F.:]+(/[0-9]+)?$ matches IPv4, IPv6, and CIDR
    ALTER TABLE "audit_logs"
      ALTER COLUMN "ip_address" TYPE inet
      USING (
        CASE
          WHEN "ip_address" ~ '^[0-9a-fA-F.:]+(/[0-9]+)?$'
          THEN "ip_address"::inet
          ELSE NULL
        END
      );
    RAISE NOTICE 'audit_logs.ip_address converted from TEXT to INET';
  ELSE
    RAISE NOTICE 'audit_logs.ip_address is already INET or does not exist — skipping';
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
-- Expected: data_type = 'inet'

-- Check for any NULL ip_address values that were converted from invalid text
SELECT COUNT(*) AS null_ip_count
FROM audit_logs
WHERE ip_address IS NULL;
