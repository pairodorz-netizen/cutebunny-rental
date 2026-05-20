/**
 * BUG-546 (#246): Audit log empty for admin — RLS blocks postgres/service_role
 * reads when FORCE ROW LEVEL SECURITY is active.
 *
 * Architecture: Admin dashboard reads audit_logs via backend API (Prisma/Neon
 * with postgres role), NOT via Supabase JS client. Admin auth uses custom
 * password_hash, not Supabase Auth — auth.uid() is irrelevant.
 *
 * Tests verify:
 * 1. Forward migration uses NO FORCE ROW LEVEL SECURITY (the key fix)
 * 2. Forward migration re-ensures PERMISSIVE policies for postgres + service_role
 * 3. Forward migration does NOT touch authenticated/anon deny-all policies
 * 4. Forward migration does NOT reference auth.uid() (architectural mismatch)
 * 5. Rollback restores FORCE ROW LEVEL SECURITY
 * 6. Admin API reads audit_logs via backend (not direct Supabase client)
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const FORWARD_SQL = readFileSync(
  resolve(__dirname, '../../../../migrations/20260519_246_audit_logs_admin_read_forward.sql'),
  'utf8',
);
const ROLLBACK_SQL = readFileSync(
  resolve(__dirname, '../../../../migrations/20260519_246_audit_logs_admin_read_rollback.sql'),
  'utf8',
);

// Check if the settings route file exists for architecture verification
const settingsRouteExists = (() => {
  try {
    readFileSync(resolve(__dirname, '../routes/admin/settings.ts'), 'utf8');
    return true;
  } catch { return false; }
})();

describe('BUG-546 (#246) — RLS audit_logs admin read (Option A: service_role)', () => {
  describe('forward migration — NO FORCE ROW LEVEL SECURITY', () => {
    it('removes FORCE ROW LEVEL SECURITY on audit_logs', () => {
      expect(FORWARD_SQL).toContain('NO FORCE ROW LEVEL SECURITY');
      expect(FORWARD_SQL).toContain('"public"."audit_logs"');
    });

    it('re-ensures PERMISSIVE ALL for service_role', () => {
      expect(FORWARD_SQL).toContain('CREATE POLICY "audit_logs_service_role_all"');
      expect(FORWARD_SQL).toContain('AS PERMISSIVE FOR ALL TO service_role');
      expect(FORWARD_SQL).toContain('USING (true) WITH CHECK (true)');
    });

    it('re-ensures PERMISSIVE ALL for postgres', () => {
      expect(FORWARD_SQL).toContain('CREATE POLICY "audit_logs_postgres_all"');
      expect(FORWARD_SQL).toContain('AS PERMISSIVE FOR ALL TO postgres');
    });

    it('is wrapped in a transaction', () => {
      expect(FORWARD_SQL).toContain('BEGIN;');
      expect(FORWARD_SQL).toContain('COMMIT;');
    });

    it('uses idempotent DROP IF EXISTS before CREATE', () => {
      expect(FORWARD_SQL).toContain('DROP POLICY IF EXISTS "audit_logs_service_role_all"');
      expect(FORWARD_SQL).toContain('DROP POLICY IF EXISTS "audit_logs_postgres_all"');
    });
  });

  describe('security — deny-all for untrusted roles preserved', () => {
    it('does NOT drop bug_rls_02_deny_all_authenticated', () => {
      // The authenticated deny-all policy must remain — the admin dashboard
      // reads via backend API (postgres role), not the Supabase JS client.
      const nonCommentLines = FORWARD_SQL.split('\n')
        .filter((line) => !line.trim().startsWith('--') && line.trim().length > 0);
      const sqlOnly = nonCommentLines.join('\n');
      expect(sqlOnly).not.toContain('DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated"');
    });

    it('does NOT drop bug_rls_02_deny_all_anon', () => {
      const nonCommentLines = FORWARD_SQL.split('\n')
        .filter((line) => !line.trim().startsWith('--') && line.trim().length > 0);
      const sqlOnly = nonCommentLines.join('\n');
      expect(sqlOnly).not.toContain('deny_all_anon');
    });

    it('does NOT reference auth.uid() (admin uses custom auth, not Supabase Auth)', () => {
      const nonCommentLines = FORWARD_SQL.split('\n')
        .filter((line) => !line.trim().startsWith('--') && line.trim().length > 0);
      const sqlOnly = nonCommentLines.join('\n');
      expect(sqlOnly).not.toContain('auth.uid()');
    });

    it('does NOT create any PERMISSIVE policy for authenticated role', () => {
      const nonCommentLines = FORWARD_SQL.split('\n')
        .filter((line) => !line.trim().startsWith('--') && line.trim().length > 0);
      const sqlOnly = nonCommentLines.join('\n');
      expect(sqlOnly).not.toContain('PERMISSIVE FOR SELECT TO authenticated');
      expect(sqlOnly).not.toContain('PERMISSIVE FOR ALL TO authenticated');
    });
  });

  describe('rollback migration', () => {
    it('restores FORCE ROW LEVEL SECURITY', () => {
      expect(ROLLBACK_SQL).toContain('FORCE ROW LEVEL SECURITY');
      // Must not contain NO FORCE (that's the forward direction)
      const nonCommentLines = ROLLBACK_SQL.split('\n')
        .filter((line) => !line.trim().startsWith('--') && line.trim().length > 0);
      const sqlOnly = nonCommentLines.join('\n');
      expect(sqlOnly).not.toContain('NO FORCE');
    });

    it('is wrapped in a transaction', () => {
      expect(ROLLBACK_SQL).toContain('BEGIN;');
      expect(ROLLBACK_SQL).toContain('COMMIT;');
    });

    it('does NOT drop the postgres/service_role PERMISSIVE policies', () => {
      // These policies from PR #238 should remain even on rollback
      expect(ROLLBACK_SQL).not.toContain('DROP POLICY');
    });
  });

  describe('architecture — admin reads via backend API (not direct client)', () => {
    it('settings route uses Prisma db.auditLog (not Supabase client)', () => {
      if (!settingsRouteExists) return; // skip if route file moved
      const settingsRoute = readFileSync(
        resolve(__dirname, '../routes/admin/settings.ts'),
        'utf8',
      );
      // Prisma query — the actual read path
      expect(settingsRoute).toContain('auditLog.findMany');
      // Must NOT use Supabase client for audit_logs
      expect(settingsRoute).not.toContain("from('audit_logs')");
      expect(settingsRoute).not.toContain('from("audit_logs")');
    });
  });
});
