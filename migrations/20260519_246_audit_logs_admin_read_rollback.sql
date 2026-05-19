-- BUG-546 (#246) Rollback: Restore the original deny-all RESTRICTIVE policy
-- for authenticated role on audit_logs.
--
-- This reverts the admin read access and restores the blanket deny.

BEGIN;

-- Remove the granular policies added by the forward migration
DROP POLICY IF EXISTS "audit_logs_admin_read" ON "public"."audit_logs";
DROP POLICY IF EXISTS "audit_logs_deny_write_authenticated" ON "public"."audit_logs";
DROP POLICY IF EXISTS "audit_logs_deny_update_authenticated" ON "public"."audit_logs";
DROP POLICY IF EXISTS "audit_logs_deny_delete_authenticated" ON "public"."audit_logs";

-- Restore the original blanket deny-all RESTRICTIVE policy
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."audit_logs"
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

COMMIT;

-- Verification:
-- SELECT policyname, roles, cmd, permissive
-- FROM pg_policies WHERE tablename = 'audit_logs';
--
-- Expected: bug_rls_02_deny_all_authenticated restored (RESTRICTIVE, ALL, authenticated)
