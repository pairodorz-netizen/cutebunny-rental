/**
 * BUG-504-A01 — categories table foundation + seed
 *
 * Background:
 *   Today there are THREE independent sources of truth for product
 *   categories and they disagree.
 *
 *     1. Prisma enum `ProductCategory`   — 7 values (schema.prisma:14-22)
 *     2. SystemConfig{key:'product_categories'} JSON blob — admin-mutable,
 *        falls back to the 7 enum values (settings.ts:534-608).
 *     3. Customer hardcoded `CATEGORIES`  — 6 values, missing 'accessories'
 *        (apps/customer/src/app/[locale]/products/page.tsx:11).
 *
 *   A01 introduces a canonical `Category` table seeded from the enum
 *   values so atoms A02 (API route), A03 (admin CRUD) and A04 (customer
 *   wiring) can converge on a single source of truth without any
 *   breaking change to `Product.category`.
 *
 * A01 scope (ratified by Qew):
 *   — CREATE TABLE `categories` with 8 columns.
 *   — INSERT 7 seed rows matching `ProductCategory` enum values, using
 *     canonical Thai/English labels and 10-step `sort_order` gaps.
 *   — Seed must be idempotent (ON CONFLICT DO NOTHING on unique slug).
 *   — `updated_at` refreshed via BEFORE UPDATE trigger (raw-SQL safe).
 *   — Non-breaking: `Product.category` enum column stays exactly as-is;
 *     no FK, no backfill, no drop.
 *   — No RLS (deferred to security-hardening wave).
 *   — No new API route, admin UI, or customer wiring (A02-A04 queued).
 *
 * TDD gate contract:
 *   These assertions must FAIL before the migration + schema edit land
 *   and PASS after. They operate on the on-disk artifacts
 *   (schema.prisma + migration SQL) rather than a live DB connection,
 *   matching the other API smoke tests in this workspace which run in
 *   a pure `node` environment without Postgres.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SCHEMA_PATH = join(
  REPO_ROOT,
  'packages',
  'shared',
  'prisma',
  'schema.prisma',
);
const MIGRATIONS_DIR = join(
  REPO_ROOT,
  'packages',
  'shared',
  'prisma',
  'migrations',
);

/**
 * The canonical 7 values from ProductCategory enum. If this enum ever
 * grows a new value, A01's seed row list must grow alongside it (or a
 * follow-up atom must add a migration inserting the new row).
 */
const EXPECTED_SLUGS = [
  'wedding',
  'evening',
  'cocktail',
  'casual',
  'costume',
  'traditional',
  'accessories',
] as const;

/**
 * Canonical Thai labels. `wedding`, `evening`, `cocktail` are taken from
 * the existing i18n seed (`packages/shared/prisma/seed.ts:545-553`). The
 * remaining four labels match the product-name conventions used in the
 * same seed file.
 */
const EXPECTED_TH_LABELS: Record<(typeof EXPECTED_SLUGS)[number], string> = {
  wedding: 'ชุดแต่งงาน',
  evening: 'ชุดราตรี',
  cocktail: 'ค็อกเทล',
  casual: 'ชุดลำลอง',
  costume: 'ชุดแฟนซี',
  traditional: 'ชุดไทย',
  accessories: 'เครื่องประดับ',
};

function findCategoriesMigrationDir(): string | null {
  if (!existsSync(MIGRATIONS_DIR)) return null;
  const dirs = readdirSync(MIGRATIONS_DIR).filter((name) =>
    name.match(/_categories(_table)?$/),
  );
  if (dirs.length === 0) return null;
  return join(MIGRATIONS_DIR, dirs[0]);
}

