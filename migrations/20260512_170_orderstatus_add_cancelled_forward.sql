-- ============================================================
-- HOTFIX-515 — Forward: Add 'cancelled' to OrderStatus enum
-- Idempotent: ADD VALUE IF NOT EXISTS (safe to run multiple times)
-- Run in: Supabase SQL Editor (production)
--
-- Root cause: Prisma schema declares 8 enum values including 'cancelled'
-- but prod PostgreSQL enum "OrderStatus" only has 7 values.
-- This causes 22P02 "invalid input value for enum" on any query that
-- touches orders with status='cancelled'.
--
-- NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block
-- in PostgreSQL. This statement must be run as a standalone query.
-- ============================================================

-- Add the missing enum value (no BEGIN/COMMIT — not allowed for ADD VALUE)
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'cancelled';

-- ============================================================
-- Verification (run separately after the ALTER above)
-- ============================================================
-- Check all enum values:
-- SELECT enumlabel FROM pg_enum
-- WHERE enumtypid = '"OrderStatus"'::regtype
-- ORDER BY enumsortorder;
--
-- Expected 8 values:
--   unpaid, paid_locked, shipped, returned, cleaning, repair, finished, cancelled
