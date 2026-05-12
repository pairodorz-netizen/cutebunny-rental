-- ============================================================
-- BUG-508 Phase 2 — Rollback: DROP TABLE system_logs
-- Idempotent: safe to run multiple times (IF EXISTS)
-- Run in: Supabase SQL Editor (production)
-- WARNING: This DROPS all system_logs data. Only run during rollback.
-- ============================================================

BEGIN;

-- Safety timeouts
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

-- Drop indexes first (CASCADE would handle this, but explicit is safer)
DROP INDEX IF EXISTS "system_logs_job_created_at_idx";
DROP INDEX IF EXISTS "system_logs_created_at_idx";
DROP INDEX IF EXISTS "system_logs_job_idx";

-- Drop the table
DROP TABLE IF EXISTS "system_logs";

COMMIT;

-- ============================================================
-- Verification (run after COMMIT)
-- ============================================================
SELECT COUNT(*) AS table_exists
FROM information_schema.tables
WHERE table_name = 'system_logs';
-- Expected: 0 (table should not exist)
