-- BUG-RLS-02 sub-PR 3 — Group 1 policies: public-readable
--
-- Predecessors:
--   • BUG-RLS-01 enabled RLS on all 27 public tables with zero
--     policies (deny-all by default).
--   • BUG-RLS-02 sub-PR 1 (Group 4) locked _prisma_migrations to
--     RESTRICTIVE deny-all for anon + authenticated.
--   • BUG-RLS-02 sub-PR 2 (Group 3) locked 11 admin-only tables
--     to RESTRICTIVE deny-all for anon + authenticated.
--
-- This migration opens SELECT access to anon + authenticated on
-- the 9 Group 1 tables (public catalog surface). All Worker paths
-- go through service_role (BYPASSRLS), so this migration only
-- affects PostgREST-direct reads by non-privileged roles —
-- currently unused by the app, but forward-facing for a future
-- Supabase-client-based frontend.
--
-- Group 1 membership (9 tables):
--   brands                     — brand reference
--   categories                 — category reference
--   products                   — product catalog
--   product_images             — product image references
--   combo_sets                 — combo bundle definitions
--   combo_set_items            — combo bundle line items
--   i18n_strings               — translation strings
--   shipping_zones             — shipping zone definitions
--   shipping_province_configs  — per-province shipping config
--
-- Design decision (owner, 2026-04-23):
--   The PERMISSIVE SELECT policy does NOT filter on
--   `visible_frontend`. RLS stays a structural gate (role × table
--   only); business visibility is enforced at the Worker/API
--   layer, where it is already tested (A06.5 drift guard +
--   category parity gates). Mixing business flags into RLS
--   couples schema changes to the security layer and makes
--   policies harder to debug.
--
-- Write operations remain denied by default:
--   • RLS is on and no PERMISSIVE INSERT/UPDATE/DELETE policies
--     exist for anon/authenticated, so writes from those roles
--     are denied.
--   • service_role and postgres continue to bypass RLS entirely.
--
-- Idempotent: DROP POLICY IF EXISTS before CREATE POLICY so the
-- migration can be re-applied safely on prod if already run.

BEGIN;

-- ─── brands ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_select_anon" ON "public"."brands";
CREATE POLICY "bug_rls_02_select_anon"
  ON "public"."brands"
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "bug_rls_02_select_authenticated" ON "public"."brands";
CREATE POLICY "bug_rls_02_select_authenticated"
  ON "public"."brands"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- ─── categories ──────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_select_anon" ON "public"."categories";
CREATE POLICY "bug_rls_02_select_anon"
  ON "public"."categories"
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "bug_rls_02_select_authenticated" ON "public"."categories";
CREATE POLICY "bug_rls_02_select_authenticated"
  ON "public"."categories"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- ─── products ────────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_select_anon" ON "public"."products";
CREATE POLICY "bug_rls_02_select_anon"
  ON "public"."products"
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "bug_rls_02_select_authenticated" ON "public"."products";
CREATE POLICY "bug_rls_02_select_authenticated"
  ON "public"."products"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- ─── product_images ──────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_select_anon" ON "public"."product_images";
CREATE POLICY "bug_rls_02_select_anon"
  ON "public"."product_images"
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "bug_rls_02_select_authenticated" ON "public"."product_images";
CREATE POLICY "bug_rls_02_select_authenticated"
  ON "public"."product_images"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- ─── combo_sets ──────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_select_anon" ON "public"."combo_sets";
CREATE POLICY "bug_rls_02_select_anon"
  ON "public"."combo_sets"
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "bug_rls_02_select_authenticated" ON "public"."combo_sets";
CREATE POLICY "bug_rls_02_select_authenticated"
  ON "public"."combo_sets"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- ─── combo_set_items ─────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_select_anon" ON "public"."combo_set_items";
CREATE POLICY "bug_rls_02_select_anon"
  ON "public"."combo_set_items"
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "bug_rls_02_select_authenticated" ON "public"."combo_set_items";
CREATE POLICY "bug_rls_02_select_authenticated"
  ON "public"."combo_set_items"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- ─── i18n_strings ────────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_select_anon" ON "public"."i18n_strings";
CREATE POLICY "bug_rls_02_select_anon"
  ON "public"."i18n_strings"
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "bug_rls_02_select_authenticated" ON "public"."i18n_strings";
CREATE POLICY "bug_rls_02_select_authenticated"
  ON "public"."i18n_strings"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- ─── shipping_zones ──────────────────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_select_anon" ON "public"."shipping_zones";
CREATE POLICY "bug_rls_02_select_anon"
  ON "public"."shipping_zones"
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "bug_rls_02_select_authenticated" ON "public"."shipping_zones";
CREATE POLICY "bug_rls_02_select_authenticated"
  ON "public"."shipping_zones"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

-- ─── shipping_province_configs ───────────────────────────────
DROP POLICY IF EXISTS "bug_rls_02_select_anon" ON "public"."shipping_province_configs";
CREATE POLICY "bug_rls_02_select_anon"
  ON "public"."shipping_province_configs"
  AS PERMISSIVE FOR SELECT TO anon
  USING (true);

DROP POLICY IF EXISTS "bug_rls_02_select_authenticated" ON "public"."shipping_province_configs";
CREATE POLICY "bug_rls_02_select_authenticated"
  ON "public"."shipping_province_configs"
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (true);

COMMIT;
