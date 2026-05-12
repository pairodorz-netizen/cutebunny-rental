-- ============================================================
-- HOTFIX-514 — Rollback: Remove ip_address + user_agent columns from audit_logs
-- Idempotent: DROP COLUMN IF EXISTS (safe to run multiple times)
-- Run in: Supabase SQL Editor (production)
-- ⚠️ WARNING: DO NOT RUN unless explicitly rolling back HOTFIX-514.
--    This will permanently delete all ip_address and user_agent data.
-- ============================================================

BEGIN;

SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "ip_address";
ALTER TABLE "audit_logs" DROP COLUMN IF EXISTS "user_agent";

COMMIT;

-- ─── Post-commit verification ───────────────────────────────────────────
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'audit_logs'
  AND column_name IN ('ip_address', 'user_agent');
-- Expected: 0 rows (columns should not exist)
