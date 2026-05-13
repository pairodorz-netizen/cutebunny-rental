/**
 * BUG-516: Dashboard "Top Products" includes deleted/archived products.
 *
 * The topProducts query should filter out products where deletedAt is not null,
 * matching the behavior of the /products list endpoint.
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
  return createToken('00000000-0000-0000-0000-000000000099', 'admin@cutebunny.rental', 'superadmin');
}

describe('BUG-516: Top Products excludes deleted products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.order.count.mockResolvedValue(0);
    mockDb.order.groupBy.mockResolvedValue([]);
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.financeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mockDb.customer.count.mockResolvedValue(0);
    mockDb.product.count.mockResolvedValue(1);
  });

  it('GET /stats — topProducts findMany includes deletedAt:null filter', async () => {
    mockDb.product.findMany.mockResolvedValue([]);
    const token = await getAdminToken();

    const res = await app.request('/api/v1/admin/dashboard/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);

    // BUG-526: query no longer uses orderBy.rentalCount (sorted in JS from order_items).
    // Verify the product query still filters deleted products.
    const findManyCalls = mockDb.product.findMany.mock.calls;
    const topProductCall = findManyCalls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call: any[]) => call[0]?.where?.deletedAt === null && call[0]?.select?.sku,
    );

    expect(topProductCall).toBeDefined();
    expect(topProductCall![0].where).toEqual({ deletedAt: null });
  });

  it('GET /summary — topProducts query includes deletedAt:null filter', async () => {
    mockDb.product.findMany.mockResolvedValue([]);
    const token = await getAdminToken();

    const res = await app.request('/api/v1/admin/dashboard/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);

    // BUG-526: query no longer uses orderBy.rentalCount (sorted in JS from order_items).
    const findManyCalls = mockDb.product.findMany.mock.calls;
    const topProductCall = findManyCalls.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (call: any[]) => call[0]?.where?.deletedAt === null && call[0]?.select?.sku,
    );

    expect(topProductCall).toBeDefined();
    expect(topProductCall![0].where).toEqual({ deletedAt: null });
  });

  it('topProducts response contains only active products', async () => {
    const activeProduct = {
      id: 'prod-active',
      sku: 'DRESS-001',
      name: 'Active Wedding Dress',
      thumbnailUrl: 'https://example.com/active.jpg',
    };

    // BUG-532: rental count now comes from orderItem.findMany + JS aggregation
    mockDb.orderItem.findMany.mockResolvedValue(
      Array.from({ length: 20 }, () => ({ productId: 'prod-active' }))
    );

    mockDb.product.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      const where = args?.where as Record<string, unknown> | undefined;
      if (where?.deletedAt === null) {
        return [activeProduct];
      }
      return [];
    });

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/dashboard/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.top_products).toHaveLength(1);
    expect(body.data.top_products[0].name).toBe('Active Wedding Dress');
    expect(body.data.top_products[0].rental_count).toBe(20);
  });
});
