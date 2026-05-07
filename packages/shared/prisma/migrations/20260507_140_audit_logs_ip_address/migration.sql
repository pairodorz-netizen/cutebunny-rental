-- BUG-506: Fix Prisma schema drift on audit_logs.ip_address
--
-- Root cause: the `audit_logs` table was created manually in Supabase
-- (or via an untracked DDL) without the `ip_address` column that the
-- Prisma schema declares. This causes P2022 errors at runtime:
--   "The column `audit_logs.ip_address` does not exist in the current database."
--
-- This migration:
--   1. Creates the `audit_logs` table if it does not exist (covers fresh
--      deploys and CI shadow databases).
--   2. Adds `ip_address` if the table already exists but lacks the column
--      (covers production).

-- Step 1: Create the table if it does not exist at all.
CREATE TABLE IF NOT EXISTS "audit_logs" (
    "id"          UUID        NOT NULL DEFAULT uuid_generate_v4(),
    "order_id"    UUID,
    "admin_id"    UUID        NOT NULL,
    "action"      TEXT        NOT NULL,
    "resource"    TEXT,
    "resource_id" TEXT,
    "details"     JSONB,
    "ip_address"  TEXT,
    "created_at"  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- Step 2: Add ip_address if the table existed without it.
ALTER TABLE "audit_logs" ADD COLUMN IF NOT EXISTS "ip_address" TEXT;

-- Step 3: Foreign keys (idempotent — silently ignored if they already exist).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_order_id_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_order_id_fkey"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_admin_id_fkey'
  ) THEN
    ALTER TABLE "audit_logs"
      ADD CONSTRAINT "audit_logs_admin_id_fkey"
      FOREIGN KEY ("admin_id") REFERENCES "admin_users"("id");
  END IF;
END $$;

-- Step 4: RLS (already enabled in migration 040 + 060, but re-enable
-- idempotently in case the table was recreated after those ran).
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
