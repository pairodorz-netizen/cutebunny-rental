-- BUG-RLS-02 sub-PR 2 — Group 3 policies: admin-only
--
-- Predecessor: BUG-RLS-01 enabled RLS on all 27 public tables with
-- zero policies. BUG-RLS-02 sub-PR 1 locked _prisma_migrations
-- (Group 4) to RESTRICTIVE deny-all for anon + authenticated.
--
-- This migration does the same for Group 3 (admin-only, 11 tables).
-- Every app path to these tables goes through the Worker's
-- service_role (which bypasses RLS via role attribute), so anon +
-- authenticated should never have access. RESTRICTIVE deny-all
-- policies AND against any future permissive rule, preserving
-- deny-all even under accidental permissive additions.
--
-- Group 3 membership (11 tables):
--   admin_users            — admin account table (credentials)
--   audit_logs             — admin action audit trail
--   system_configs         — runtime config (e.g. shipping toggle)
--   notification_logs      — outbound notification history
--   finance_categories     — chart-of-accounts taxonomy
--   finance_transactions   — ledger entries
--   after_sales_events     — returns, refunds, damage events
--   inventory_units        — SKU-level unit tracking
--   inventory_status_logs  — per-unit state transitions
--   product_stock_logs     — per-product stock deltas
--   availability_calendar  — per-unit date-range availability
--
-- service_role and postgres are unaffected — role-level BYPASSRLS
-- means they skip policy evaluation entirely. The Worker's admin
-- routes and system jobs continue to work identically.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY so the
-- migration can be re-applied safely on prod if it was already
-- run.

BEGIN;

-- ─── admin_users ─────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."admin_users";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."admin_users"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."admin_users";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."admin_users"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── audit_logs ──────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."audit_logs";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."audit_logs"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."audit_logs";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."audit_logs"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── system_configs ──────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."system_configs";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."system_configs"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."system_configs";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."system_configs"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── notification_logs ───────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."notification_logs";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."notification_logs"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."notification_logs";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."notification_logs"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── finance_categories ──────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."finance_categories";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."finance_categories"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."finance_categories";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."finance_categories"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── finance_transactions ────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."finance_transactions";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."finance_transactions"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."finance_transactions";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."finance_transactions"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── after_sales_events ──────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."after_sales_events";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."after_sales_events"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."after_sales_events";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."after_sales_events"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── inventory_units ─────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."inventory_units";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."inventory_units"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."inventory_units";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."inventory_units"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── inventory_status_logs ───────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."inventory_status_logs";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."inventory_status_logs"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."inventory_status_logs";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."inventory_status_logs"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── product_stock_logs ──────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."product_stock_logs";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."product_stock_logs"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."product_stock_logs";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."product_stock_logs"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- ─── availability_calendar ───────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."availability_calendar";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."availability_calendar"
  AS RESTRICTIVE FOR ALL TO anon
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."availability_calendar";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."availability_calendar"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

COMMIT;

-- ─── Verification ──────────────────────────────────────────────
--
-- SELECT tablename, policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename IN (
--     'admin_users','audit_logs','system_configs','notification_logs',
--     'finance_categories','finance_transactions','after_sales_events',
--     'inventory_units','inventory_status_logs','product_stock_logs',
--     'availability_calendar'
--   )
-- ORDER BY tablename, policyname;
--
-- Expected 22 rows (11 tables × 2 roles), each RESTRICTIVE / FOR ALL.
