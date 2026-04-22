-- BUG-504-A01: product categories table (taxonomy source of truth)
--
-- Ratified by owner (pairodorz) without full ChatGPT debate round due
-- to simplicity + non-breaking scope.
--
-- Scope:
--   • CREATE TABLE `categories` with 8 columns + unique index on slug.
--   • BEFORE UPDATE trigger refreshing updated_at (raw-SQL safe).
--   • Seed 7 rows matching the canonical ProductCategory enum values
--     with Thai/English labels and 10-step sort_order gaps.
--   • Seed is idempotent (ON CONFLICT (slug) DO NOTHING).
--
-- Non-goals (explicitly NOT in this migration):
--   • No FK from Product.categoryId → Category.id (deferred to A02/A06).
--   • No DROP or ALTER on products.category enum column (non-breaking).
--   • No RLS policies (deferred to security-hardening wave).

-- ─── Table ──────────────────────────────────────────────────────────────
CREATE TABLE "categories" (
    "id"               UUID         NOT NULL DEFAULT uuid_generate_v4(),
    "slug"             TEXT         NOT NULL,
    "name_th"          TEXT         NOT NULL,
    "name_en"          TEXT         NOT NULL,
    "visible_frontend" BOOLEAN      NOT NULL DEFAULT true,
    "visible_backend"  BOOLEAN      NOT NULL DEFAULT true,
    "sort_order"       INTEGER      NOT NULL DEFAULT 0,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX "categories_slug_key"              ON "categories" ("slug");
CREATE        INDEX "categories_sort_order_idx"        ON "categories" ("sort_order");
CREATE        INDEX "categories_visible_frontend_idx"  ON "categories" ("visible_frontend");

-- ─── updated_at trigger ─────────────────────────────────────────────────
-- Prisma's `@updatedAt` only fires when the ORM issues the UPDATE. Any
-- raw SQL UPDATE (Supabase SQL editor, admin hotfix) would leave the
-- column stale. The BEFORE UPDATE trigger is the belt-and-braces.
CREATE OR REPLACE FUNCTION "set_updated_at"() RETURNS TRIGGER AS $$
BEGIN
    NEW."updated_at" = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "categories_set_updated_at"
    BEFORE UPDATE ON "categories"
    FOR EACH ROW
    EXECUTE FUNCTION "set_updated_at"();

-- ─── Seed (7 rows, canonical ProductCategory enum) ──────────────────────
-- Thai labels: wedding/evening/cocktail sourced from i18n seed
-- (packages/shared/prisma/seed.ts:545-553). Others match product-name
-- conventions from the same file. English labels are title-case.
-- sort_order uses 10-step gaps to leave room for future admin-added
-- categories without mass-renumbering existing rows.
INSERT INTO "categories" ("slug", "name_th", "name_en", "sort_order") VALUES
    ('wedding',     'ชุดแต่งงาน',    'Wedding',     10),
    ('evening',     'ชุดราตรี',       'Evening',     20),
    ('cocktail',    'ค็อกเทล',        'Cocktail',    30),
    ('casual',      'ชุดลำลอง',      'Casual',      40),
    ('costume',     'ชุดแฟนซี',      'Costume',     50),
    ('traditional', 'ชุดไทย',         'Traditional', 60),
    ('accessories', 'เครื่องประดับ',   'Accessories', 70)
ON CONFLICT ("slug") DO NOTHING;
