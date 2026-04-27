-- BUG-504-A06 commit 3 hotfix-3: extend the legacy `ProductCategory`
-- enum with the new slugs that have been added to the `categories`
-- table since the original 7-row seed.
--
-- Background:
--   The owner has been seeding new categories (`ig-brand`, `dress`,
--   `sea-trip`, `minimal`, `vietnam`, `camera`) into the `categories`
--   table directly. Because A06 commit 3 still keeps the legacy
--   `products.category` enum column NOT NULL (column drop is gated
--   to commit 4 FINAL), every product write attempted to cast the
--   slug to `"ProductCategory"`. The cast fails for any slug not
--   declared in the enum type — which now includes all six new
--   slugs.
--
-- Owner has already run the equivalent of this file's body in the
-- Supabase SQL editor against prod (hcmfohyzetykjsfwtrjt) per the
-- repo's manual-migration convention (see header in
-- `20260422_010_products_category_id_fk/migration.sql`). This file
-- exists for code-sync only — `prisma migrate deploy` is NOT
-- invoked against prod from CI. The accompanying schema.prisma
-- update brings the generated Prisma client into agreement with
-- the prod DB enum.
--
-- This whole patch is reverted by A06 commit 4 FINAL when the
-- enum + the `products.category` column + the
-- `products_sync_category_trg` trigger drop together. New slugs
-- added between this migration and commit 4 FINAL must be appended
-- here as additional `ALTER TYPE … ADD VALUE` lines (Postgres does
-- not support DROP VALUE on enum types in transaction-safe form;
-- ADD VALUE IF NOT EXISTS is the only forward-compatible knob).
--
-- Safety notes:
--   • `ADD VALUE IF NOT EXISTS` is idempotent. Re-running this file
--     against the prod DB (which already has all six values) is a
--     safe no-op.
--   • `ADD VALUE` cannot run inside a transaction in Postgres ≤ 14
--     when the new value is used in the same transaction. We do
--     not use the new values in this file, so no BEGIN/COMMIT
--     wrapper is needed and the IF NOT EXISTS guard is sufficient
--     for re-runs.
--   • No data move. No index/constraint changes. No trigger
--     touches.

-- ─── Extend ProductCategory enum ────────────────────────────────────────
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'ig-brand';
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'dress';
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'sea-trip';
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'minimal';
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'vietnam';
ALTER TYPE "ProductCategory" ADD VALUE IF NOT EXISTS 'camera';

-- ─── Rollback (owner runs only if hotfix-3 needs to be reverted) ────────
-- Postgres has no transaction-safe DROP VALUE for enum types. To
-- revert, the owner must (i) confirm no products reference any of
-- these enum values in `products.category`, then (ii) recreate the
-- enum type without the new values via the documented
-- `CREATE TYPE … AS ENUM (…)` + `ALTER TABLE … ALTER COLUMN …
-- USING (… ::text::"ProductCategoryNew")` swap. Realistically the
-- forward path is A06 commit 4 FINAL, which drops the enum
-- entirely; rollback of hotfix-3 in isolation is not expected.
