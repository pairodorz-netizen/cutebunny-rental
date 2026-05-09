/**
 * BUG-507 — Unit tests for PII retention job.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processPiiRetention } from '../scheduled';

function createMockDb() {
  return {
    $queryRawUnsafe: vi.fn(),
    $executeRawUnsafe: vi.fn(),
    systemLog: {
      create: vi.fn().mockResolvedValue({ id: 'log-1' }),
    },
  };
}

describe('BUG-507: processPiiRetention()', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('returns zero counts when no rows need processing', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    db.$executeRawUnsafe.mockResolvedValue(0);

    const metrics = await processPiiRetention(db as never);

    expect(metrics.job).toBe('pii_retention');
    expect(metrics.masked).toBe(0);
    expect(metrics.deleted).toBe(0);
    expect(metrics.alert).toBe(false);
    expect(metrics.errors).toHaveLength(0);
  });

  it('masks IPs for rows aged 30–90 days (Step A)', async () => {
    db.$queryRawUnsafe
      .mockResolvedValueOnce([
        { id: 'a1', ip_address: '192.168.1.100' },
        { id: 'a2', ip_address: '10.0.0.5' },
      ])
      .mockResolvedValueOnce([]);
    db.$executeRawUnsafe.mockResolvedValue(0);

    const metrics = await processPiiRetention(db as never);

    expect(metrics.masked).toBe(2);
    // Verify the UPDATE calls used masked IPs
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE audit_logs SET ip_address'),
      '192.168.1.0/24',
      'a1',
    );
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE audit_logs SET ip_address'),
      '10.0.0.0/24',
      'a2',
    );
  });

  it('NULLs IPs for rows aged >90 days (Step B)', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    db.$executeRawUnsafe.mockResolvedValue(5); // 5 rows deleted in one batch

    const metrics = await processPiiRetention(db as never);

    expect(metrics.deleted).toBe(5);
  });

  it('alerts after 3 consecutive Step A failures', async () => {
    db.$queryRawUnsafe
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockRejectedValueOnce(new Error('db timeout'));
    db.$executeRawUnsafe.mockResolvedValue(0);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const metrics = await processPiiRetention(db as never);

    expect(metrics.alert).toBe(true);
    expect(metrics.errors).toHaveLength(3);
    expect(metrics.errors[0]).toContain('Step A batch fail');
    consoleSpy.mockRestore();
  });

  it('alerts after 3 consecutive Step B failures', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    db.$executeRawUnsafe
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockRejectedValueOnce(new Error('db timeout'));

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const metrics = await processPiiRetention(db as never);

    expect(metrics.alert).toBe(true);
    expect(metrics.errors).toHaveLength(3);
    expect(metrics.errors[0]).toContain('Step B batch fail');
    consoleSpy.mockRestore();
  });

  it('is idempotent — empty DB on re-run', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    db.$executeRawUnsafe.mockResolvedValue(0);

    const m1 = await processPiiRetention(db as never);
    const m2 = await processPiiRetention(db as never);

    expect(m1.masked).toBe(0);
    expect(m2.masked).toBe(0);
    expect(m1.deleted).toBe(0);
    expect(m2.deleted).toBe(0);
  });

  it('handles mixed IPv4 and IPv6 in Step A', async () => {
    db.$queryRawUnsafe
      .mockResolvedValueOnce([
        { id: 'b1', ip_address: '8.8.8.8' },
        { id: 'b2', ip_address: '2001:db8::1' },
      ])
      .mockResolvedValueOnce([]);
    db.$executeRawUnsafe.mockResolvedValue(0);

    const metrics = await processPiiRetention(db as never);

    expect(metrics.masked).toBe(2);
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE audit_logs SET ip_address'),
      '8.8.8.0/24',
      'b1',
    );
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE audit_logs SET ip_address'),
      '2001:0db8:0000::/48',
      'b2',
    );
  });

  it('records duration_ms', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    db.$executeRawUnsafe.mockResolvedValue(0);

    const metrics = await processPiiRetention(db as never);

    expect(metrics.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('NULLs invalid IPs in Step A instead of crashing', async () => {
    db.$queryRawUnsafe
      .mockResolvedValueOnce([{ id: 'c1', ip_address: 'not-a-valid-ip' }])
      .mockResolvedValueOnce([]);
    db.$executeRawUnsafe.mockResolvedValue(0);

    const metrics = await processPiiRetention(db as never);

    expect(metrics.masked).toBe(1);
    // Should set to NULL since maskIP returns null for invalid
    expect(db.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('SET ip_address = NULL'),
      'c1',
    );
  });

  it('writes compliance proof to system_logs on success', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    db.$executeRawUnsafe.mockResolvedValue(0);

    await processPiiRetention(db as never);

    expect(db.systemLog.create).toHaveBeenCalledTimes(1);
    const call = db.systemLog.create.mock.calls[0][0];
    expect(call.data.job).toBe('pii_retention');
    expect(call.data.status).toBe('success');
    expect(call.data.details).toMatchObject({
      masked: 0,
      deleted: 0,
      message: expect.stringContaining('Retention policy for'),
    });
  });

  it('writes partial status to system_logs on alert', async () => {
    db.$queryRawUnsafe
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockRejectedValueOnce(new Error('db timeout'))
      .mockRejectedValueOnce(new Error('db timeout'));
    db.$executeRawUnsafe.mockResolvedValue(0);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await processPiiRetention(db as never);

    expect(db.systemLog.create).toHaveBeenCalledTimes(1);
    const call = db.systemLog.create.mock.calls[0][0];
    expect(call.data.status).toBe('partial');
    consoleSpy.mockRestore();
  });

  it('writes system_log every time cron runs (compliance proof)', async () => {
    db.$queryRawUnsafe.mockResolvedValue([]);
    db.$executeRawUnsafe.mockResolvedValue(0);

    await processPiiRetention(db as never);
    await processPiiRetention(db as never);

    expect(db.systemLog.create).toHaveBeenCalledTimes(2);
  });
});
