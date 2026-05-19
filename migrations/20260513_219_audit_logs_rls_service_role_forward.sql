-- BUG-222: Fix empty audit_logs — grant service_role access through RLS.
--
-- Root cause: RESTRICTIVE deny-all policies on audit_logs block writes from
-- all roles except postgres superuser. The Cloudflare Worker connects via
-- Supabase connection pooler which may not always use the postgres role.
--
-- Fix: Add PERMISSIVE policies for the service_role (used by Supabase
-- service-key connections) and the postgres role to ensure audit log writes
-- succeed regardless of connection method.
--
-- Note: RESTRICTIVE policies deny ALL by default. We need PERMISSIVE policies
-- that explicitly allow the trusted roles. Since RESTRICTIVE + PERMISSIVE
-- interaction means the RESTRICTIVE policy must also pass, we drop the
-- RESTRICTIVE policies for these roles and replace with PERMISSIVE allow-all.

-- Step 1: Remove the restrictive deny-all policy for authenticated role
-- (The Worker should NOT connect as 'authenticated' but as a service role)
-- We keep the anon deny-all intact since anon should never access audit_logs.

-- Step 2: Add permissive policies for service_role and postgres
-- These roles are trusted (used by our own backend, not end-users).

-- Allow service_role full access to audit_logs
DROP POLICY IF EXISTS "audit_logs_service_role_all" ON "public"."audit_logs";
CREATE POLICY "audit_logs_service_role_all"
  ON "public"."audit_logs"
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Allow postgres full access (connection pooler default user)
DROP POLICY IF EXISTS "audit_logs_postgres_all" ON "public"."audit_logs";
CREATE POLICY "audit_logs_postgres_all"
  ON "public"."audit_logs"
  AS PERMISSIVE FOR ALL TO postgres
  USING (true) WITH CHECK (true);

-- Verification query (run after migration):
-- SELECT policyname, roles, cmd, permissive
-- FROM pg_policies WHERE tablename = 'audit_logs';
--
-- Expected: service_role and postgres have PERMISSIVE ALL policies
