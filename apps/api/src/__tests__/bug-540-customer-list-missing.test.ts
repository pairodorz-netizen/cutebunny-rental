/**
 * BUG-540: Admin customers list drops customers whose orders are all finished.
 *
 * Entire customer list endpoint now uses raw SQL ($queryRawUnsafe)
 * to bypass PrismaNeon adapter issues on Cloudflare Workers.
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
    // Health check
    mockDb.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
  });

  it('returns all customers with correct stats via raw SQL', async () => {
    // $queryRawUnsafe is called twice: list query (has LIMIT) + count query
    mockDb.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (!sql.includes('LIMIT')) {
        // Count query (no LIMIT)
        return [{ total: 5 }];
      }
      // List query — returns all 5 customers with LEFT JOIN stats
      return [
        { id: 'cust-5', firstName: 'มาลี', lastName: 'ดอกไม้', email: 'malee@test.com', phone: '0898765432', tier: 'standard', creditBalance: 0, createdAt: '2024-05-01T00:00:00.000Z', rentalCount: 1, totalPayment: 590 },
        { id: 'cust-4', firstName: 'สมชาย', lastName: 'ใจดี', email: 'somchai@test.com', phone: '0812345678', tier: 'standard', creditBalance: 0, createdAt: '2024-04-01T00:00:00.000Z', rentalCount: 1, totalPayment: 4960 },
        { id: 'cust-3', firstName: 'สมมุติ', lastName: '1', email: 'sommut@test.com', phone: '0777777777', tier: 'standard', creditBalance: 0, createdAt: '2024-03-01T00:00:00.000Z', rentalCount: 0, totalPayment: 0 },
        { id: 'cust-2', firstName: 'กฟหก', lastName: 'test', email: 'test@test.com', phone: '0888888888', tier: 'standard', creditBalance: 0, createdAt: '2024-02-01T00:00:00.000Z', rentalCount: 0, totalPayment: 0 },
        { id: 'cust-1', firstName: 'ไพโรจน์', lastName: 'ทรงดำรงทัศน์', email: 'pairoj@test.com', phone: '0999999999', tier: 'standard', creditBalance: 0, createdAt: '2024-01-01T00:00:00.000Z', rentalCount: 2, totalPayment: 640 },
      ];
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
    expect(body.meta.total).toBe(5);

    // Finished-only customers appear with correct stats
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

  it('uses $queryRawUnsafe (not Prisma findMany) for customer list', async () => {
    mockDb.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (!sql.includes('LIMIT')) return [{ total: 0 }];
      return [];
    });

    const token = await getAdminToken();
    await app.request('/api/v1/admin/customers?page=1&per_page=20', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // $queryRawUnsafe should be called (raw SQL for entire list)
    expect(mockDb.$queryRawUnsafe).toHaveBeenCalled();

    // customer.findMany should NOT be called
    expect(mockDb.customer.findMany).not.toHaveBeenCalled();
    expect(mockDb.customer.count).not.toHaveBeenCalled();
  });

  it('passes search filter to raw SQL', async () => {
    mockDb.$queryRawUnsafe.mockImplementation(async (sql: string) => {
      if (!sql.includes('LIMIT')) return [{ total: 0 }];
      return [];
    });

    const token = await getAdminToken();
    await app.request('/api/v1/admin/customers?page=1&per_page=20&search=somchai', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Verify search param is passed in the query
    const calls = mockDb.$queryRawUnsafe.mock.calls;
    // List query contains LIMIT, count query does not
    const listCall = calls.find((c: unknown[]) => (c[0] as string).includes('LIMIT'));
    expect(listCall).toBeDefined();
    // Search pattern should include ILIKE
    expect(listCall[0]).toContain('ILIKE');
    // The search pattern should be passed as a parameter
    expect(listCall).toContain('%somchai%');
  });
});
