/**
 * BUG-504-A06 step 1/3 — products.category_id FK scaffolding (RED commit).
 *
 * Background:
 *   A01→A05 landed the `categories` source-of-truth table, public + admin
 *   CRUD endpoints, customer wiring with locale-aware labels, and the
 *   Playwright parity guard. What is NOT yet wired is a real FK from
 *   `products` into `categories`; `products.category` is still the
 *   legacy `ProductCategory` Postgres enum.
 *
 * A06 closes that loop in three sequenced commits on one PR:
 *
 *     commit 1 (THIS one — RED):
 *       • Migration SQL (step 1/3): ADD COLUMN products.category_id UUID NULL
 *         + FK → categories(id) ON DELETE RESTRICT ON UPDATE CASCADE
 *         + index on category_id.
 *       • schema.prisma: add Product.categoryId + Category.products
 *         relation. Client regenerates with the new optional field.
 *       • This test file lands the RED/lock-in assertions. The gates
 *         that require commit 2's GREEN dual-write code path are
 *         present as `test.todo` / `test.skip` with explicit TODO
 *         markers so CI on commit 1 stays green per Qew's rule.
 *
 *     commit 2 (GREEN, held until owner ack on commit 1):
 *       • Step 2/3 SQL: backfill UPDATE products SET category_id = (…),
 *         RAISE EXCEPTION on any residual NULL, ALTER SET NOT NULL,
 *         BEFORE-trigger that dual-writes enum ↔ category_id.
 *       • App-layer dual-write in admin POST /products + reads
 *         flipped to category_id-first.
 *       • Un-skips the integration gates below.
 *
 *     commit 3 (FINAL, held 24h post-commit-2 prod + explicit
 *     `FINAL_CUTOVER` ack):
 *       • Step 3/3 SQL: DROP COLUMN products.category,
 *         DROP TYPE ProductCategory, DELETE system_config row.
 *       • Legacy /api/v1/admin/settings/categories returns 410 Gone
 *         with Sunset header; dual-write code deleted.
 *
 * Gate contract (1–14, summarised in bug504-a06-checkpoint.md §3):
 *   This file lands gates 1, 2, 3 (relaxed — nullable here, NOT NULL
 *   after commit 2), 6, 7, 9, 10, 14 as lock-in / introspection
 *   assertions. Gates 4, 5, 8, 11, 12, 13 are `test.todo` markers
 *   pointing at commit 2/3 RED work.
 *
 *   These assertions operate on on-disk artifacts (schema.prisma +
 *   migration SQL) rather than a live DB connection, mirroring the
 *   A01 seed test. No Postgres access is required from CI.
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

  describe('gate 3 — Product.categoryId field declared (nullable in this commit)', () => {
    it('schema.prisma declares Product.categoryId mapped to category_id @db.Uuid', () => {
      const schema = readSchema();
      // In commit 1 the field is optional (String?). It flips to String
      // (non-null) in commit 2 after backfill. The @map is stable.
      expect(schema).toMatch(
        /categoryId\s+String\?\s+@map\("category_id"\)\s+@db\.Uuid/,
      );
    });

    it('schema.prisma declares Product.categoryRef relation to Category', () => {
      const schema = readSchema();
      expect(schema).toMatch(
        /categoryRef\s+Category\?\s+@relation\(fields:\s*\[categoryId\],\s*references:\s*\[id\]\)/,
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

describe('BUG-504-A06 commit 2 / commit 3 gates (held until those commits land)', () => {
  // gate 4 — admin POST /api/v1/admin/products must write BOTH columns
  // during the transition window. Flipped on in commit 2.
  it.todo(
    'gate 4 — admin POST /products writes category_id alongside category',
  );

  // gate 5 — customer GET /api/v1/products payload shape identical
  // pre/post cutover. Snapshot test added in commit 2 GREEN.
  it.todo(
    'gate 5 — customer GET /products payload unchanged post-cutover',
  );

  // gate 8 — Playwright parity guard stays green on preview. Lives in
  // tests/e2e/categories-parity.spec.ts; CI job `e2e-categories-parity`
  // is the acceptance check, not a vitest case.
  it.todo(
    'gate 8 — Playwright parity guard green on preview (CI job e2e-categories-parity)',
  );

  // gate 9 — rollback of step 1/3 is clean (column + FK + index gone).
  // Exercised manually by owner if rollback is ever needed; vitest case
  // added as a docstring assertion in commit 2.
  it.todo(
    'gate 9 — step 1/3 rollback SQL removes column + FK + index cleanly',
  );

  // gate 10 — rollback of step 2/3 is clean (trigger + function +
  // NOT NULL gone). Added in commit 2.
  it.todo(
    'gate 10 — step 2/3 rollback SQL removes trigger + function + NOT NULL cleanly',
  );

  // gate 11 — legacy /api/v1/admin/settings/categories still returns
  // 200 + Sunset header until commit 3. Covered by the existing A04
  // vitest suite; re-asserted here to lock the commit-2 state.
  it.todo(
    'gate 11 — legacy /admin/settings/categories returns 200 + Sunset through commit 2',
  );

  // gate 12 — after commit 3, legacy route returns 410 Gone. Added in
  // commit 3.
  it.todo(
    'gate 12 — legacy /admin/settings/categories returns 410 Gone after FINAL_CUTOVER',
  );

  // gate 13 — after commit 3, admin product-create writes category_id
  // only. Added in commit 3 as a regression against re-introducing the
  // dual-write path.
  it.todo(
    'gate 13 — admin product-create payload does not include legacy `category` field',
  );
});
