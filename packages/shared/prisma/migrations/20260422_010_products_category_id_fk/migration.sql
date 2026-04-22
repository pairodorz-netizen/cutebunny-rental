-- BUG-504-A06 step 1/3: add products.category_id (nullable, FK, no data move yet).
--
-- Ratified by owner (pairodorz) via explicit "A06 RATIFY" after §5 sanity pass
-- (16 products spread across 2 in-use enum values, zero unmapped, no other FK
-- references products.category). This is the first of three sequenced commits;
-- commits 2 + 3 land on the same branch with strict gates between them.
--
-- Scope of this file:
--   • ADD COLUMN products.category_id UUID NULL
--   • ADD FOREIGN KEY products.category_id → categories(id)
--     (ON DELETE RESTRICT, ON UPDATE CASCADE — matches the risk profile:
--      deleting a category with live products must be rejected; renaming
--      a category id is a non-concern because id is UUID v4 and never
--      mutates, but CASCADE is the safer default for a surrogate PK.)
--   • CREATE INDEX on products.category_id for lookup performance
--
-- Non-goals (explicitly NOT in this migration):
--   • No data backfill (deferred to commit 2 / step 2/3).
--   • No NOT NULL flip (deferred to commit 2 after backfill verification).
--   • No dual-write trigger (deferred to commit 2).
--   • No drop of products.category enum or ProductCategory type (commit 3).
--
-- Safety:
--   • Fully reversible without data loss. Rollback block at the bottom.
--   • Does not read or write existing data. The ADD COLUMN is instantaneous
--     on modern Postgres for a nullable column with no default.
--   • Does not conflict with A01's categories table or its seed.
--
-- Execution path:
--   Owner runs this SQL manually in Supabase SQL editor (prod
--   hcmfohyzetykjsfwtrjt). No DATABASE_URL is exposed to the Worker or CI,
--   so `prisma migrate deploy` is not invoked against production. The
--   Prisma client is regenerated from schema.prisma locally + in CI.

-- ─── Column + FK + index ────────────────────────────────────────────────
ALTER TABLE "products"
    ADD COLUMN "category_id" UUID NULL;

ALTER TABLE "products"
    ADD CONSTRAINT "products_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "products_category_id_idx" ON "products" ("category_id");

-- ─── Rollback (owner runs only if commit 1 needs to be reverted) ────────
-- DROP INDEX     IF EXISTS "products_category_id_idx";
-- ALTER TABLE "products" DROP CONSTRAINT IF EXISTS "products_category_id_fkey";
-- ALTER TABLE "products" DROP COLUMN     IF EXISTS "category_id";
