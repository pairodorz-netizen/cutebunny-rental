-- BUG-RLS-01 hotfix — enable Row Level Security on every public table.
--
-- Context: Supabase Security Advisor flagged 27 CRITICAL errors —
-- "Table public.<name> is public, but RLS has not been enabled" —
-- covering every application table in the public schema. Owner
-- applied this migration on prod Supabase manually via the SQL
-- Editor (~2026-04-23 17:00 UTC / 02:00 JST). This file makes the
-- repo match the live DB state so the next Prisma deploy / baseline
-- does not surface RLS as a drift.
--
-- Safety model:
--   • The Cloudflare Worker connects with Supabase's service_role
--     database role, which has `BYPASSRLS` by platform default. Every
--     admin route + customer route goes through Prisma + Neon pool +
--     `DATABASE_URL` (see apps/api/src/lib/db.ts); the service_role
--     key bypasses RLS, so enabling RLS with zero policies does not
--     deny any existing query path. Validated empirically by owner —
--     after the prod SQL ran, admin dashboard + customer frontend +
--     API all responded normally.
--   • No policies are added here. The tables are in "deny-all" RLS
--     mode for non-bypass roles (anon, authenticated). If a future
--     route ever starts using PostgREST directly or the browser's
--     Supabase JS client against these tables, it will fail until
--     per-table policies are authored (tracked as follow-up
--     BUG-RLS-02 — see docs/bug-rls-02-policy-plan.md).
--
-- This migration is idempotent: `ENABLE ROW LEVEL SECURITY` is a
-- no-op when already enabled, so re-running does not error.

BEGIN;

-- 1. Prisma internal / migration tracker
ALTER TABLE "public"."_prisma_migrations" ENABLE ROW LEVEL SECURITY;

-- 2. Identity / auth
ALTER TABLE "public"."admin_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."customer_documents" ENABLE ROW LEVEL SECURITY;

-- 3. Catalog
ALTER TABLE "public"."brands" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."product_images" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."combo_sets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."combo_set_items" ENABLE ROW LEVEL SECURITY;

-- 4. Orders / fulfilment
ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."order_status_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."payment_slips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."after_sales_events" ENABLE ROW LEVEL SECURITY;

-- 5. Inventory / availability
ALTER TABLE "public"."inventory_units" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."inventory_status_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."product_stock_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."availability_calendar" ENABLE ROW LEVEL SECURITY;

-- 6. Shipping
ALTER TABLE "public"."shipping_zones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."shipping_province_configs" ENABLE ROW LEVEL SECURITY;

-- 7. Finance
ALTER TABLE "public"."finance_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."finance_transactions" ENABLE ROW LEVEL SECURITY;

-- 8. Ops / system
ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notification_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."system_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."i18n_strings" ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ─── Verification (already confirmed on prod by owner) ────────────────
--
-- SELECT COUNT(*) FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public'
--   AND c.relkind = 'r'
--   AND c.relrowsecurity = false;
-- -- Expected: 0
--
-- Supabase Security Advisor "table without RLS" count: 0
