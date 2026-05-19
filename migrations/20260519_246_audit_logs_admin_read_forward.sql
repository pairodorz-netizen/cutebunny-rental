-- BUG-546 (#246): Audit log empty for admin due to RESTRICTIVE RLS policy.
--
-- Root cause: The `bug_rls_02_deny_all_authenticated` policy on `audit_logs`
-- is RESTRICTIVE FOR ALL, blocking SELECT even for admin users who need to
-- read audit logs in the admin UI. The policy was originally created to prevent
-- direct client-side access, but admin users authenticate via Supabase Auth
-- as the `authenticated` role and need SELECT access.
--
-- Fix:
--   1. DROP the blanket deny-all RESTRICTIVE policy for `authenticated`
--   2. CREATE a RESTRICTIVE policy that denies INSERT/UPDATE/DELETE only
--      (admins must never write directly; only service_role writes)
--   3. CREATE a PERMISSIVE policy that allows SELECT only for admin users
--      (verified via `admin_users` table membership check)
--
-- Security:
--   - Customer-side authenticated users (no row in admin_users) are DENIED
--     SELECT by the PERMISSIVE policy's USING clause
--   - All authenticated users are DENIED INSERT/UPDATE/DELETE by the
--     RESTRICTIVE deny-write policy
--   - anon role is still DENIED ALL by existing `bug_rls_02_deny_all_anon`
--   - service_role and postgres bypass RLS entirely (BYPASSRLS attribute)

BEGIN;

-- Step 1: Drop the blanket deny-all RESTRICTIVE policy for authenticated
DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."audit_logs";

-- Step 2: Create RESTRICTIVE deny for INSERT/UPDATE/DELETE (no direct writes)
DROP POLICY IF EXISTS "audit_logs_deny_write_authenticated" ON "public"."audit_logs";
CREATE POLICY "audit_logs_deny_write_authenticated"
  ON "public"."audit_logs"
  AS RESTRICTIVE FOR INSERT TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "audit_logs_deny_update_authenticated" ON "public"."audit_logs";
CREATE POLICY "audit_logs_deny_update_authenticated"
  ON "public"."audit_logs"
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "audit_logs_deny_delete_authenticated" ON "public"."audit_logs";
CREATE POLICY "audit_logs_deny_delete_authenticated"
  ON "public"."audit_logs"
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);

-- Step 3: Allow SELECT for authenticated users who are admins
DROP POLICY IF EXISTS "audit_logs_admin_read" ON "public"."audit_logs";
CREATE POLICY "audit_logs_admin_read"
  ON "public"."audit_logs"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()));

COMMIT;

-- Verification query (run after migration):
-- SELECT policyname, roles, cmd, permissive
-- FROM pg_policies WHERE tablename = 'audit_logs'
-- ORDER BY policyname;
--
-- Expected policies on audit_logs:
-- 1. bug_rls_02_deny_all_anon          | {anon}          | ALL    | RESTRICTIVE
-- 2. audit_logs_deny_write_authenticated| {authenticated} | INSERT | RESTRICTIVE
-- 3. audit_logs_deny_update_authenticated| {authenticated}| UPDATE | RESTRICTIVE
-- 4. audit_logs_deny_delete_authenticated| {authenticated}| DELETE | RESTRICTIVE
-- 5. audit_logs_admin_read             | {authenticated} | SELECT | PERMISSIVE
-- 6. audit_logs_service_role_all       | {service_role}  | ALL    | PERMISSIVE
-- 7. audit_logs_postgres_all           | {postgres}      | ALL    | PERMISSIVE
