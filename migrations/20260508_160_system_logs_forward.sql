-- ============================================================
-- BUG-508 Phase 2 — Forward Migration: CREATE TABLE system_logs
-- Idempotent: safe to run multiple times (IF NOT EXISTS)
-- Run in: Supabase SQL Editor (production)
-- Purpose: Retention job compliance proof (BUG-507 PII/GDPR)
-- ============================================================

BEGIN;

-- Safety timeouts
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '2s';

-- Create the table
CREATE TABLE IF NOT EXISTS "system_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "job" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "details" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);

-- Indexes for retention job queries
CREATE INDEX IF NOT EXISTS "system_logs_job_idx"
  ON "system_logs" ("job");

CREATE INDEX IF NOT EXISTS "system_logs_created_at_idx"
  ON "system_logs" ("created_at");

-- Composite index for common query: filter by job + order by created_at
CREATE INDEX IF NOT EXISTS "system_logs_job_created_at_idx"
  ON "system_logs" ("job", "created_at" DESC);

COMMIT;

-- ============================================================
-- Verification (run after COMMIT)
-- ============================================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'system_logs'
ORDER BY ordinal_position;
-- Expected: id (uuid), job (text), status (text), details (jsonb), created_at (timestamptz)

SELECT indexname
FROM pg_indexes
WHERE tablename = 'system_logs';
-- Expected: system_logs_pkey, system_logs_job_idx, system_logs_created_at_idx, system_logs_job_created_at_idx
