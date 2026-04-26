/**
 * BUG-RLS-02 sub-PR 1 — drift guard for Group 4 (system-internal)
 * RLS policies.
 *
 * Asserts that the migration file
 * `20260423_050_rls_policies_group4_prisma_internal/migration.sql`
 * creates the expected RESTRICTIVE deny-all policies for anon +
 * authenticated on every Group 4 table.
 *
 * Two layers (same pattern as bug-rls-01-rls-enabled.test.ts):
 *
 *   Layer 1 — always runs in CI. Parses the migration SQL and
 *   asserts every (table, role) pair has a corresponding
 *   RESTRICTIVE `FOR ALL ... USING (false)` CREATE POLICY
 *   statement.
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
  '20260423_050_rls_policies_group4_prisma_internal',
  'migration.sql',
);

const GROUP_4_TABLES = ['_prisma_migrations'] as const;

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
  // Tolerates whitespace, optional "public." prefix, optional
  // WITH CHECK clause. Captures name, table, RESTRICTIVE/PERMISSIVE,
  // command, role, USING expression, optional WITH CHECK expression.
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

describe('BUG-RLS-02 Group 4 — RESTRICTIVE deny-all policies on system-internal tables', () => {
  describe('layer 1 — migration file shape (CI-safe, always runs)', () => {
    it('the migration file exists', () => {
      expect(existsSync(MIGRATION_PATH)).toBe(true);
    });

    it('creates one RESTRICTIVE deny-all policy per (table × role) in Group 4', () => {
      const sql = readFileSync(MIGRATION_PATH, 'utf8');
      const policies = parseCreatePolicyStatements(sql);

      // Every expected (table, role) pair must be present.
      for (const table of GROUP_4_TABLES) {
        for (const role of ROLES) {
          const match = policies.find(
            (p) => p.table === table && p.role === role,
          );
          expect(
            match,
            `Missing policy for ${table} × ${role}`,
          ).toBeDefined();
          expect(match!.restrictive).toBe(true);
          expect(match!.command).toBe('ALL');
          // `false` is the intended deny-all expression. Whitespace
          // around it is allowed.
          expect(match!.using.toLowerCase()).toBe('false');
          expect(match!.withCheck?.toLowerCase()).toBe('false');
        }
      }

      // No extras for Group 4 tables beyond the expected 2-per-table.
      const group4Policies = policies.filter((p) =>
        GROUP_4_TABLES.includes(p.table as (typeof GROUP_4_TABLES)[number]),
      );
      expect(group4Policies.length).toBe(
        GROUP_4_TABLES.length * ROLES.length,
      );
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
      'pg_policies has a matching RESTRICTIVE deny-all policy per (table × role)',
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
              AND tablename = ANY(${[...GROUP_4_TABLES]})
          `;

          for (const table of GROUP_4_TABLES) {
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
                `${table} × ${role} must be RESTRICTIVE`,
              ).toBe('RESTRICTIVE');
              expect(
                match!.cmd.toUpperCase(),
                `${table} × ${role} must be FOR ALL`,
              ).toBe('ALL');
            }
          }
        } finally {
          await prisma.$disconnect();
        }
      },
    );
  });
});
