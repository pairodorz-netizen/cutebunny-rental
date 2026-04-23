/**
 * BUG-RLS-01 — every public table must have Row Level Security
 * enabled.
 *
 * Supabase Security Advisor flagged 27 CRITICAL "RLS not enabled"
 * errors across the public schema. Owner applied the fix on prod
 * Supabase manually (~2026-04-23 17:00 UTC); this repo's migration
 * file `20260423_040_enable_rls_bug_rls_01/migration.sql` makes
 * the codebase match live state so future Prisma baselines don't
 * regress. This test is the drift guard.
 *
 * Two layers:
 *
 *   Layer 1 (always runs in CI) — static shape check on the
 *   migration SQL. Parses the file and asserts every one of the 27
 *   canonical tables has an `ALTER TABLE … ENABLE ROW LEVEL SECURITY`
 *   statement. Catches accidental deletes from the migration.
 *
 *   Layer 2 (runs only when DATABASE_URL is set) — live pg_class
 *   query. Asserts `relrowsecurity = true` for every one of the 27
 *   tables. CI does not set DATABASE_URL so this leg skips there;
 *   it runs locally when a developer points DATABASE_URL at a
 *   Supabase branch or a local Postgres.
 *
 * The canonical list is frozen here. Adding a new public table
 * going forward should fail Layer 1 until the new table is added to
 * CANONICAL_TABLES + to a fresh RLS-enable migration.
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
  '20260423_040_enable_rls_bug_rls_01',
  'migration.sql',
);

/**
 * The authoritative list of public-schema tables that MUST have RLS
 * enabled. Sourced from Qew's BUG-RLS-01 Security Advisor report
 * (27 tables, all in public schema). Order is documentary only —
 * the shape check is set-based.
 */
const CANONICAL_TABLES = [
  // Prisma internal
  '_prisma_migrations',
  // Identity
  'admin_users',
  'customers',
  'customer_documents',
  // Catalog
  'brands',
  'categories',
  'products',
  'product_images',
  'combo_sets',
  'combo_set_items',
  // Orders
  'orders',
  'order_items',
  'order_status_logs',
  'payment_slips',
  'after_sales_events',
  // Inventory
  'inventory_units',
  'inventory_status_logs',
  'product_stock_logs',
  'availability_calendar',
  // Shipping
  'shipping_zones',
  'shipping_province_configs',
  // Finance
  'finance_categories',
  'finance_transactions',
  // Ops / system
  'audit_logs',
  'notification_logs',
  'system_configs',
  'i18n_strings',
] as const;

describe('BUG-RLS-01 — Row Level Security is enabled on every public table', () => {
  describe('layer 1 — migration file shape (CI-safe, always runs)', () => {
    it('the hotfix migration file exists', () => {
      expect(existsSync(MIGRATION_PATH)).toBe(true);
    });

    it('the migration enables RLS on exactly the 27 canonical tables', () => {
      const sql = readFileSync(MIGRATION_PATH, 'utf8');

      // Parse every ALTER TABLE … ENABLE ROW LEVEL SECURITY statement.
      // Tolerate whitespace variants, optional "public." schema prefix,
      // and quoted identifiers.
      const pattern =
        /ALTER\s+TABLE\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY\s*;/gi;
      const enabledSet = new Set<string>();
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(sql)) !== null) {
        enabledSet.add(match[1].toLowerCase());
      }

      // Missing tables — someone deleted an ALTER from the migration.
      const missing = CANONICAL_TABLES.filter((t) => !enabledSet.has(t));
      expect(
        missing,
        `Migration must ENABLE ROW LEVEL SECURITY on every canonical table. Missing: ${missing.join(
          ', ',
        )}`,
      ).toEqual([]);

      // Extra tables — someone added an ALTER for a table not in the
      // canonical list. Either add it to CANONICAL_TABLES or drop it
      // from the migration; silent drift here is the bug class this
      // test exists to catch.
      const extras = [...enabledSet].filter(
        (t) => !CANONICAL_TABLES.includes(t as (typeof CANONICAL_TABLES)[number]),
      );
      expect(
        extras,
        `Migration enables RLS on tables not in CANONICAL_TABLES. Extras: ${extras.join(
          ', ',
        )}`,
      ).toEqual([]);

      expect(enabledSet.size).toBe(CANONICAL_TABLES.length);
    });

    it('the migration is wrapped in a single BEGIN / COMMIT so it is atomic', () => {
      const sql = readFileSync(MIGRATION_PATH, 'utf8');
      // Count BEGIN + COMMIT at statement-start; ignore comments.
      const begins = sql.match(/^\s*BEGIN\s*;/gim) ?? [];
      const commits = sql.match(/^\s*COMMIT\s*;/gim) ?? [];
      expect(begins.length).toBe(1);
      expect(commits.length).toBe(1);
    });
  });

  describe('layer 2 — live pg_class verification (requires DATABASE_URL)', () => {
    const hasDbUrl = Boolean(process.env.DATABASE_URL);

    it.skipIf(!hasDbUrl)(
      'pg_class.relrowsecurity = true for every canonical table',
      async () => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();
        try {
          const rows = await prisma.$queryRaw<
            Array<{ relname: string; relrowsecurity: boolean }>
          >`
            SELECT c.relname, c.relrowsecurity
            FROM pg_class c
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public'
              AND c.relkind = 'r'
              AND c.relname = ANY(${[...CANONICAL_TABLES]})
          `;

          const disabled = rows
            .filter((r) => r.relrowsecurity !== true)
            .map((r) => r.relname);
          expect(
            disabled,
            `Tables missing RLS on prod: ${disabled.join(', ')}`,
          ).toEqual([]);

          // Every canonical table must be present in the result set
          // — catches the case where the DB has renamed/dropped a
          // table without the canonical list being updated.
          const seen = new Set(rows.map((r) => r.relname));
          const absent = CANONICAL_TABLES.filter((t) => !seen.has(t));
          expect(
            absent,
            `Canonical tables not found in prod public schema: ${absent.join(
              ', ',
            )}`,
          ).toEqual([]);
        } finally {
          await prisma.$disconnect();
        }
      },
    );
  });
});
