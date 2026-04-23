-- BUG-RLS-02 sub-PR 4 — Group 2 policies: customer-owned
--
-- Predecessors:
--   • BUG-RLS-01 enabled RLS on all 27 public tables (deny-all).
--   • BUG-RLS-02 sub-PR 1 (#61, Group 4): RESTRICTIVE deny-all on
--     _prisma_migrations for anon + authenticated.
--   • BUG-RLS-02 sub-PR 2 (#62, Group 3): RESTRICTIVE deny-all on
--     11 admin-only tables for anon + authenticated.
--   • BUG-RLS-02 sub-PR 3 (#63, Group 1): PERMISSIVE SELECT
--     USING (true) on 9 public catalog tables for anon +
--     authenticated.
--
-- This migration locks Group 2 (customer-owned, 6 tables) to
-- RESTRICTIVE deny-all for anon + authenticated as a placeholder
-- state. When the Supabase Auth vs custom JWT architecture
-- decision lands, a follow-up migration will add PERMISSIVE
-- policies on top (e.g. `auth.uid() = customer_id` for Supabase
-- Auth, or `current_setting('request.jwt.claim.sub') =
-- customer_id::text` for custom JWT + Postgres SET). The
-- RESTRICTIVE deny-all added here does NOT block that future
-- work — it merely prevents accidental permissive access until
-- the Auth layer is explicitly opted in.
--
-- Group 2 membership (6 tables):
--   orders                  — customer order headers
--   order_items             — order line items
--   order_status_logs       — order state transitions
--   payment_slips           — uploaded payment proof records
--   customer_documents      — customer KYC / ID documents
--   customers               — customer account table (includes PII)
--
-- Worker path (Cloudflare Worker → Neon pool → service_role
-- BYPASSRLS) is unaffected. Admin and customer API routes behave
-- identically. service_role skips policy evaluation entirely.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY so the
-- migration can be re-applied safely on prod if already run.

BEGIN;

-- ─── orders ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."orders";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."orders"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."orders";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."orders"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── order_items ─────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."order_items";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."order_items"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."order_items";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."order_items"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── order_status_logs ───────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."order_status_logs";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."order_status_logs"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."order_status_logs";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."order_status_logs"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── payment_slips ───────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."payment_slips";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."payment_slips"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."payment_slips";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."payment_slips"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── customer_documents ──────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."customer_documents";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."customer_documents"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."customer_documents";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."customer_documents"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── customers ───────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."customers";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."customers"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."customers";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."customers"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

COMMIT;
