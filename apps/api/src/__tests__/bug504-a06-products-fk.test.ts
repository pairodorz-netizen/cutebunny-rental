/**
 * BUG-504-A06 products.category_id FK cutover — commit 1 (RED) +
 * commit 2 (GREEN) gates on a single PR.
 *
 * Commit 1 (merged as main@24ccc82):
 *   • Step 1/3 SQL (manually applied on prod Supabase hcmfohyzetykjsfwtrjt):
 *     ADD COLUMN products.category_id UUID NULL + FK → categories(id)
 *     ON DELETE RESTRICT ON UPDATE CASCADE + index.
 *   • schema.prisma: Product.categoryId (nullable), Product.categoryRef,
 *     Category.products backref.
 *   • RED introspection gates 1, 2, 3, 6, 7, 14.
 *
 * Commit 2 (THIS file's new gates):
 *   • Step 2/3 SQL: backfill UPDATE products SET category_id FROM
 *     categories c WHERE c.slug = p.category::text (1:1 trivial map),
 *     RAISE EXCEPTION on residual NULL, ALTER SET NOT NULL,
 *     BEFORE INSERT/UPDATE trigger `products_sync_category_trg` that
 *     keeps the two columns in sync on every write.
 *   • schema.prisma: Product.categoryId promoted to `String`
 *     (non-optional). Product.categoryRef promoted to `Category`.
 *   • apps/api: `resolveCategoryPair()` helper in admin/products.ts;
 *     POST + PATCH + CSV bulk import all dual-write. Read payloads
 *     (admin list + admin detail) expose both `category` and
 *     `category_id`.
 *   • Activates gates 4, 5, 9, 10.
 *
 * Commit 3 (FINAL, gated by 24h-post-commit-2-prod + explicit
 * `FINAL_CUTOVER` ack):
 *   • Step 3/3 SQL: DROP COLUMN products.category, DROP TYPE
 *     ProductCategory, delete legacy system_config row.
 *   • Legacy /api/v1/admin/settings/categories returns 410 Gone +
 *     Sunset header (RFC 8594). Dual-write helper + PATCH branch
 *     deleted.
 *   • Activates gates 12, 13. Gate 8 (Playwright parity) stays green
 *     across all three commits.
 *
 * All assertions here operate on on-disk artifacts (schema.prisma,
 * migration SQL, admin/products.ts source) rather than a live DB
 * connection — CI stays DATABASE_URL-less, mirroring the A01 / A06
 * commit 1 pattern.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');
const SCHEMA_PATH = join(
  REPO_ROOT,
  'packages',
  'shared',
  'prisma',
  'schema.prisma',
);
const STEP_1_MIGRATION_PATH = join(
  REPO_ROOT,
  'packages',
  'shared',
  'prisma',
  'migrations',
  '20260422_010_products_category_id_fk',
  'migration.sql',
);

const readSchema = (): string => readFileSync(SCHEMA_PATH, 'utf8');
const readStep1Migration = (): string =>
  readFileSync(STEP_1_MIGRATION_PATH, 'utf8');

/**
 * Canonical ProductCategory enum values. Must match the A01 seed
 * verbatim (bug504-a01-checkpoint.md §Seed). Kept as a literal here so
 * a drift in either direction (enum OR seed) trips a gate.
 */
const CANONICAL_SLUGS = [
  'wedding',
  'evening',
  'cocktail',
  'casual',
  'costume',
  'traditional',
  'accessories',
] as const;

