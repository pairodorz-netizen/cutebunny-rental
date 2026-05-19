-- BUG-546 (#246) Rollback: Restore FORCE ROW LEVEL SECURITY on audit_logs.
--
-- This reverts the NO FORCE change. The PERMISSIVE policies for postgres/
-- service_role are left in place (they were originally from PR #238 and
-- don't cause harm).

BEGIN;

-- Restore FORCE ROW LEVEL SECURITY (original Supabase Dashboard state)
ALTER TABLE "public"."audit_logs" FORCE ROW LEVEL SECURITY;

COMMIT;

-- Verification:
-- SELECT relname, relforcerowsecurity
-- FROM pg_class WHERE relname = 'audit_logs';
-- Expected: relforcerowsecurity = true
--
-- SELECT policyname, roles, cmd, permissive
-- FROM pg_policies WHERE tablename = 'audit_logs';
-- Policies remain unchanged — only the FORCE flag is restored.
