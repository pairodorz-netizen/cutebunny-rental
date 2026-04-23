/**
 * BUG-RLS-03 — drift guard for the function search_path hardening.
 *
 * Two-layer pattern, same shape as BUG-RLS-02 tests:
 *
 *   Layer 1 — always runs in CI. Parses the migration SQL and
 *   asserts:
 *     * a bare `ALTER FUNCTION public.set_updated_at() SET
 *       search_path = ''` exists.
 *     * a `CREATE OR REPLACE FUNCTION public.products_sync_category()`
 *       statement exists, carries the `SET search_path = ''`
 *       attribute, and its body uses schema-qualified references
 *       to `public.categories` and `public.ProductCategory`
 *       (i.e. no unqualified lookups remain that would fail
 *       under `search_path = ''`).
 *
 *   Layer 2 — runs only when DATABASE_URL is set. Queries
 *   pg_proc.proconfig on the real schema and asserts both
 *   functions carry a `search_path=` entry.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const MIGRATION_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'packages',
  'shared',
  'prisma',
  'migrations',
  '20260424_090_fix_function_search_path',
  'migration.sql',
);

const FUNCTIONS = ['set_updated_at', 'products_sync_category'] as const;

describe('BUG-RLS-03 — pin search_path on set_updated_at + products_sync_category', () => {
  describe('layer 1 — migration file shape (CI-safe, always runs)', () => {
    it('the migration file exists', () => {
      expect(existsSync(MIGRATION_PATH)).toBe(true);
    });

    it('applies `SET search_path = \'\'` to public.set_updated_at via ALTER FUNCTION', () => {
      const sql = readFileSync(MIGRATION_PATH, 'utf8');
      // Accept either the bare identifier or the schema-qualified
      // form, with single- or double-quoted empty string.
      const pattern =
        /ALTER\s+FUNCTION\s+(?:"?public"?\.)?"?set_updated_at"?\s*\(\s*\)\s+SET\s+search_path\s*=\s*''\s*;/i;
      expect(pattern.test(sql)).toBe(true);
    });

    it('recreates public.products_sync_category with SET search_path = \'\' + schema-qualified body', () => {
      const sql = readFileSync(MIGRATION_PATH, 'utf8');

      // Presence of CREATE OR REPLACE FUNCTION on the target.
      const createPattern =
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+"public"\."products_sync_category"\s*\(\s*\)/i;
      expect(createPattern.test(sql)).toBe(true);

      // Extract the function body (everything between the function's
      // `AS $$ ... $$` markers) so body assertions can't false-match
      // on surrounding comments.
      const bodyMatch = sql.match(
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+"public"\."products_sync_category"[\s\S]*?AS\s+\$\$([\s\S]+?)\$\$;/i,
      );
      expect(
        bodyMatch,
        'CREATE OR REPLACE FUNCTION products_sync_category(...) AS $$...$$ block not found',
      ).not.toBeNull();
      const body = bodyMatch![1];

      // The function attributes block (between the signature and
      // the body's AS $$) must carry `SET search_path = ''`.
      const attrBlock = sql.slice(
        sql.search(createPattern),
        sql.search(/AS\s+\$\$/i),
      );
      expect(
        /SET\s+search_path\s*=\s*''/i.test(attrBlock),
        'products_sync_category must declare SET search_path = \'\' in its attribute block',
      ).toBe(true);

      // Body must use schema-qualified references — no bare
      // `"categories"` or `"ProductCategory"` lookups that would
      // fail to resolve under search_path=''.
      const bareCategories = body.match(/FROM\s+"categories"(?!\w)/gi) ?? [];
      expect(
        bareCategories.length,
        `body contains ${bareCategories.length} unqualified "categories" reference(s); must be "public"."categories"`,
      ).toBe(0);

      const qualifiedCategories =
        body.match(/FROM\s+"public"\."categories"(?!\w)/gi) ?? [];
      expect(
        qualifiedCategories.length,
        'body must reference FROM "public"."categories" at least once',
      ).toBeGreaterThanOrEqual(1);

      const bareEnumCast = body.match(/::"ProductCategory"/g) ?? [];
      expect(
        bareEnumCast.length,
        `body contains ${bareEnumCast.length} unqualified ::"ProductCategory" cast(s); must be ::"public"."ProductCategory"`,
      ).toBe(0);

      const qualifiedEnumCast =
        body.match(/::"public"\."ProductCategory"/g) ?? [];
      expect(
        qualifiedEnumCast.length,
        'body must reference ::"public"."ProductCategory" at least once',
      ).toBeGreaterThanOrEqual(1);
    });

    it('the migration is wrapped in a single BEGIN / COMMIT', () => {
      const sql = readFileSync(MIGRATION_PATH, 'utf8');
      const begins = sql.match(/^\s*BEGIN\s*;/gim) ?? [];
      const commits = sql.match(/^\s*COMMIT\s*;/gim) ?? [];
      expect(begins.length).toBe(1);
      expect(commits.length).toBe(1);
    });
  });

  describe('layer 2 — live pg_proc verification (requires DATABASE_URL)', () => {
    const hasDbUrl = Boolean(process.env.DATABASE_URL);

    it.skipIf(!hasDbUrl)(
      'pg_proc.proconfig contains search_path= on both functions',
      async () => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();
        try {
          const rows = await prisma.$queryRaw<
            Array<{ proname: string; proconfig: string[] | null }>
          >`
            SELECT p.proname, p.proconfig
            FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public'
              AND p.proname = ANY(${[...FUNCTIONS]})
          `;

          for (const name of FUNCTIONS) {
            const match = rows.find((r) => r.proname === name);
            expect(
              match,
              `prod missing pg_proc row for public.${name}`,
            ).toBeDefined();
            const cfg = match!.proconfig ?? [];
            const hasSearchPath = cfg.some((s) =>
              s.toLowerCase().startsWith('search_path='),
            );
            expect(
              hasSearchPath,
              `public.${name}.proconfig must contain a search_path= entry; got ${JSON.stringify(cfg)}`,
            ).toBe(true);
          }
        } finally {
          await prisma.$disconnect();
        }
      },
    );
  });
});
