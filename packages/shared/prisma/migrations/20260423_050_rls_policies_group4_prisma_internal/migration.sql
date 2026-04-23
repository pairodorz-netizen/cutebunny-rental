-- BUG-RLS-02 sub-PR 1 — Group 4 policies: system-internal
--
-- Predecessor: BUG-RLS-01 enabled RLS on all 27 public tables with
-- zero policies. The Worker's service_role bypasses RLS via role
-- attribute so the app works today, but "no policies" is a fragile
-- posture — a future accidental permissive policy OR's together
-- and opens the surface.
--
-- This migration explicitly locks Group 4 (system-internal) to
-- deny-all for anon + authenticated using RESTRICTIVE policies.
-- RESTRICTIVE policies AND against any future permissive policy,
-- so even if someone later adds `FOR SELECT TO anon USING (true)`
-- by accident, this policy keeps the door shut.
--
-- Group 4 membership: 1 table.
--   _prisma_migrations — Prisma's own migration tracker. No app
--                        path should ever touch it with anon or
--                        authenticated roles.
--
-- service_role and postgres are unaffected — role-level BYPASSRLS
-- means they skip policy evaluation entirely. Prisma's migration
-- engine (which connects as whatever DATABASE_URL specifies) keeps
-- working.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY so the
-- migration can be re-applied safely on prod if it was already
-- run.

BEGIN;

-- ─── _prisma_migrations ─────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_deny_all_anon" ON "public"."_prisma_migrations";
CREATE POLICY "bug_rls_02_deny_all_anon"
  ON "public"."_prisma_migrations"
  AS RESTRICTIVE
  FOR ALL
  TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."_prisma_migrations";
CREATE POLICY "bug_rls_02_deny_all_authenticated"
  ON "public"."_prisma_migrations"
  AS RESTRICTIVE
  FOR ALL
  TO authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;

-- ─── Verification ──────────────────────────────────────────────
--
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd
-- FROM pg_policies
-- WHERE schemaname = 'public'
--   AND tablename = '_prisma_migrations'
-- ORDER BY policyname;
--
-- Expected 2 rows:
--   bug_rls_02_deny_all_anon           | RESTRICTIVE | {anon}          | ALL
--   bug_rls_02_deny_all_authenticated  | RESTRICTIVE | {authenticated} | ALL
