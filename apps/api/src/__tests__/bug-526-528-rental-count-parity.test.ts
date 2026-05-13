/**
 * BUG-526/528: Rental count parity across Dashboard, Finance, Products, Customers.
 *
 * All endpoints must return the same rental count for a given product,
 * computed from actual order_items (not the stale products.rental_count column).
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

describe('BUG-526/528: Rental count parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mocks
    mockDb.order.count.mockResolvedValue(0);
    mockDb.order.groupBy.mockResolvedValue([]);
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.financeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
    mockDb.customer.count.mockResolvedValue(0);
    mockDb.product.count.mockResolvedValue(0);

    // BUG-526: orderItem.groupBy returns actual rental counts
    mockDb.orderItem.groupBy.mockResolvedValue([
      { productId: 'prod-boho', _count: { id: 2 } },
      { productId: 'prod-lace', _count: { id: 1 } },
      { productId: 'prod-memo', _count: { id: 1 } },
    ]);
  });

  it('Dashboard /stats top_products uses actual rental counts from order_items', async () => {
    mockDb.product.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      const where = args?.where as Record<string, unknown> | undefined;
      const select = args?.select as Record<string, unknown> | undefined;
      if (where?.deletedAt === null && select && !select.stockOnHand) {
        return [
          { id: 'prod-boho', sku: 'CAS-001', name: 'Bohemian Maxi Dress', thumbnailUrl: null },
          { id: 'prod-lace', sku: 'WED-001', name: 'Lace Bridal Gown', thumbnailUrl: null },
          { id: 'prod-memo', sku: 'TOP-001', name: 'Memo Doll Top', thumbnailUrl: null },
        ];
      }
      return [];
    });

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/dashboard/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const topProducts = body.data.top_products;

    expect(topProducts[0].name).toBe('Bohemian Maxi Dress');
    expect(topProducts[0].rental_count).toBe(2);
    expect(topProducts[1].rental_count).toBe(1);
  });

  it('Products list /admin/products uses actual rental counts from order_items', async () => {
    mockDb.product.findMany.mockResolvedValue([
      {
        id: 'prod-boho',
        sku: 'CAS-001',
        name: 'Bohemian Maxi Dress',
        nameI18n: null,
        categoryRef: { slug: 'casual' },
        categoryId: 'cat-1',
        brand: null,
        images: [],
        thumbnailUrl: null,
        size: ['M'],
        color: ['white'],
        rentalPrice1Day: 350,
        rentalPrice3Day: 900,
        rentalPrice5Day: 1400,
        retailPrice: 0,
        deposit: 1000,
        stockQuantity: 1,
        stockOnHand: 1,
        lowStockThreshold: 2,
        rentalCount: 0, // stale column value
        available: true,
        costPrice: 500,
        sellingPrice: 0,
        productStatus: 'active',
        soldAt: null,
        deletedAt: null,
        variableCost: 0,
        extraDayRate: 50,
        createdAt: new Date('2026-01-01'),
      },
    ]);
    mockDb.product.count.mockResolvedValue(1);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/products', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // rental_count should be 2 (from orderItem.groupBy), NOT 0 (from stale column)
    expect(body.data[0].rental_count).toBe(2);
  });

  it('Customers list /admin/customers uses actual rental counts', async () => {
    mockDb.order.findMany.mockResolvedValue([
      {
        customerId: 'cust-1',
        totalAmount: 1350,
        items: [{ id: 'oi-1' }, { id: 'oi-2' }],
      },
    ]);

    mockDb.customer.findMany.mockResolvedValue([
      {
        id: 'cust-1',
        firstName: 'Test',
        lastName: 'Customer',
        email: 'test@test.com',
        phone: '0812345678',
        tier: 'standard',
        rentalCount: 0, // stale
        totalPayment: 0, // stale
        creditBalance: 0,
        createdAt: new Date('2026-01-01'),
      },
    ]);
    mockDb.customer.count.mockResolvedValue(1);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/customers', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data[0].rental_count).toBe(2);
    expect(body.data[0].total_payment).toBe(1350);
  });
});
