-- BUG-504-A06 step 2/3: backfill products.category_id from the legacy
-- enum column, flip it to NOT NULL, and install a BEFORE INSERT/UPDATE
-- trigger that keeps the two columns in sync during the transition
-- window.
--
-- Pre-flight invariants (step 1/3 must have run first):
--   * Column `products.category_id UUID NULL` exists.
--   * FK products_category_id_fkey → categories(id) exists.
--   * Index products_category_id_idx exists.
--
-- Post-flight invariants:
--   * Every row in `products` has a non-null `category_id` whose
--     joined `categories.slug` equals the legacy `category::text`.
--   * `products.category_id` is declared NOT NULL.
--   * A BEFORE INSERT/UPDATE trigger (products_sync_category_trg)
--     ensures future writes keep `category` and `category_id`
--     symmetric — either column may be supplied, the other is
--     auto-filled, and a supplied mismatch raises a clean error.
--
-- Execution path:
--   Owner runs this SQL manually in the Supabase SQL editor for
--   production hcmfohyzetykjsfwtrjt. CI + Worker do not hold
--   DATABASE_URL; `prisma migrate deploy` is never invoked against
--   prod. The Prisma client regenerates from schema.prisma locally
--   and in CI via `pnpm --filter @cutebunny/shared db:generate`.

-- ─── 1. Backfill from the legacy enum ───────────────────────────────────
-- Trivial mapping: ProductCategory enum literals are lowercase-identical
-- to seeded categories.slug values (confirmed in the §5 sanity pass
-- for A06). Zero unmapped rows.
UPDATE "products" AS p
SET    "category_id" = c.id
FROM   "categories" AS c
WHERE  c.slug = p.category::text
  AND  p.category_id IS NULL;

-- ─── 2. Verify zero residual NULLs (RAISE if backfill missed anything) ─
DO $$
DECLARE
  v_missing BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_missing
  FROM   "products"
  WHERE  "category_id" IS NULL;

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'BUG-504-A06 step 2/3 backfill INCOMPLETE: % products still have NULL category_id. Fix seed rows or enum values and retry; do NOT proceed to NOT NULL or trigger install.', v_missing;
  END IF;
END$$;

-- ─── 3. Promote category_id to NOT NULL ─────────────────────────────────
ALTER TABLE "products"
    ALTER COLUMN "category_id" SET NOT NULL;

-- ─── 4. Dual-write trigger ──────────────────────────────────────────────
-- Purpose:
--   During the transition window (between step 2/3 and step 3/3) the
--   enum column `category` and the FK column `category_id` both exist.
--   Both app-layer writes AND any raw SQL touching `products` must
--   produce consistent rows. This BEFORE trigger:
--
--     * If both columns are NEW, validates they map to the same slug
--       via `categories`. Mismatch → RAISE (caught by Prisma and
--       surfaced via the admin-route onError() envelope).
--     * If only `category` was written, derives `category_id` from
--       `categories.slug = NEW.category::text`.
--     * If only `category_id` was written, derives `category` from
--       `categories.id = NEW.category_id`.
--
-- Safe under concurrent writes: the lookup uses the primary-key /
-- unique-slug indexes (both O(log N)) and the trigger is STABLE from
-- the transaction's perspective because `categories` is almost never
-- mutated during product writes.

CREATE OR REPLACE FUNCTION "products_sync_category"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_slug TEXT;
  v_id   UUID;
BEGIN
  IF NEW.category IS NOT NULL AND NEW.category_id IS NOT NULL THEN
    -- Both supplied — validate symmetry.
    SELECT id INTO v_id FROM "categories" WHERE slug = NEW.category::text;
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
    SELECT id INTO v_id FROM "categories" WHERE slug = NEW.category::text;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'products.category value % has no matching categories.slug', NEW.category;
    END IF;
    NEW.category_id := v_id;
    RETURN NEW;
  END IF;

  IF NEW.category IS NULL AND NEW.category_id IS NOT NULL THEN
    -- FK only — derive the enum.
    SELECT slug INTO v_slug FROM "categories" WHERE id = NEW.category_id;
    IF v_slug IS NULL THEN
      RAISE EXCEPTION 'products.category_id % has no matching categories.id', NEW.category_id;
    END IF;
    NEW.category := v_slug::"ProductCategory";
    RETURN NEW;
  END IF;

  -- Both NULL — let the NOT NULL / enum NOT NULL constraints fire.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "products_sync_category_trg" ON "products";

CREATE TRIGGER "products_sync_category_trg"
BEFORE INSERT OR UPDATE ON "products"
FOR EACH ROW
EXECUTE FUNCTION "products_sync_category"();

-- ─── Rollback (owner runs only if commit 2 needs to be reverted) ────────
-- Order matters: drop trigger first, then function, then relax NOT NULL.
-- The backfilled category_id values remain populated (harmless, they
-- satisfy the FK). Leaving them in place makes re-running step 2/3
-- idempotent via `WHERE p.category_id IS NULL`.
--
-- DROP TRIGGER IF EXISTS "products_sync_category_trg" ON "products";
-- DROP FUNCTION IF EXISTS "products_sync_category"();
-- ALTER TABLE "products" ALTER COLUMN "category_id" DROP NOT NULL;
