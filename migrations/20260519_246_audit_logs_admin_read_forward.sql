-- BUG-546 (#246): Audit log empty for admin — ensure backend API (postgres/
-- service_role) can read through RLS.
--
-- Architecture investigation confirmed:
--   • Admin dashboard queries audit_logs via backend API (Prisma/Neon),
--     NOT via Supabase JS client with `authenticated` role.
--   • Backend API connects as `postgres` role via DATABASE_URL.
--   • Admin authentication uses custom password_hash in admin_users table,
--     NOT Supabase Auth — therefore auth.uid() cannot match admin_users.
--
-- Root cause: Supabase Dashboard may have applied FORCE ROW LEVEL SECURITY
-- on audit_logs, which forces RLS evaluation even for the table owner
-- (postgres). Combined with only RESTRICTIVE deny-all policies and no
-- PERMISSIVE policies for postgres/service_role at table-creation time,
-- the default-deny behavior blocks all reads.
--
-- Fix (Option A — service_role via backend API):
--   1. NO FORCE ROW LEVEL SECURITY — restore postgres BYPASSRLS behaviour
--   2. Re-ensure PERMISSIVE ALL policies for postgres + service_role
--      (idempotent; originally added by PR #238 migration 219)
--   3. Keep RESTRICTIVE deny-all for authenticated + anon intact
--      (correct security boundary — these roles must never access directly)
--
-- Security:
--   - anon: DENIED ALL by existing `bug_rls_02_deny_all_anon` (RESTRICTIVE)
--   - authenticated: DENIED ALL by existing `bug_rls_02_deny_all_authenticated`
--     (RESTRICTIVE) — no change, customer Supabase client cannot read
--   - postgres: BYPASSRLS restored + explicit PERMISSIVE ALL (belt-and-suspenders)
--   - service_role: BYPASSRLS + explicit PERMISSIVE ALL (belt-and-suspenders)

BEGIN;

-- Step 1: Remove FORCE ROW LEVEL SECURITY so postgres BYPASSRLS takes effect.
-- (No-op if FORCE was never set; safe to run unconditionally.)
ALTER TABLE "public"."audit_logs" NO FORCE ROW LEVEL SECURITY;

-- Step 2: Ensure PERMISSIVE policies for trusted roles (idempotent).
-- These were originally created by PR #238 (migration 219) but we re-ensure
-- them here as a single self-contained migration for #246.
DROP POLICY IF EXISTS "audit_logs_service_role_all" ON "public"."audit_logs";
CREATE POLICY "audit_logs_service_role_all"
  ON "public"."audit_logs"
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "audit_logs_postgres_all" ON "public"."audit_logs";
CREATE POLICY "audit_logs_postgres_all"
  ON "public"."audit_logs"
  AS PERMISSIVE FOR ALL TO postgres
  USING (true) WITH CHECK (true);

COMMIT;

-- Verification query (run after migration):
-- SELECT policyname, roles, cmd, permissive
-- FROM pg_policies WHERE tablename = 'audit_logs'
-- ORDER BY policyname;
--
-- Expected policies on audit_logs:
-- 1. bug_rls_02_deny_all_anon          | {anon}          | ALL    | RESTRICTIVE
-- 2. bug_rls_02_deny_all_authenticated | {authenticated} | ALL    | RESTRICTIVE
-- 3. audit_logs_service_role_all       | {service_role}  | ALL    | PERMISSIVE
-- 4. audit_logs_postgres_all           | {postgres}      | ALL    | PERMISSIVE
--
-- Verify NO FORCE:
-- SELECT relname, relforcerowsecurity
-- FROM pg_class WHERE relname = 'audit_logs';
-- Expected: relforcerowsecurity = false
