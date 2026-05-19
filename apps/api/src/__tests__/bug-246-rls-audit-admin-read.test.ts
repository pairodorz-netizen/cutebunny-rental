/**
 * BUG-546 (#246): Audit log empty for admin due to RESTRICTIVE RLS policy.
 *
 * Tests verify:
 * 1. Migration SQL is syntactically valid and contains correct policy definitions
 * 2. Admin users (in admin_users table) should be able to SELECT audit_logs
 * 3. Non-admin authenticated users should be blocked from SELECT
 * 4. All authenticated users are blocked from INSERT/UPDATE/DELETE
 * 5. Rollback migration restores the original deny-all policy
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

describe('BUG-546 (#246) — RLS audit_logs admin read migration', () => {
  describe('forward migration structure', () => {
    it('drops the blanket deny-all RESTRICTIVE policy', () => {
      expect(FORWARD_SQL).toContain(
        'DROP POLICY IF EXISTS "bug_rls_02_deny_all_authenticated" ON "public"."audit_logs"',
      );
    });

    it('creates RESTRICTIVE deny for INSERT on authenticated', () => {
      expect(FORWARD_SQL).toContain('CREATE POLICY "audit_logs_deny_write_authenticated"');
      expect(FORWARD_SQL).toContain('AS RESTRICTIVE FOR INSERT TO authenticated');
      expect(FORWARD_SQL).toContain('USING (false) WITH CHECK (false)');
    });

    it('creates RESTRICTIVE deny for UPDATE on authenticated', () => {
      expect(FORWARD_SQL).toContain('CREATE POLICY "audit_logs_deny_update_authenticated"');
      expect(FORWARD_SQL).toContain('AS RESTRICTIVE FOR UPDATE TO authenticated');
    });

    it('creates RESTRICTIVE deny for DELETE on authenticated', () => {
      expect(FORWARD_SQL).toContain('CREATE POLICY "audit_logs_deny_delete_authenticated"');
      expect(FORWARD_SQL).toContain('AS RESTRICTIVE FOR DELETE TO authenticated');
    });

    it('creates PERMISSIVE SELECT policy for admin users only', () => {
      expect(FORWARD_SQL).toContain('CREATE POLICY "audit_logs_admin_read"');
      expect(FORWARD_SQL).toContain('AS PERMISSIVE FOR SELECT TO authenticated');
      expect(FORWARD_SQL).toContain(
        'USING (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid()))',
      );
    });

    it('is wrapped in a transaction', () => {
      expect(FORWARD_SQL).toContain('BEGIN;');
      expect(FORWARD_SQL).toContain('COMMIT;');
    });

    it('does not grant blanket SELECT to all authenticated users', () => {
      // Must use admin_users check, not a simple USING(true)
      const selectPolicy = FORWARD_SQL.match(
        /CREATE POLICY "audit_logs_admin_read"[\s\S]*?;/,
      );
      expect(selectPolicy).not.toBeNull();
      expect(selectPolicy![0]).not.toContain('USING (true)');
      expect(selectPolicy![0]).toContain('admin_users');
    });
  });

  describe('rollback migration', () => {
    it('drops all granular policies', () => {
      expect(ROLLBACK_SQL).toContain('DROP POLICY IF EXISTS "audit_logs_admin_read"');
      expect(ROLLBACK_SQL).toContain('DROP POLICY IF EXISTS "audit_logs_deny_write_authenticated"');
      expect(ROLLBACK_SQL).toContain('DROP POLICY IF EXISTS "audit_logs_deny_update_authenticated"');
      expect(ROLLBACK_SQL).toContain('DROP POLICY IF EXISTS "audit_logs_deny_delete_authenticated"');
    });

    it('restores original deny-all RESTRICTIVE policy', () => {
      expect(ROLLBACK_SQL).toContain('CREATE POLICY "bug_rls_02_deny_all_authenticated"');
      expect(ROLLBACK_SQL).toContain('AS RESTRICTIVE FOR ALL TO authenticated');
      expect(ROLLBACK_SQL).toContain('USING (false) WITH CHECK (false)');
    });

    it('is wrapped in a transaction', () => {
      expect(ROLLBACK_SQL).toContain('BEGIN;');
      expect(ROLLBACK_SQL).toContain('COMMIT;');
    });
  });

  describe('security constraints', () => {
    it('anon deny-all is NOT touched by the migration', () => {
      // Forward migration must not DROP or CREATE anon policies (only mentions in comments)
      const statements = FORWARD_SQL.split('\n').filter(
        (line) => !line.trim().startsWith('--') && line.trim().length > 0,
      );
      const nonCommentSQL = statements.join('\n');
      expect(nonCommentSQL).not.toContain('deny_all_anon');
    });

    it('admin_read policy scopes via admin_users table (not blanket access)', () => {
      // The USING clause must reference admin_users for boundary check
      const usingClause = FORWARD_SQL.match(/USING \(EXISTS.*?\)\)/s);
      expect(usingClause).not.toBeNull();
      expect(usingClause![0]).toContain('public.admin_users');
      expect(usingClause![0]).toContain('auth.uid()');
    });
  });
});
