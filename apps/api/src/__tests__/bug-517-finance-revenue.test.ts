/**
 * BUG-517: Finance Summary Revenue discrepancy.
 *
 * Root cause:
 *   1. rental_revenue was created BOTH at payment verification (totalAmount)
 *      AND at returned-status change (subtotal) → double-counting.
 *   2. Payment verification used order.totalAmount (includes deposit) instead
 *      of order.subtotal (pure rental price).
 *
 * Fix:
 *   1. Payment verification now records rental_revenue = order.subtotal
 *   2. Removed duplicate rental_revenue at returned-status transition
 *   3. Cancellation reversal already uses -order.subtotal (correct)
 *
 * Tests:
 *   - Payment verification creates rental_revenue with subtotal (not totalAmount)
 *   - Returned status does NOT create a second rental_revenue
 *   - Cancellation creates reversal with -subtotal
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const models = [
    'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
    'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
    'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
    'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
    'auditLog', 'inventoryUnit', 'comboSet', 'comboSetItem', 'productStockLog',
    'financeCategory', 'systemConfig', 'notificationLog',
    'category',
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
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
      upsert: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
      groupBy: vi.fn().mockResolvedValue([]),
    };
  }
  return db;
});

vi.mock('../lib/db', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn() },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn(),
}));

import app from '../index';

async function getAdminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken('admin-1', 'admin@test.com', 'superadmin');
}

const ORDER_ID = '00000000-0000-0000-0000-000000000006';

const MOCK_ORDER_SHIPPED = {
  id: ORDER_ID,
  orderNumber: 'ORD-TEST-517',
  customerId: 'cust-1',
  status: 'shipped',
  subtotal: 3500,
  deposit: 3000,
  deliveryFee: 100,
  lateFee: 0,
  damageFee: 0,
  discount: 0,
  creditApplied: 0,
  totalAmount: 6600,
  rentalStartDate: new Date('2026-05-01'),
  rentalEndDate: new Date('2026-05-03'),
  totalDays: 3,
  shippingSnapshot: {},
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_ORDER_UNPAID = {
  ...MOCK_ORDER_SHIPPED,
  status: 'unpaid',
};

describe('BUG-517: Finance Revenue calculation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('payment verification creates rental_revenue with subtotal, not totalAmount', async () => {
    const slipId = '00000000-0000-0000-0000-000000000099';
    const mockSlip = {
      id: slipId,
      orderId: ORDER_ID,
      verificationStatus: 'pending',
      declaredAmount: 6600,
    };

    mockDb.paymentSlip.findFirst.mockResolvedValue(mockSlip);
    mockDb.paymentSlip.update.mockResolvedValue({ ...mockSlip, verificationStatus: 'verified' });
    mockDb.paymentSlip.findMany.mockResolvedValue([{ ...mockSlip, verificationStatus: 'verified', declaredAmount: 6600 }]);
    mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER_UNPAID);
    mockDb.order.update.mockResolvedValue({ ...MOCK_ORDER_UNPAID, status: 'paid_locked' });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-1' });
    mockDb.financeTransaction.create.mockResolvedValue({ id: 'tx-1' });
    mockDb.customer.findUnique.mockResolvedValue(null);
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const token = await getAdminToken();
    const res = await app.request(`/api/v1/admin/orders/${ORDER_ID}/payment-slip/verify`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        slip_id: slipId,
        verified: true,
      }),
    });

    expect(res.status).toBe(200);

    // Find the rental_revenue transaction creation call
    const txCalls = mockDb.financeTransaction.create.mock.calls;
    const revenueCall = txCalls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call: any[]) => call[0]?.data?.txType === 'rental_revenue',
    );

    expect(revenueCall).toBeDefined();
    // BUG-517 fix: should use subtotal (3500), NOT totalAmount (6600)
    expect(revenueCall![0].data.amount).toBe(MOCK_ORDER_UNPAID.subtotal);
    expect(revenueCall![0].data.amount).not.toBe(MOCK_ORDER_UNPAID.totalAmount);
  });

  it('returned status does NOT create a second rental_revenue transaction', async () => {
    mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER_SHIPPED);
    mockDb.order.update.mockResolvedValue({ ...MOCK_ORDER_SHIPPED, status: 'returned' });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-1' });
    mockDb.financeTransaction.create.mockResolvedValue({ id: 'tx-1' });
    mockDb.customer.findUnique.mockResolvedValue(null);
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const token = await getAdminToken();
    const res = await app.request(`/api/v1/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to_status: 'returned' }),
    });

    expect(res.status).toBe(200);

    // No rental_revenue transaction should be created at returned status
    const txCalls = mockDb.financeTransaction.create.mock.calls;
    const revenueCall = txCalls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call: any[]) => call[0]?.data?.txType === 'rental_revenue',
    );

    expect(revenueCall).toBeUndefined();
  });

  it('cancelled status creates revenue reversal with -subtotal', async () => {
    const paidOrder = { ...MOCK_ORDER_SHIPPED, status: 'paid_locked' };
    mockDb.order.findUnique.mockResolvedValue(paidOrder);
    mockDb.order.update.mockResolvedValue({ ...paidOrder, status: 'cancelled' });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-1' });
    mockDb.financeTransaction.create.mockResolvedValue({ id: 'tx-1' });
    mockDb.customer.findUnique.mockResolvedValue(null);
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });

    const token = await getAdminToken();
    const res = await app.request(`/api/v1/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ to_status: 'cancelled' }),
    });

    expect(res.status).toBe(200);

    const txCalls = mockDb.financeTransaction.create.mock.calls;
    const reversalCall = txCalls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call: any[]) => call[0]?.data?.txType === 'rental_revenue' && call[0]?.data?.amount < 0,
    );

    expect(reversalCall).toBeDefined();
    expect(reversalCall![0].data.amount).toBe(-paidOrder.subtotal);
  });

  it('finance summary tooltip keys exist in all locales', async () => {
    // This test validates that the tooltip i18n keys exist
    const fs = await import('fs');
    const path = await import('path');
    const localeDir = path.resolve(__dirname, '../../../admin/src/i18n/locales');
    const tooltipKeys = ['revenueTooltip', 'expensesTooltip', 'netProfitTooltip'];

    for (const locale of ['en', 'th', 'zh']) {
      const content = JSON.parse(fs.readFileSync(path.join(localeDir, `${locale}.json`), 'utf-8'));
      for (const key of tooltipKeys) {
        expect(content.finance[key]).toBeDefined();
        expect(content.finance[key].length).toBeGreaterThan(0);
      }
    }
  });
});