describe('BUG-504-A06 step 1/3 — products.category_id FK scaffolding', () => {
  describe('gate 1 — mapping complete (every enum value has a seeded slug)', () => {
    it('every ProductCategory enum literal appears in the canonical slug list', () => {
      const schema = readSchema();
      // Extract the enum ProductCategory { … } block.
      const match = schema.match(/enum ProductCategory\s*{([^}]+)}/);
      expect(
        match,
        'schema.prisma must declare `enum ProductCategory { … }`',
      ).not.toBeNull();
      const enumValues = match![1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('//'));
      for (const value of enumValues) {
        expect(
          CANONICAL_SLUGS.includes(value as (typeof CANONICAL_SLUGS)[number]),
          `enum value ${value} must have a seeded slug in categories (A01)`,
        ).toBe(true);
      }
    });
  });

  describe('gate 2 — no unseeded extras (symmetric mapping)', () => {
    it('every canonical slug appears as a ProductCategory enum value', () => {
      const schema = readSchema();
      const match = schema.match(/enum ProductCategory\s*{([^}]+)}/);
      expect(match).not.toBeNull();
      const enumValues = new Set(
        match![1]
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0 && !line.startsWith('//')),
      );
      for (const slug of CANONICAL_SLUGS) {
        expect(
          enumValues.has(slug),
          `canonical slug ${slug} must be a ProductCategory enum value`,
        ).toBe(true);
      }
    });
  });

  describe('gate 3 — Product.categoryId field declared (non-null after commit 2 backfill)', () => {
    it('schema.prisma declares Product.categoryId (non-optional) mapped to category_id @db.Uuid', () => {
      const schema = readSchema();
      const productBlock = schema.match(/model\s+Product\s*\{([\s\S]*?)\n\}/);
      expect(productBlock, 'Product model not found').not.toBeNull();
      const body = productBlock![1];
      // Commit 2 promotes the field to `String` (non-optional) after
      // the step 2/3 backfill verifies zero residual NULLs and flips
      // the column to NOT NULL at the DB layer. Scoped to the Product
      // model block so other models' (e.g. FinanceTransaction's)
      // unrelated `categoryId String?` FKs don't false-positive.
      expect(body).toMatch(
        /categoryId\s+String\s+@map\("category_id"\)\s+@db\.Uuid/,
      );
      expect(body).not.toMatch(
        /categoryId\s+String\?\s+@map\("category_id"\)/,
      );
    });

    it('schema.prisma declares Product.categoryRef relation to Category (non-optional)', () => {
      const schema = readSchema();
      expect(schema).toMatch(
        /categoryRef\s+Category\s+@relation\(fields:\s*\[categoryId\],\s*references:\s*\[id\]\)/,
      );
    });

    it('schema.prisma declares Category.products backref', () => {
      const schema = readSchema();
      // Anchor inside the Category model block to avoid a false positive
      // from any other `products Product[]` that might appear later.
      const categoryBlock = schema.match(/model Category\s*{[\s\S]*?\n}/);
      expect(categoryBlock).not.toBeNull();
      expect(categoryBlock![0]).toMatch(/products\s+Product\[\]/);
    });
  });

  describe('gate 3 — migration SQL step 1/3 shape', () => {
    it('migration file exists', () => {
      expect(existsSync(STEP_1_MIGRATION_PATH)).toBe(true);
    });

    it('adds the nullable category_id column', () => {
      const sql = readStep1Migration();
      expect(sql).toMatch(
        /ALTER TABLE\s+"products"\s*\s+ADD COLUMN\s+"category_id"\s+UUID\s+NULL/i,
      );
    });

    it('adds the FK with ON DELETE RESTRICT ON UPDATE CASCADE', () => {
      const sql = readStep1Migration();
      expect(sql).toMatch(
        /ADD CONSTRAINT\s+"products_category_id_fkey"\s+FOREIGN KEY\s*\(\s*"category_id"\s*\)\s+REFERENCES\s+"categories"\s*\(\s*"id"\s*\)\s+ON DELETE RESTRICT\s+ON UPDATE CASCADE/i,
      );
    });

    it('creates the lookup index', () => {
      const sql = readStep1Migration();
      expect(sql).toMatch(
        /CREATE INDEX\s+"products_category_id_idx"\s+ON\s+"products"\s*\(\s*"category_id"\s*\)/i,
      );
    });

    it('does NOT flip NOT NULL in this commit (deferred to commit 2)', () => {
      const sql = readStep1Migration();
      // Only match active SQL, not rollback comments.
      const active = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      expect(active).not.toMatch(/SET NOT NULL/i);
    });

    it('does NOT contain a backfill UPDATE in this commit (deferred to commit 2)', () => {
      const sql = readStep1Migration();
      const active = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      expect(active).not.toMatch(/UPDATE\s+"products"/i);
    });

    it('does NOT drop the enum column or type in this commit (deferred to commit 3)', () => {
      const sql = readStep1Migration();
      const active = sql
        .split('\n')
        .filter((line) => !line.trim().startsWith('--'))
        .join('\n');
      expect(active).not.toMatch(/DROP\s+COLUMN\s+"category"/i);
      expect(active).not.toMatch(/DROP\s+TYPE\s+"ProductCategory"/i);
    });
  });

  describe('gate 6 — A02 public GET /api/v1/categories surface unchanged', () => {
    it('the A02 public route is still mounted at /api/v1/categories', () => {
      const indexPath = join(
        REPO_ROOT,
        'apps',
        'api',
        'src',
        'index.ts',
      );
      const source = readFileSync(indexPath, 'utf8');
      expect(source).toMatch(
        /app\.route\(\s*['"`]\/api\/v1\/categories['"`]/,
      );
    });
  });

  describe('gate 7 — A03 admin CRUD surface unchanged', () => {
    it('the A03 admin route is still mounted at /api/v1/admin/categories', () => {
      const indexPath = join(
        REPO_ROOT,
        'apps',
        'api',
        'src',
        'index.ts',
      );
      const source = readFileSync(indexPath, 'utf8');
      expect(source).toMatch(
        /app\.route\(\s*['"`]\/api\/v1\/admin\/categories['"`]/,
      );
    });
  });

  describe('gate 14 — no other FK declares a reference into products.category', () => {
    it('schema.prisma has exactly one `@relation` field pointing at Category via products.categoryId', () => {
      const schema = readSchema();
      // Count relations that reference the Category model. Anything
      // outside Product.categoryRef would be unexpected and would imply
      // a parallel FK path we'd need to cut over in commit 3.
      const productRelations = (
        schema.match(/\bCategory\??\s+@relation\(/g) ?? []
      ).length;
      expect(
        productRelations,
        'only Product.categoryRef should declare @relation(Category) — found multiple',
      ).toBe(1);
    });

    it('no schema field claims to reference products.category via `references: [category]`', () => {
      const schema = readSchema();
      expect(schema).not.toMatch(/references:\s*\[\s*category\s*\]/);
    });
  });
});

// ─── Commit 2 gates (active) ────────────────────────────────────────────
const STEP_2_MIGRATION_PATH = join(
  REPO_ROOT,
  'packages',
  'shared',
  'prisma',
  'migrations',
  '20260422_020_products_category_id_backfill_dualwrite',
  'migration.sql',
);
const ADMIN_PRODUCTS_PATH = join(
  REPO_ROOT,
  'apps',
  'api',
  'src',
  'routes',
  'admin',
  'products.ts',
);
const readStep2Migration = (): string =>
  readFileSync(STEP_2_MIGRATION_PATH, 'utf8');
const readAdminProducts = (): string =>
  readFileSync(ADMIN_PRODUCTS_PATH, 'utf8');
const stripSqlComments = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');

describe('BUG-504-A06 step 2/3 — backfill + dual-write trigger (commit 2)', () => {
  describe('gate — migration SQL step 2/3 shape', () => {
    it('migration file exists', () => {
      expect(existsSync(STEP_2_MIGRATION_PATH)).toBe(true);
    });

    it('backfills category_id via a 1:1 slug join (active SQL, not comment)', () => {
      const active = stripSqlComments(readStep2Migration());
      expect(active).toMatch(
        /UPDATE\s+"products"[\s\S]*?SET\s+"category_id"\s*=\s*c\.id[\s\S]*?FROM\s+"categories"[\s\S]*?c\.slug\s*=\s*p\.category::text/i,
      );
    });

    it('scopes the backfill to rows where category_id is still NULL (idempotent re-run)', () => {
      const active = stripSqlComments(readStep2Migration());
      expect(active).toMatch(/p\.category_id\s+IS\s+NULL/i);
    });

    it('raises an exception if any products are left with NULL category_id after backfill', () => {
      const active = stripSqlComments(readStep2Migration());
      // The DO block must both count residual NULLs and RAISE on > 0.
      expect(active).toMatch(
        /COUNT\(\*\)\s+INTO\s+\w+\s+FROM\s+"products"\s+WHERE\s+"category_id"\s+IS\s+NULL/i,
      );
      expect(active).toMatch(/RAISE\s+EXCEPTION/i);
    });

    it('flips category_id to NOT NULL after backfill verification', () => {
      const active = stripSqlComments(readStep2Migration());
      expect(active).toMatch(
        /ALTER\s+TABLE\s+"products"[\s\S]*?ALTER\s+COLUMN\s+"category_id"\s+SET\s+NOT\s+NULL/i,
      );
    });

    it('creates the dual-write trigger function with the exact name', () => {
      const active = stripSqlComments(readStep2Migration());
      expect(active).toMatch(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+"products_sync_category"\(\)/i,
      );
    });

    it('trigger function handles enum-only, FK-only, and both-supplied inputs', () => {
      const active = stripSqlComments(readStep2Migration());
      // enum-only branch derives FK from slug
      expect(active).toMatch(
        /NEW\.category\s+IS\s+NOT\s+NULL\s+AND\s+NEW\.category_id\s+IS\s+NULL/i,
      );
      // FK-only branch derives enum from slug
      expect(active).toMatch(
        /NEW\.category\s+IS\s+NULL\s+AND\s+NEW\.category_id\s+IS\s+NOT\s+NULL/i,
      );
      // both-supplied branch validates symmetry
      expect(active).toMatch(
        /NEW\.category\s+IS\s+NOT\s+NULL\s+AND\s+NEW\.category_id\s+IS\s+NOT\s+NULL/i,
      );
    });

    it('trigger function raises on mismatched enum ↔ FK pair', () => {
      // Scanning inside a function body (enclosed in $$ … $$) — RAISE is
      // in a line that is NOT an SQL comment in the surrounding file so
      // it survives stripSqlComments. Use the raw body for safety.
      const sql = readStep2Migration();
      expect(sql).toMatch(
        /products\.category\s+\(%\)\s+and\s+products\.category_id\s+\(%\)\s+refer\s+to\s+different\s+categories/i,
      );
    });

    it('installs the BEFORE INSERT OR UPDATE trigger on products', () => {
      const active = stripSqlComments(readStep2Migration());
      expect(active).toMatch(
        /CREATE\s+TRIGGER\s+"products_sync_category_trg"\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+"products"\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+"products_sync_category"\(\)/i,
      );
    });

    it('idempotent DROP TRIGGER IF EXISTS guards re-run of the whole file', () => {
      const active = stripSqlComments(readStep2Migration());
      expect(active).toMatch(
        /DROP\s+TRIGGER\s+IF\s+EXISTS\s+"products_sync_category_trg"\s+ON\s+"products"/i,
      );
    });
  });

  describe('gate 9 — step 1/3 rollback SQL present (column + FK + index)', () => {
    it('step 1/3 migration includes commented rollback for the column', () => {
      const sql = readStep1Migration();
      // Rollback lives in a trailing comment block. Scanning the raw
      // file (comments included) ensures operators can discover it
      // when they open the migration.
      expect(sql).toMatch(
        /--[^\n]*ALTER\s+TABLE\s+"products"\s+DROP\s+COLUMN[^\n]*"category_id"/i,
      );
    });

    it('step 1/3 migration includes commented rollback for the FK', () => {
      const sql = readStep1Migration();
      expect(sql).toMatch(
        /--[^\n]*ALTER\s+TABLE\s+"products"\s+DROP\s+CONSTRAINT[^\n]*"products_category_id_fkey"/i,
      );
    });

    it('step 1/3 migration includes commented rollback for the index', () => {
      const sql = readStep1Migration();
      expect(sql).toMatch(
        /--[^\n]*DROP\s+INDEX[^\n]*"products_category_id_idx"/i,
      );
    });
  });

  describe('gate 10 — step 2/3 rollback SQL present (trigger + function + NOT NULL)', () => {
    it('step 2/3 migration includes commented rollback for the trigger', () => {
      const sql = readStep2Migration();
      expect(sql).toMatch(
        /--[^\n]*DROP\s+TRIGGER\s+IF\s+EXISTS\s+"products_sync_category_trg"/i,
      );
    });

    it('step 2/3 migration includes commented rollback for the trigger function', () => {
      const sql = readStep2Migration();
      expect(sql).toMatch(
        /--[^\n]*DROP\s+FUNCTION\s+IF\s+EXISTS\s+"products_sync_category"\(\)/i,
      );
    });

    it('step 2/3 migration includes commented rollback to relax NOT NULL', () => {
      const sql = readStep2Migration();
      expect(sql).toMatch(
        /--[^\n]*ALTER\s+TABLE\s+"products"\s+ALTER\s+COLUMN\s+"category_id"\s+DROP\s+NOT\s+NULL/i,
      );
    });
  });

  describe('gate 4 — admin POST /products dual-writes category AND category_id', () => {
    it('admin/products.ts declares the resolveCategoryPair helper', () => {
      const source = readAdminProducts();
      expect(source).toMatch(
        /export\s+(async\s+)?function\s+resolveCategoryPair\s*\(/,
      );
    });

    it('POST / handler invokes resolveCategoryPair before db.product.create', () => {
      const source = readAdminProducts();
      // Anchor: the POST handler starts at `adminProducts.post('/',`. We
      // capture everything up to the next `adminProducts.post(` or
      // `adminProducts.patch(`.
      const postHandlerMatch = source.match(
        /adminProducts\.post\(\s*['"]\/['"],[\s\S]*?(?=adminProducts\.(post|patch|get|delete)\()/,
      );
      expect(postHandlerMatch, 'POST / handler not found').not.toBeNull();
      const body = postHandlerMatch![0];
      expect(body).toMatch(/resolveCategoryPair\(/);
      expect(body).toMatch(/db\.product\.create\(/);
      // The resolver call must precede the create call.
      const resolverIdx = body.indexOf('resolveCategoryPair(');
      const createIdx = body.indexOf('db.product.create(');
      expect(resolverIdx).toBeGreaterThanOrEqual(0);
      expect(createIdx).toBeGreaterThan(resolverIdx);
    });

    it('POST / create payload writes both category and categoryId', () => {
      const source = readAdminProducts();
      const postHandlerMatch = source.match(
        /adminProducts\.post\(\s*['"]\/['"],[\s\S]*?(?=adminProducts\.(post|patch|get|delete)\()/,
      );
      expect(postHandlerMatch).not.toBeNull();
      const body = postHandlerMatch![0];
      expect(body).toMatch(/category:\s*resolvedCategory/);
      expect(body).toMatch(/categoryId:\s*resolvedCategoryId/);
    });

    it('PATCH /:id dual-writes category and categoryRef when either field is supplied', () => {
      const source = readAdminProducts();
      const patchHandlerMatch = source.match(
        /adminProducts\.patch\(\s*['"]\/:id['"],[\s\S]*?(?=adminProducts\.(post|patch|get|delete)\()/,
      );
      expect(patchHandlerMatch, 'PATCH /:id handler not found').not.toBeNull();
      const body = patchHandlerMatch![0];
      expect(body).toMatch(/resolveCategoryPair\(/);
      expect(body).toMatch(/updateData\.category\s*=/);
      expect(body).toMatch(/updateData\.categoryRef\s*=/);
    });

    it('POST body schema accepts either category (slug) or category_id (UUID)', () => {
      const source = readAdminProducts();
      const postHandlerMatch = source.match(
        /adminProducts\.post\(\s*['"]\/['"],[\s\S]*?(?=adminProducts\.(post|patch|get|delete)\()/,
      );
      expect(postHandlerMatch).not.toBeNull();
      const body = postHandlerMatch![0];
      expect(body).toMatch(/category:\s*z\.string\(\)\.min\(1\)\.optional\(\)/);
      expect(body).toMatch(/category_id:\s*z\.string\(\)\.uuid\(\)\.optional\(\)/);
    });

    it('resolver rejects when neither category nor category_id supplied', () => {
      const source = readAdminProducts();
      expect(source).toMatch(
        /Either\s+`category`\s+\(slug\)\s+or\s+`category_id`\s+\(UUID\)\s+must\s+be\s+provided/,
      );
    });

    it('resolver rejects mismatched category / category_id pair', () => {
      const source = readAdminProducts();
      expect(source).toMatch(/CATEGORY_MISMATCH/);
      expect(source).toMatch(
        /does\s+not\s+match\s+category_id/,
      );
    });
  });

  describe('gate 5 — read payloads expose category_id alongside category', () => {
    it('GET /admin/products list response includes category_id', () => {
      const source = readAdminProducts();
      // The list-response projection is the first `const data = products.map(`.
      const listProjection = source.match(
        /const\s+data\s*=\s*products\.map\(\(p\)\s*=>\s*\(\{[\s\S]*?\}\)\);/,
      );
      expect(listProjection, 'list projection not found').not.toBeNull();
      const body = listProjection![0];
      expect(body).toMatch(/category:\s*p\.category/);
      expect(body).toMatch(/category_id:\s*p\.categoryId/);
    });

    it('GET /admin/products/:id detail response includes category_id', () => {
      const source = readAdminProducts();
      // Anchor: the detail handler terminates its return in a `success(c, { … })` block
      // containing `brand_id: product.brandId`.
      const detailMatch = source.match(
        /return\s+success\(c,\s*\{[\s\S]*?brand_id:\s*product\.brandId,[\s\S]*?\}\);/,
      );
      expect(detailMatch, 'detail projection not found').not.toBeNull();
      const body = detailMatch![0];
      expect(body).toMatch(/category:\s*product\.category/);
      expect(body).toMatch(/category_id:\s*product\.categoryId/);
    });

    it('POST /admin/products 201 response includes category_id', () => {
      const source = readAdminProducts();
      // Find the `created(c, { … })` return block that sits inside POST '/'.
      const createdReturnMatch = source.match(
        /return\s+created\(c,\s*\{[\s\S]*?id:\s*product\.id,[\s\S]*?category:\s*product\.category,[\s\S]*?\}\);/,
      );
      expect(createdReturnMatch, 'POST created() envelope not found').not.toBeNull();
      const body = createdReturnMatch![0];
      expect(body).toMatch(/category_id:\s*product\.categoryId/);
    });
  });
});

// ─── Commit 3 gates (still held) ────────────────────────────────────────
describe('BUG-504-A06 commit 3 gates (held until FINAL_CUTOVER)', () => {
  // gate 8 — Playwright parity guard lives in
  // tests/e2e/categories-parity.spec.ts; CI job `e2e-categories-parity`
  // is the acceptance check on every PR, not a vitest case.
  it.todo(
    'gate 8 — Playwright parity guard green on preview (CI job e2e-categories-parity)',
  );

  // gate 11 — legacy /api/v1/admin/settings/categories still returns
  // 200 + Sunset header through commit 2. Covered by the existing A04
  // vitest suite (bug504-a04-customer-wiring.test.ts).
  it.todo(
    'gate 11 — legacy /admin/settings/categories returns 200 + Sunset through commit 2',
  );

  // gate 12 — after commit 3, legacy route returns 410 Gone + Sunset
  // (RFC 8594 honest). Added in commit 3.
  it.todo(
    'gate 12 — legacy /admin/settings/categories returns 410 Gone after FINAL_CUTOVER',
  );

  // gate 13 — after commit 3, admin product-create writes category_id
  // only (enum column + ProductCategory type dropped). Regression guard
  // against re-introducing the dual-write path.
  it.todo(
    'gate 13 — admin product-create payload does not include legacy `category` field',
  );
});