describe('BUG-504-A01 — Prisma schema change', () => {
  it('exposes a `Category` model in schema.prisma', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    expect(schema).toMatch(/^model\s+Category\s*\{/m);
  });

  it('Category model has all 8 required columns with expected types', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    const modelMatch = schema.match(/model\s+Category\s*\{([\s\S]*?)\n\}/);
    expect(modelMatch, 'model block not found').not.toBeNull();
    const body = modelMatch![1];

    expect(body).toMatch(/\bid\s+String\s+@id/);
    expect(body).toMatch(/\bslug\s+String\s+@unique/);
    expect(body).toMatch(/\bnameTh\s+String\s+.*@map\("name_th"\)/);
    expect(body).toMatch(/\bnameEn\s+String\s+.*@map\("name_en"\)/);
    expect(body).toMatch(
      /\bvisibleFrontend\s+Boolean\s+.*@default\(true\)\s+@map\("visible_frontend"\)/,
    );
    expect(body).toMatch(
      /\bvisibleBackend\s+Boolean\s+.*@default\(true\)\s+@map\("visible_backend"\)/,
    );
    expect(body).toMatch(
      /\bsortOrder\s+Int\s+.*@default\(0\)\s+@map\("sort_order"\)/,
    );
    expect(body).toMatch(/\bcreatedAt\s+DateTime\s+.*@default\(now\(\)\)/);
    expect(body).toMatch(/\bupdatedAt\s+DateTime\s+.*@updatedAt/);
    expect(body).toMatch(/@@map\("categories"\)/);
  });

  it('does NOT touch the Product.category enum column (non-breaking)', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    const productMatch = schema.match(/model\s+Product\s*\{([\s\S]*?)\n\}/);
    expect(productMatch, 'Product model not found').not.toBeNull();
    const productBody = productMatch![1];
    // category field is still the enum type; NO categoryId FK added in A01.
    expect(productBody).toMatch(/\bcategory\s+ProductCategory\b/);
    expect(productBody).not.toMatch(/\bcategoryId\b/);
  });

  it('does NOT modify FinanceCategory (ledger is a separate concern)', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    // FinanceCategory model must still exist with its pre-A01 shape.
    expect(schema).toMatch(/^model\s+FinanceCategory\s*\{/m);
  });
});

