/**
 * BUG-220: Deposit returned exceeds rental revenue (temporal mismatch).
 *
 * Root cause: deposit_returned transactions are created when orders finish
 * (potentially months after the deposit was collected), while deposit_received
 * is recorded at payment time. For any date range, deposit_returned may
 * exceed deposit_received due to this timing difference.
 *
 * Fix: Add invariant — totalDepositReturned is capped at totalDepositReceived
 * for the same reporting period. Applied to both /report and /summary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const models = [
    'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
    'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
    'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
    'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
    'auditLog', 'inventoryUnit', 'comboSet', 'comboSetItem', 'productStockLog',
    'financeCategory', 'systemConfig', 'notificationLog', 'category',
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (ops: unknown) => {
      if (typeof ops === 'function') return (ops as (tx: unknown) => unknown)(db);
      if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[]);
      return [];
    }),
  };
  for (const model of models) {
    db[model] = {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      update: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      delete: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      upsert: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      groupBy: vi.fn().mockResolvedValue([]),
    };
  }
  return db;
});

vi.mock('../lib/db', () => ({ getDb: vi.fn(() => mockDb) }));
vi.mock('../lib/notifications', () => ({ sendOrderStatusNotification: vi.fn() }));
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn() },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn(),
}));

import app from '../index';

async function getAdminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken('00000000-0000-0000-0000-000000000099', 'admin@cutebunny.rental', 'superadmin');
}

describe('BUG-220: Deposit returned invariant (must not exceed deposit received)', () => {
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    token = await getAdminToken();
  });

  describe('GET /api/v1/admin/finance/report', () => {
    it('should cap deposit_returned at deposit_received when temporal mismatch occurs', async () => {
      // Simulate: within the date range, only 2750 THB deposit_received
      // but 4140 THB deposit_returned (from orders paid in prior periods)
      mockDb.financeTransaction.findMany.mockResolvedValue([
        { id: '1', txType: 'rental_revenue', amount: 2750, createdAt: new Date('2026-01-15'), order: null, category: null },
        { id: '2', txType: 'deposit_received', amount: 2750, createdAt: new Date('2026-01-15'), order: null, category: null },
        { id: '3', txType: 'deposit_returned', amount: 4140, createdAt: new Date('2026-01-20'), order: null, category: null },
      ]);
      mockDb.order.findMany.mockResolvedValue([]);
      mockDb.financeCategory.findMany.mockResolvedValue([]);

      const res = await app.request('/api/v1/admin/finance/report?year=2026&month=1', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      // Invariant: deposit_returned ≤ deposit_received
      expect(body.data.summary.deposit_returned).toBeLessThanOrEqual(body.data.summary.deposit_received);
      expect(body.data.summary.deposit_returned).toBe(2750);
      expect(body.data.summary.deposit_received).toBe(2750);
      // net_deposit should be 0 (all received deposits were returned)
      expect(body.data.summary.net_deposit).toBe(0);
    });

    it('should NOT cap when deposit_returned <= deposit_received', async () => {
      mockDb.financeTransaction.findMany.mockResolvedValue([
        { id: '1', txType: 'rental_revenue', amount: 5000, createdAt: new Date('2026-01-15'), order: null, category: null },
        { id: '2', txType: 'deposit_received', amount: 6000, createdAt: new Date('2026-01-15'), order: null, category: null },
        { id: '3', txType: 'deposit_returned', amount: 3000, createdAt: new Date('2026-01-25'), order: null, category: null },
      ]);
      mockDb.order.findMany.mockResolvedValue([]);
      mockDb.financeCategory.findMany.mockResolvedValue([]);

      const res = await app.request('/api/v1/admin/finance/report?year=2026&month=1', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.summary.deposit_returned).toBe(3000);
      expect(body.data.summary.deposit_received).toBe(6000);
      expect(body.data.summary.net_deposit).toBe(3000);
    });

    it('should handle zero deposits correctly', async () => {
      mockDb.financeTransaction.findMany.mockResolvedValue([
        { id: '1', txType: 'rental_revenue', amount: 5000, createdAt: new Date('2026-01-15'), order: null, category: null },
      ]);
      mockDb.order.findMany.mockResolvedValue([]);
      mockDb.financeCategory.findMany.mockResolvedValue([]);

      const res = await app.request('/api/v1/admin/finance/report?year=2026&month=1', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.summary.deposit_returned).toBe(0);
      expect(body.data.summary.deposit_received).toBe(0);
      expect(body.data.summary.net_deposit).toBe(0);
    });
  });

  describe('GET /api/v1/admin/finance/summary', () => {
    it('should cap deposit_returned at deposit_received in summary view', async () => {
      mockDb.financeTransaction.findMany.mockResolvedValue([
        { id: '1', txType: 'rental_revenue', amount: 2750, createdAt: new Date('2026-03-15'), category: null },
        { id: '2', txType: 'deposit_received', amount: 2750, createdAt: new Date('2026-03-15'), category: null },
        { id: '3', txType: 'deposit_returned', amount: 4140, createdAt: new Date('2026-03-20'), category: null },
      ]);
      mockDb.order.findMany.mockResolvedValue([]);

      const res = await app.request('/api/v1/admin/finance/summary?start_date=2026-03-01&end_date=2026-03-31', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      // Invariant honored
      expect(body.data.totals.deposit_returned).toBeLessThanOrEqual(body.data.totals.deposit_received);
      expect(body.data.totals.deposit_returned).toBe(2750);
      expect(body.data.totals.deposit_received).toBe(2750);
    });

    it('should reproduce issue: range 2025-11-19 → 2026-05-19 with mismatch', async () => {
      // Exact repro from the issue: rental 2,750 THB vs deposit returned 4,140 THB
      mockDb.financeTransaction.findMany.mockResolvedValue([
        { id: '1', txType: 'rental_revenue', amount: 2750, createdAt: new Date('2025-12-01'), category: null },
        { id: '2', txType: 'deposit_received', amount: 2750, createdAt: new Date('2025-12-01'), category: null },
        // These deposit_returned are from orders paid BEFORE the range
        { id: '3', txType: 'deposit_returned', amount: 2000, createdAt: new Date('2026-01-15'), category: null },
        { id: '4', txType: 'deposit_returned', amount: 2140, createdAt: new Date('2026-03-10'), category: null },
      ]);
      mockDb.order.findMany.mockResolvedValue([]);

      const res = await app.request('/api/v1/admin/finance/summary?start_date=2025-11-19&end_date=2026-05-19', {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      // Without fix: deposit_returned = 4140 > deposit_received = 2750 (BUG)
      // With fix: deposit_returned capped at 2750
      expect(body.data.totals.deposit_returned).toBe(2750);
      expect(body.data.totals.deposit_returned).toBeLessThanOrEqual(body.data.totals.deposit_received);
    });
  });
});
