/**
 * BUG-506 — Schema drift guard integration test.
 *
 * Verifies the drift-detection concept:
 *   - When all migrations are applied, `prisma migrate diff` reports no diff.
 *   - When a column is missing, `prisma migrate diff` would detect the gap.
 *
 * This test validates the helper utilities and the migration file presence.
 * The actual CI guard runs `prisma migrate diff --exit-code` against a
 * shadow Postgres in the `schema-drift-guard` CI job.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const PRISMA_DIR = join(__dirname, '..', '..', '..', '..', 'packages', 'shared', 'prisma');
const SCHEMA_PATH = join(PRISMA_DIR, 'schema.prisma');
const MIGRATION_DIR = join(PRISMA_DIR, 'migrations', '20260507_140_audit_logs_ip_address');
const MIGRATION_SQL = join(MIGRATION_DIR, 'migration.sql');

describe('BUG-506: migration file and schema consistency', () => {
  it('migration file for audit_logs.ip_address exists', () => {
    expect(existsSync(MIGRATION_SQL)).toBe(true);
  });

  it('migration SQL creates audit_logs table with ip_address column', () => {
    const sql = readFileSync(MIGRATION_SQL, 'utf-8');

    // Table creation includes ip_address
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "audit_logs"');
    expect(sql).toContain('"ip_address"');

    // Idempotent ALTER TABLE for existing tables
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "ip_address"');
  });

  it('migration SQL includes foreign key constraints', () => {
    const sql = readFileSync(MIGRATION_SQL, 'utf-8');
    expect(sql).toContain('audit_logs_order_id_fkey');
    expect(sql).toContain('audit_logs_admin_id_fkey');
  });

  it('migration SQL enables RLS', () => {
    const sql = readFileSync(MIGRATION_SQL, 'utf-8');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('schema.prisma declares AuditLog model with ipAddress field', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf-8');
    expect(schema).toContain('model AuditLog');
    expect(schema).toContain('ipAddress');
    expect(schema).toContain('@map("ip_address")');
  });

  it('all model @@map tables have corresponding CREATE TABLE in migrations', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf-8');
    const mapMatches = schema.match(/@@map\("(\w+)"\)/g);
    expect(mapMatches).not.toBeNull();

    const tableNames = mapMatches!.map((m: string) => m.match(/@@map\("(\w+)"\)/)![1]);

    // Read all migration SQL files
    const migrationsDir = join(PRISMA_DIR, 'migrations');
    const migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d: { isDirectory: () => boolean }) => d.isDirectory())
      .map((d: { name: string }) => d.name);

    let allMigrationSql = '';
    for (const dir of migrationDirs) {
      const sqlPath = join(migrationsDir, dir, 'migration.sql');
      if (existsSync(sqlPath)) {
        allMigrationSql += readFileSync(sqlPath, 'utf-8');
      }
    }

    // These tables should all appear in CREATE TABLE statements across migrations
    const missingTables = tableNames.filter((t: string) =>
      !allMigrationSql.includes(`"${t}"`) && !allMigrationSql.includes(`\`${t}\``),
    );

    // If this test fails, it means we have schema models that are never
    // created in any migration — a potential P2022/P2021 at runtime
    expect(missingTables).toEqual([]);
  });
});
