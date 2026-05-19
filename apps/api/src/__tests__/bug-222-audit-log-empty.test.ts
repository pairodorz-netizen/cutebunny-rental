/**
 * BUG-222: Audit log empty despite admin mutations.
 *
 * Root cause: RLS RESTRICTIVE deny-all policies on audit_logs table block
 * writes from the authenticated role. The safeAuditLogCreate() wrapper
 * silently catches all errors, so no admin-visible indication of failure.
 *
 * Fix:
 *   1. Migration: Add PERMISSIVE policies for service_role and postgres
 *   2. Code: safeAuditLogCreate returns boolean + logs RLS-specific error
 *   3. Improved observability via structured console.error logs
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('BUG-222: safeAuditLogCreate resilience and observability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return true on successful audit log write', async () => {
    const mockCreate = vi.fn().mockResolvedValue({ id: 'log-1' });
    const mockDb = { auditLog: { create: mockCreate } };

    const { safeAuditLogCreate } = await import('../lib/safe-audit-log');
    vi.mock('../lib/db', () => ({ getDb: () => mockDb }));

    const result = await safeAuditLogCreate(mockDb as never, {
      adminId: '00000000-0000-0000-0000-000000000099',
      action: 'STATUS_CHANGE',
      resource: 'order',
      resourceId: 'order-123',
      details: { from: 'unpaid', to: 'paid_locked' },
    });

    expect(result).toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('should return false and log RLS error when row-level security blocks write', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockCreate = vi.fn().mockRejectedValue(
      new Error('new row violates row-level security policy for table "audit_logs"'),
    );
    const mockDb = { auditLog: { create: mockCreate } };

    const { safeAuditLogCreate } = await import('../lib/safe-audit-log');

    const result = await safeAuditLogCreate(mockDb as never, {
      adminId: '00000000-0000-0000-0000-000000000099',
      action: 'CREATE_ORDER',
      resource: 'order',
      resourceId: 'order-456',
      details: {},
    });

    expect(result).toBe(false);
    // Should log RLS-specific error
    const logCalls = consoleErrorSpy.mock.calls.map((c) => c[0]);
    const rlsLog = logCalls.find((l) => l.includes('audit_log_rls_denied'));
    expect(rlsLog).toBeDefined();
    const parsed = JSON.parse(rlsLog!);
    expect(parsed.type).toBe('audit_log_rls_denied');
    expect(parsed.guidance).toContain('20260513_219');

    consoleErrorSpy.mockRestore();
  });

  it('should return false and log generic error for non-RLS failures', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mockCreate = vi.fn().mockRejectedValue(new Error('Connection timeout'));
    const mockDb = { auditLog: { create: mockCreate } };

    const { safeAuditLogCreate } = await import('../lib/safe-audit-log');

    const result = await safeAuditLogCreate(mockDb as never, {
      adminId: '00000000-0000-0000-0000-000000000099',
      action: 'EDIT',
      resource: 'order',
      resourceId: 'order-789',
      details: {},
    });

    expect(result).toBe(false);
    const logCalls = consoleErrorSpy.mock.calls.map((c) => c[0]);
    const errorLog = logCalls.find((l) => l.includes('audit_log_write_failed'));
    expect(errorLog).toBeDefined();
    const parsed = JSON.parse(errorLog!);
    expect(parsed.type).toBe('audit_log_write_failed');
    expect(parsed.error).toContain('Connection timeout');

    consoleErrorSpy.mockRestore();
  });

  it('should not throw even when audit log write fails (non-blocking)', async () => {
    const mockCreate = vi.fn().mockRejectedValue(new Error('permission denied'));
    const mockDb = { auditLog: { create: mockCreate } };

    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { safeAuditLogCreate } = await import('../lib/safe-audit-log');

    // Should not throw
    await expect(
      safeAuditLogCreate(mockDb as never, {
        adminId: '00000000-0000-0000-0000-000000000099',
        action: 'STATUS_CHANGE',
        resource: 'order',
        resourceId: 'order-abc',
        details: {},
      }),
    ).resolves.toBe(false);
  });

  it('should detect Prisma schema errors separately from RLS errors', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Simulate P2022 — column does not exist
    const prismaError = Object.assign(
      new Error('The column `audit_logs.ip_address` does not exist in the current database.'),
      { code: 'P2022', meta: { column: 'ip_address', table: 'audit_logs' } },
    );
    const mockCreate = vi.fn().mockRejectedValue(prismaError);
    const mockDb = { auditLog: { create: mockCreate } };

    const { safeAuditLogCreate } = await import('../lib/safe-audit-log');

    const result = await safeAuditLogCreate(mockDb as never, {
      adminId: '00000000-0000-0000-0000-000000000099',
      action: 'EDIT',
      resource: 'product',
      resourceId: 'prod-123',
      details: {},
    });

    expect(result).toBe(false);
    const logCalls = consoleErrorSpy.mock.calls.map((c) => c[0]);
    const schemaLog = logCalls.find((l) => l.includes('audit_logs_unavailable'));
    expect(schemaLog).toBeDefined();
    const driftLog = logCalls.find((l) => l.includes('schema_drift_detected'));
    expect(driftLog).toBeDefined();

    consoleErrorSpy.mockRestore();
  });
});
