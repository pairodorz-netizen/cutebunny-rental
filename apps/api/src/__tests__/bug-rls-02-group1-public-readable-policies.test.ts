/**
 * BUG-RLS-02 sub-PR 3 — drift guard for Group 1 (public-readable)
 * RLS policies.
 *
 * Asserts that the migration file
 * `20260423_070_rls_policies_group1_public_readable/migration.sql`
 * creates the expected PERMISSIVE `FOR SELECT USING (true)`
 * policies for anon + authenticated on every Group 1 table.
 *
 * Same two-layer pattern as sub-PRs 1 + 2, adapted for
 * PERMISSIVE SELECT instead of RESTRICTIVE ALL.
 *
 *   Layer 1 — always runs in CI. Parses the migration SQL and
 *   asserts every (table, role) pair has a corresponding
 *   PERMISSIVE `FOR SELECT ... USING (true)` CREATE POLICY
 *   statement, no WITH CHECK clause.
 *
 *   Layer 2 — runs only when DATABASE_URL is set. Queries
 *   pg_policies live and asserts the same policies exist on the
 *   real schema with the correct `permissive` / `roles` / `cmd`
 *   fields.
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
  '20260423_070_rls_policies_group1_public_readable',
  'migration.sql',
);

const GROUP_1_TABLES = [
  'brands',
  'categories',
  'products',
  'product_images',
  'combo_sets',
  'combo_set_items',
  'i18n_strings',
  'shipping_zones',
  'shipping_province_configs',
] as const;

const ROLES = ['anon', 'authenticated'] as const;

interface PolicyShape {
  name: string;
  table: string;
  role: string;
  restrictive: boolean;
  command: string;
  using: string;
  withCheck: string | null;
}

function parseCreatePolicyStatements(sql: string): PolicyShape[] {
  const pattern =
    /CREATE\s+POLICY\s+"?([^"\s]+)"?\s+ON\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s+AS\s+(RESTRICTIVE|PERMISSIVE)\s+FOR\s+(ALL|SELECT|INSERT|UPDATE|DELETE)\s+TO\s+([a-z_][a-z0-9_]*)\s+USING\s*\(([^)]+)\)(?:\s+WITH\s+CHECK\s*\(([^)]+)\))?\s*;/gi;
  const out: PolicyShape[] = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(sql)) !== null) {
    out.push({
      name: m[1],
      table: m[2].toLowerCase(),
      restrictive: m[3].toUpperCase() === 'RESTRICTIVE',
      command: m[4].toUpperCase(),
      role: m[5].toLowerCase(),
      using: m[6].trim(),
      withCheck: m[7]?.trim() ?? null,
    });
  }
  return out;
}

describe('BUG-RLS-02 Group 1 — PERMISSIVE public-read policies on catalog tables', () => {
  describe('layer 1 — migration file shape (CI-safe, always runs)', () => {
    it('the migration file exists', () => {
      expect(existsSync(MIGRATION_PATH)).toBe(true);
    });

    it('creates one PERMISSIVE SELECT policy per (table × role) for all 9 Group 1 tables', () => {
      const sql = readFileSync(MIGRATION_PATH, 'utf8');
      const policies = parseCreatePolicyStatements(sql);

      for (const table of GROUP_1_TABLES) {
        for (const role of ROLES) {
          const match = policies.find(
            (p) => p.table === table && p.role === role,
          );
          expect(
            match,
            `Missing policy for ${table} × ${role}`,
          ).toBeDefined();
          expect(
            match!.restrictive,
            `${table} × ${role} must be PERMISSIVE (not RESTRICTIVE)`,
          ).toBe(false);
          expect(match!.command).toBe('SELECT');
          // `true` is the intended allow-all expression. No
          // `visible_frontend = true` gate — RLS is structural only
          // (role × table); Worker layer owns business visibility.
          expect(match!.using.toLowerCase()).toBe('true');
          // SELECT policies must not carry a WITH CHECK clause
          // (WITH CHECK only applies to INSERT/UPDATE).
          expect(
            match!.withCheck,
            `${table} × ${role} must not have WITH CHECK (SELECT-only policy)`,
          ).toBeNull();
        }
      }

      // No extras: every CREATE POLICY in this file must belong to
      // a Group 1 table. Catches cross-pollination between sub-PRs.
      const extras = policies.filter(
        (p) =>
          !GROUP_1_TABLES.includes(p.table as (typeof GROUP_1_TABLES)[number]),
      );
      expect(
        extras,
        `Migration contains policies for non-Group-1 tables: ${extras
          .map((p) => p.table)
          .join(', ')}`,
      ).toEqual([]);

      expect(policies.length).toBe(GROUP_1_TABLES.length * ROLES.length);
    });

    it('each CREATE POLICY is guarded by DROP POLICY IF EXISTS (idempotent)', () => {
      const sql = readFileSync(MIGRATION_PATH, 'utf8');
      const dropPattern =
        /DROP\s+POLICY\s+IF\s+EXISTS\s+"?([^"\s]+)"?\s+ON\s+(?:"?public"?\.)?"?([a-z_][a-z0-9_]*)"?\s*;/gi;
      const drops = new Set<string>();
      let m: RegExpExecArray | null;
      while ((m = dropPattern.exec(sql)) !== null) {
        drops.add(`${m[2].toLowerCase()}.${m[1]}`);
      }
      const creates = parseCreatePolicyStatements(sql);
      for (const p of creates) {
        expect(
          drops.has(`${p.table}.${p.name}`),
          `CREATE POLICY ${p.name} on ${p.table} must be preceded by DROP POLICY IF EXISTS for idempotency`,
        ).toBe(true);
      }
    });

    it('the migration is wrapped in a single BEGIN / COMMIT', () => {
      const sql = readFileSync(MIGRATION_PATH, 'utf8');
      const begins = sql.match(/^\s*BEGIN\s*;/gim) ?? [];
      const commits = sql.match(/^\s*COMMIT\s*;/gim) ?? [];
      expect(begins.length).toBe(1);
      expect(commits.length).toBe(1);
    });
  });

  describe('layer 2 — live pg_policies verification (requires DATABASE_URL)', () => {
    const hasDbUrl = Boolean(process.env.DATABASE_URL);

    it.skipIf(!hasDbUrl)(
      'pg_policies has a matching PERMISSIVE SELECT policy per (table × role)',
      async () => {
        const { PrismaClient } = await import('@prisma/client');
        const prisma = new PrismaClient();
        try {
          const rows = await prisma.$queryRaw<
            Array<{
              tablename: string;
              policyname: string;
              permissive: string;
              roles: string[];
              cmd: string;
            }>
          >`
            SELECT tablename, policyname, permissive, roles, cmd
            FROM pg_policies
            WHERE schemaname = 'public'
              AND tablename = ANY(${[...GROUP_1_TABLES]})
              AND policyname LIKE 'bug_rls_02_select_%'
          `;

          for (const table of GROUP_1_TABLES) {
            for (const role of ROLES) {
              const match = rows.find(
                (r) => r.tablename === table && r.roles.includes(role),
              );
              expect(
                match,
                `prod missing policy for ${table} × ${role}`,
              ).toBeDefined();
              expect(
                match!.permissive.toUpperCase(),
                `${table} × ${role} must be PERMISSIVE`,
              ).toBe('PERMISSIVE');
              expect(
                match!.cmd.toUpperCase(),
                `${table} × ${role} must be FOR SELECT`,
              ).toBe('SELECT');
            }
          }
        } finally {
          await prisma.$disconnect();
        }
      },
    );
  });
});
