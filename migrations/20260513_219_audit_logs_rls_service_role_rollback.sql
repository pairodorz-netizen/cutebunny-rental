-- BUG-222 Rollback: Remove service_role and postgres permissive policies on audit_logs

DROP POLICY IF EXISTS "audit_logs_service_role_all" ON "public"."audit_logs";
DROP POLICY IF EXISTS "audit_logs_postgres_all" ON "public"."audit_logs";

-- Verification:
-- SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'audit_logs';
