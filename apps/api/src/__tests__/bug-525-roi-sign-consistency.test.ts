/**
 * BUG-525: ROI Rankings Net Profit inconsistent with ROI%.
 *
 * Fix: Net Profit = TotalRevenue - TotalExpenses - PurchaseCost
 * ROI% = (TotalRevenue - PurchaseCost) / PurchaseCost * 100
 *
 * Example: Purchase=2000, Revenue=800, Expenses=0
 * → Net Profit = 800 - 0 - 2000 = -1200
 * → ROI% = (800 - 2000) / 2000 * 100 = -60%
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

describe('BUG-525: ROI sign consistency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('single product ROI: Net Profit and ROI% are sign-consistent', async () => {
    mockDb.product.findUnique.mockResolvedValue({
      id: 'prod-lace',
      name: 'Lace Bridal Gown',
      sku: 'WED-001',
      costPrice: 2000,
      orderItems: [
        { subtotal: 800, order: { status: 'returned', totalAmount: 800, createdAt: new Date() } },
      ],
      financeTransactions: [
        { txType: 'rental_revenue', amount: 800, createdAt: new Date(), note: null },
      ],
    });

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/products/prod-lace/roi', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data;

    // Net Profit = 800 - 0 - 2000 = -1200
    expect(data.net_profit).toBe(-1200);
    // ROI = (800 - 2000) / 2000 * 100 = -60
    expect(data.roi).toBe(-60);
    expect(data.purchase_cost).toBe(2000);
    expect(data.total_revenue).toBe(800);
  });

  it('ROI summary: all products show consistent Net Profit and ROI%', async () => {
    mockDb.product.findMany.mockResolvedValue([
      {
        id: 'prod-1',
        name: 'Lace Bridal Gown',
        sku: 'WED-001',
        costPrice: 2000,
        deletedAt: null,
        orderItems: [
          { subtotal: 800, order: { status: 'returned' } },
        ],
        financeTransactions: [
          { txType: 'rental_revenue', amount: 800 },
        ],
      },
      {
        id: 'prod-2',
        name: 'Bohemian Maxi Dress',
        sku: 'CAS-001',
        costPrice: 1000,
        deletedAt: null,
        orderItems: [
          { subtotal: 600, order: { status: 'returned' } },
          { subtotal: 600, order: { status: 'cleaning' } },
        ],
        financeTransactions: [
          { txType: 'rental_revenue', amount: 1200 },
        ],
      },
    ]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/products/roi/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const items = body.data;

    const lace = items.find((i: { sku: string }) => i.sku === 'WED-001');
    expect(lace.net_profit).toBe(-1200);
    expect(lace.roi).toBe(-60);

    const boho = items.find((i: { sku: string }) => i.sku === 'CAS-001');
    expect(boho.net_profit).toBe(200); // 1200 - 0 - 1000
    expect(boho.roi).toBe(20); // (1200 - 1000) / 1000 * 100
  });

  it('ROI summary excludes soft-deleted products (BUG-524)', async () => {
    mockDb.product.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      const where = args?.where as Record<string, unknown> | undefined;
      if (where?.deletedAt === null) {
        return [{
          id: 'prod-active',
          name: 'Active Dress',
          sku: 'ACT-001',
          costPrice: 500,
          deletedAt: null,
          orderItems: [],
          financeTransactions: [],
        }];
      }
      return [];
    });

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/products/roi/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toHaveLength(1);
    expect(body.data[0].sku).toBe('ACT-001');

    const call = mockDb.product.findMany.mock.calls[0][0];
    expect(call.where).toEqual({ deletedAt: null });
  });
});
