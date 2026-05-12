-- ============================================================
-- HOTFIX-514 — Forward: Add missing ip_address + user_agent columns to audit_logs
-- Idempotent: ADD COLUMN IF NOT EXISTS (safe to run multiple times)
-- Run in: Supabase SQL Editor (production)
-- Run BEFORE: 20260508_150 (TEXT→INET) and 20260508_160 (system_logs)
--
-- Root cause: BUG-508 Phase 1 (PR #154) added defensive code but the
-- Prisma migration that creates these columns was never applied on prod.
-- Cloudflare Worker emits P2022 "column audit_logs.ip_address does not exist".
--
-- Columns are TEXT at this stage — Phase 2 migration #150 will convert
-- ip_address to INET safely via CASE-based USING clause.
-- ============================================================

BEGIN;

SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

-- Add ip_address as TEXT (not INET — that conversion happens in migration #150)
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;

-- Add user_agent as TEXT
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "user_agent" TEXT;

-- ─── Verification (inside transaction) ──────────────────────────────────
DO $$
DECLARE
  ip_exists boolean;
  ua_exists boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'ip_address'
  ) INTO ip_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs' AND column_name = 'user_agent'
  ) INTO ua_exists;

  IF NOT ip_exists THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: ip_address column not created';
  END IF;
  IF NOT ua_exists THEN
    RAISE EXCEPTION 'VERIFICATION FAILED: user_agent column not created';
  END IF;

  RAISE NOTICE 'VERIFICATION PASSED: ip_address (%) and user_agent (%) exist', ip_exists, ua_exists;
END$$;

COMMIT;

-- ─── Post-commit verification (copy-paste to verify) ────────────────────
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_logs'
  AND column_name IN ('ip_address', 'user_agent')
ORDER BY column_name;
-- Expected:
--   ip_address | text | YES
--   user_agent | text | YES
