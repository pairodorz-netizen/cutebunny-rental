-- BUG-RLS-03: pin search_path on public.set_updated_at and
-- public.products_sync_category to close the last 2
-- "Function Search Path Mutable" warnings from the Supabase
-- Security Advisor.
--
-- Background:
--   Supabase hardens against supply-chain attacks where an
--   attacker creates a shadowing function/table in a schema
--   earlier on the function's resolution search_path. By pinning
--   `search_path = ''` on SECURITY-INVOKER functions, every
--   unqualified identifier inside the function body becomes a
--   hard error, forcing explicit schema qualification.
--
-- Decision (per owner-ACKed plan):
--   * `set_updated_at()` — trivial body touches only NEW fields,
--     no table/function lookup. A bare `ALTER FUNCTION … SET
--     search_path = ''` is sufficient.
--   * `products_sync_category()` — body references the
--     unqualified `"categories"` relation and the
--     `"ProductCategory"` enum type multiple times. Under
--     `search_path = ''` those would fail to resolve, so the
--     function MUST be recreated with schema-qualified names.
--     Recreated in place via `CREATE OR REPLACE FUNCTION` with
--     `SET search_path = ''` attached; the existing
--     `products_sync_category_trg` trigger on public.products
--     keeps pointing to the same function OID after REPLACE and
--     needs no re-install.
--
-- Related forward-looking note:
--   BUG-504-A06 commit 3 FINAL will DROP the
--   `products_sync_category_trg` trigger and the
--   `products_sync_category()` function entirely (end of the
--   dual-write window). This migration reshapes the function so
--   the security posture is correct during the window between
--   now and the FINAL cutover. The DROP in A06 commit 3 is
--   unaffected.
--
-- Idempotent: `ALTER FUNCTION … SET` and `CREATE OR REPLACE
-- FUNCTION` are both safe to re-apply. Wrapped in a single
-- BEGIN/COMMIT.

BEGIN;

-- ─── 1. set_updated_at — bare ALTER is enough ────────────────
-- Body contents verified: only `NEW."updated_at" =
-- CURRENT_TIMESTAMP;` — no relation / function / type lookup
-- that would be affected by `search_path = ''`.
ALTER FUNCTION "public"."set_updated_at"() SET search_path = '';

-- ─── 2. products_sync_category — CREATE OR REPLACE with
--         schema-qualified body + SET search_path = '' ────────
-- Body changes vs original (packages/shared/prisma/migrations/
-- 20260422_020_products_category_id_backfill_dualwrite/
-- migration.sql lines 75-118):
--   * `"categories"` → `"public"."categories"` (4 call sites)
--   * `"ProductCategory"` → `"public"."ProductCategory"` (cast)
-- Behavior is unchanged; only the resolution path of
-- unqualified identifiers is tightened.
CREATE OR REPLACE FUNCTION "public"."products_sync_category"()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_slug TEXT;
  v_id   UUID;
BEGIN
  IF NEW.category IS NOT NULL AND NEW.category_id IS NOT NULL THEN
    -- Both supplied — validate symmetry.
    SELECT id INTO v_id FROM "public"."categories" WHERE slug = NEW.category::text;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'products.category value % has no matching categories.slug', NEW.category;
    END IF;
    IF v_id <> NEW.category_id THEN
      RAISE EXCEPTION 'products.category (%) and products.category_id (%) refer to different categories', NEW.category, NEW.category_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.category IS NOT NULL AND NEW.category_id IS NULL THEN
    -- Enum only — derive the FK.
    SELECT id INTO v_id FROM "public"."categories" WHERE slug = NEW.category::text;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'products.category value % has no matching categories.slug', NEW.category;
    END IF;
    NEW.category_id := v_id;
    RETURN NEW;
  END IF;

  IF NEW.category IS NULL AND NEW.category_id IS NOT NULL THEN
    -- FK only — derive the enum.
    SELECT slug INTO v_slug FROM "public"."categories" WHERE id = NEW.category_id;
    IF v_slug IS NULL THEN
      RAISE EXCEPTION 'products.category_id % has no matching categories.id', NEW.category_id;
    END IF;
    NEW.category := v_slug::"public"."ProductCategory";
    RETURN NEW;
  END IF;

  -- Both NULL — let the NOT NULL / enum NOT NULL constraints fire.
  RETURN NEW;
END;
$$;

COMMIT;