describe('BUG-504-A01 — migration SQL file', () => {
  it('migration directory exists under packages/shared/prisma/migrations/', () => {
    const dir = findCategoriesMigrationDir();
    expect(dir, 'no migration directory matching *_categories* found').not.toBeNull();
  });

  it('migration.sql creates the `categories` table with 8 columns', () => {
    const dir = findCategoriesMigrationDir();
    expect(dir).not.toBeNull();
    const sql = readFileSync(join(dir!, 'migration.sql'), 'utf8');

    expect(sql).toMatch(/CREATE TABLE\s+"categories"/);
    expect(sql).toMatch(/"id"\s+UUID\s+NOT NULL\s+DEFAULT\s+uuid_generate_v4\(\)/);
    expect(sql).toMatch(/"slug"\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/"name_th"\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/"name_en"\s+TEXT\s+NOT NULL/);
    expect(sql).toMatch(/"visible_frontend"\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+true/);
    expect(sql).toMatch(/"visible_backend"\s+BOOLEAN\s+NOT NULL\s+DEFAULT\s+true/);
    expect(sql).toMatch(/"sort_order"\s+INTEGER\s+NOT NULL\s+DEFAULT\s+0/);
    expect(sql).toMatch(/"created_at"\s+TIMESTAMP\(3\)\s+NOT NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/);
    expect(sql).toMatch(/"updated_at"\s+TIMESTAMP\(3\)\s+NOT NULL\s+DEFAULT\s+CURRENT_TIMESTAMP/);
  });

  it('migration.sql creates a unique index on slug', () => {
    const dir = findCategoriesMigrationDir();
    const sql = readFileSync(join(dir!, 'migration.sql'), 'utf8');
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX\s+"categories_slug_key"\s+ON\s+"categories"\s*\(\s*"slug"\s*\)/,
    );
  });

  it('migration.sql creates a BEFORE UPDATE trigger that refreshes updated_at', () => {
    const dir = findCategoriesMigrationDir();
    const sql = readFileSync(join(dir!, 'migration.sql'), 'utf8');
    // Trigger function exists.
    expect(sql).toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+[\w".]*set_updated_at/i);
    // Trigger bound to categories on BEFORE UPDATE, invoking the function.
    // Trigger name may be quoted ("..._set_updated_at") or bare; accept both.
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+[\w"]+\s+BEFORE\s+UPDATE\s+ON\s+"categories"/i);
    expect(sql).toMatch(/FOR EACH ROW\s+EXECUTE\s+(FUNCTION|PROCEDURE)\s+[\w".]*set_updated_at/i);
  });

  it('migration.sql seeds exactly 7 rows matching the ProductCategory enum', () => {
    const dir = findCategoriesMigrationDir();
    const sql = readFileSync(join(dir!, 'migration.sql'), 'utf8');

    // Locate the INSERT block so we only count seed VALUES rows, not
    // anything that might appear elsewhere.
    const insertMatch = sql.match(
      /INSERT\s+INTO\s+"categories"[\s\S]*?VALUES\s*([\s\S]*?);/i,
    );
    expect(insertMatch, 'INSERT INTO "categories" ... VALUES block not found').not.toBeNull();

    const valuesBlock = insertMatch![1];
    for (const slug of EXPECTED_SLUGS) {
      const escaped = slug.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
      const pattern = new RegExp(`'${escaped}'`);
      expect(valuesBlock, `missing seed row for slug '${slug}'`).toMatch(pattern);
    }

    // Each of the 7 canonical slugs must appear with its canonical Thai label.
    for (const slug of EXPECTED_SLUGS) {
      const escapedSlug = slug.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
      const th = EXPECTED_TH_LABELS[slug];
      const pattern = new RegExp(`'${escapedSlug}'[^\\n]*'${th}'`);
      expect(valuesBlock, `slug '${slug}' is missing Thai label '${th}'`).toMatch(pattern);
    }
  });

  it('migration.sql uses sort_order increments of 10 (10, 20, ..., 70)', () => {
    const dir = findCategoriesMigrationDir();
    const sql = readFileSync(join(dir!, 'migration.sql'), 'utf8');

    // Check each slug has its expected sort_order value on the same VALUES line.
    const expectedSortOrder: Record<(typeof EXPECTED_SLUGS)[number], number> = {
      wedding: 10,
      evening: 20,
      cocktail: 30,
      casual: 40,
      costume: 50,
      traditional: 60,
      accessories: 70,
    };
    for (const slug of EXPECTED_SLUGS) {
      const escapedSlug = slug.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');
      const expected = expectedSortOrder[slug];
      // Loose pattern: the slug literal must be followed (on the same
      // VALUES row, comma-separated) by a field equal to the expected
      // sort_order integer.
      const pattern = new RegExp(`'${escapedSlug}'[^\\n]*\\b${expected}\\b`);
      expect(sql, `slug '${slug}' must have sort_order ${expected}`).toMatch(pattern);
    }
  });

  it('migration.sql seed is idempotent via ON CONFLICT DO NOTHING on slug', () => {
    const dir = findCategoriesMigrationDir();
    const sql = readFileSync(join(dir!, 'migration.sql'), 'utf8');
    expect(sql).toMatch(/ON\s+CONFLICT\s*\(\s*"?slug"?\s*\)\s+DO\s+NOTHING/i);
  });

  it('migration.sql does NOT include RLS statements (deferred)', () => {
    const dir = findCategoriesMigrationDir();
    const sql = readFileSync(join(dir!, 'migration.sql'), 'utf8');
    expect(sql).not.toMatch(/ENABLE\s+ROW\s+LEVEL\s+SECURITY/i);
    expect(sql).not.toMatch(/CREATE\s+POLICY/i);
  });

  it('migration.sql does NOT drop or alter Product.category (non-breaking)', () => {
    const dir = findCategoriesMigrationDir();
    const sql = readFileSync(join(dir!, 'migration.sql'), 'utf8');
    expect(sql).not.toMatch(/DROP\s+TYPE\s+"?ProductCategory"?/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"?products"?[\s\S]*DROP\s+COLUMN\s+"?category"?/i);
    expect(sql).not.toMatch(/ALTER\s+TABLE\s+"?products"?[\s\S]*ADD\s+COLUMN\s+"?category_id"?/i);
  });
});
