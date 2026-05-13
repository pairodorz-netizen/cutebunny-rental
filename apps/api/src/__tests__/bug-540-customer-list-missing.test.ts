/**
 * BUG-540: Admin customers list drops customers whose orders are all finished.
 *
 * getCustomerRentalStats must include 'finished' orders and use raw SQL
 * to avoid PrismaNeon adapter issues on Cloudflare Workers.
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
    $queryRaw: vi.fn().mockResolvedValue([]),
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

describe('BUG-540: Customer list includes all non-deleted customers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns customers with only finished orders and correct stats', async () => {
    // 5 customers: 3 with active orders, 2 with only finished orders
    const allCustomers = [
      { id: 'cust-1', firstName: 'ไพโรจน์', lastName: 'ทรงดำรงทัศน์', email: 'pairoj@test.com', phone: '0999999999', tier: 'standard', rentalCount: 0, totalPayment: 0, creditBalance: 0, createdAt: new Date('2024-01-01') },
      { id: 'cust-2', firstName: 'กฟหก', lastName: 'test', email: 'test@test.com', phone: '0888888888', tier: 'standard', rentalCount: 0, totalPayment: 0, creditBalance: 0, createdAt: new Date('2024-02-01') },
      { id: 'cust-3', firstName: 'สมมุติ', lastName: '1', email: 'sommut@test.com', phone: '0777777777', tier: 'standard', rentalCount: 0, totalPayment: 0, creditBalance: 0, createdAt: new Date('2024-03-01') },
      { id: 'cust-4', firstName: 'สมชาย', lastName: 'ใจดี', email: 'somchai@test.com', phone: '0812345678', tier: 'standard', rentalCount: 0, totalPayment: 0, creditBalance: 0, createdAt: new Date('2024-04-01') },
      { id: 'cust-5', firstName: 'มาลี', lastName: 'ดอกไม้', email: 'malee@test.com', phone: '0898765432', tier: 'standard', rentalCount: 0, totalPayment: 0, creditBalance: 0, createdAt: new Date('2024-05-01') },
    ];

    mockDb.customer.findMany.mockResolvedValue(allCustomers);
    mockDb.customer.count.mockResolvedValue(5);

    // Raw SQL returns stats including finished orders
    mockDb.$queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const query = strings.join('');
      if (query.includes('order_items') && query.includes('customer_id')) {
        // Customer rental stats: includes finished orders
        return [
          { customerId: 'cust-1', rentalCount: 2, totalPayment: 640 },
          { customerId: 'cust-4', rentalCount: 1, totalPayment: 4960 }, // finished-only customer
          { customerId: 'cust-5', rentalCount: 1, totalPayment: 590 },  // finished-only customer
        ];
      }
      // Health check
      return [{ '?column?': 1 }];
    });

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/customers?page=1&per_page=20', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const data = body.data;

    // All 5 customers must be returned
    expect(data).toHaveLength(5);

    // Finished-only customers must appear with correct stats
    const somchai = data.find((c: { name: string }) => c.name.includes('สมชาย'));
    expect(somchai).toBeDefined();
    expect(somchai.rental_count).toBe(1);
    expect(somchai.total_payment).toBe(4960);

    const malee = data.find((c: { name: string }) => c.name.includes('มาลี'));
    expect(malee).toBeDefined();
    expect(malee.rental_count).toBe(1);
    expect(malee.total_payment).toBe(590);

    // Customers without stats get 0
    const test = data.find((c: { name: string }) => c.name.includes('กฟหก'));
    expect(test).toBeDefined();
    expect(test.rental_count).toBe(0);
    expect(test.total_payment).toBe(0);
  });

  it('getCustomerRentalStats uses raw SQL (not Prisma findMany)', async () => {
    mockDb.customer.findMany.mockResolvedValue([]);
    mockDb.customer.count.mockResolvedValue(0);
    mockDb.$queryRaw.mockResolvedValue([]);

    const token = await getAdminToken();
    await app.request('/api/v1/admin/customers?page=1&per_page=20', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // $queryRaw should be called (raw SQL for stats)
    expect(mockDb.$queryRaw).toHaveBeenCalled();

    // order.findMany should NOT be called (no longer uses Prisma for stats)
    expect(mockDb.order.findMany).not.toHaveBeenCalled();
  });
});
