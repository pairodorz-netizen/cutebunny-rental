/**
 * BUG-540: Admin customers list — raw SQL with correct soft-delete filter.
 *
 * Customers table has no deleted_at column. Soft-deleted records are
 * identified by the email prefix 'deleted_'. The endpoint uses $queryRaw
 * tagged template with `WHERE c.email NOT LIKE 'deleted_%'`.
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

/** Helper: join tagged template strings to inspect the SQL */
function joinTemplate(args: unknown[]): string {
  const strings = args[0] as string[];
  return Array.isArray(strings) ? strings.join('?') : String(strings);
}

describe('BUG-540: Customer list filters by email prefix soft-delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all customers with correct stats via $queryRaw tagged template', async () => {
    // $queryRaw is called: health check + list query + count query
    mockDb.$queryRaw.mockImplementation(async (...args: unknown[]) => {
      const sql = joinTemplate(args);
      if (sql.includes('LIMIT')) {
        // List query — returns all 5 customers with LEFT JOIN stats
        return [
          { id: 'cust-5', firstName: 'มาลี', lastName: 'ดอกไม้', email: 'malee@test.com', phone: '0898765432', tier: 'standard', creditBalance: 0, createdAt: '2024-05-01T00:00:00.000Z', rentalCount: 1, totalPayment: 590 },
          { id: 'cust-4', firstName: 'สมชาย', lastName: 'ใจดี', email: 'somchai@test.com', phone: '0812345678', tier: 'standard', creditBalance: 0, createdAt: '2024-04-01T00:00:00.000Z', rentalCount: 1, totalPayment: 4960 },
          { id: 'cust-3', firstName: 'สมมุติ', lastName: '1', email: 'sommut@test.com', phone: '0777777777', tier: 'standard', creditBalance: 0, createdAt: '2024-03-01T00:00:00.000Z', rentalCount: 0, totalPayment: 0 },
          { id: 'cust-2', firstName: 'กฟหก', lastName: 'test', email: 'test@test.com', phone: '0888888888', tier: 'standard', creditBalance: 0, createdAt: '2024-02-01T00:00:00.000Z', rentalCount: 0, totalPayment: 0 },
          { id: 'cust-1', firstName: 'ไพโรจน์', lastName: 'ทรงดำรงทัศน์', email: 'pairoj@test.com', phone: '0999999999', tier: 'standard', creditBalance: 0, createdAt: '2024-01-01T00:00:00.000Z', rentalCount: 2, totalPayment: 640 },
        ];
      }
      if (sql.includes('COUNT')) {
        return [{ total: 5 }];
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

  it('SQL uses email prefix soft-delete filter (NOT LIKE deleted_%)', async () => {
    mockDb.$queryRaw.mockImplementation(async (...args: unknown[]) => {
      const sql = joinTemplate(args);
      if (sql.includes('LIMIT')) return [];
      if (sql.includes('COUNT')) return [{ total: 0 }];
      return [{ '?column?': 1 }];
    });

    const token = await getAdminToken();
    await app.request('/api/v1/admin/customers?page=1&per_page=20', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Both list and count queries must filter with email prefix pattern
    const calls = mockDb.$queryRaw.mock.calls;
    const listCall = calls.find((c: unknown[]) => joinTemplate(c).includes('LIMIT'));
    const countCall = calls.find((c: unknown[]) =>
      joinTemplate(c).includes('COUNT') && !joinTemplate(c).includes('LIMIT'),
    );

    expect(joinTemplate(listCall)).toContain("NOT LIKE 'deleted_%'");
    expect(joinTemplate(countCall)).toContain("NOT LIKE 'deleted_%'");

    // Must NOT reference deleted_at (customers table has no such column)
    expect(joinTemplate(listCall)).not.toContain('deleted_at');
    expect(joinTemplate(countCall)).not.toContain('deleted_at');
  });

  it('uses $queryRaw tagged template (not Prisma findMany) for customer list', async () => {
    mockDb.$queryRaw.mockImplementation(async (...args: unknown[]) => {
      const sql = joinTemplate(args);
      if (sql.includes('LIMIT')) return [];
      if (sql.includes('COUNT')) return [{ total: 0 }];
      return [{ '?column?': 1 }];
    });

    const token = await getAdminToken();
    await app.request('/api/v1/admin/customers?page=1&per_page=20', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // $queryRaw should be called (tagged template for entire list)
    expect(mockDb.$queryRaw).toHaveBeenCalled();

    // customer.findMany should NOT be called
    expect(mockDb.customer.findMany).not.toHaveBeenCalled();
    expect(mockDb.customer.count).not.toHaveBeenCalled();
  });

  it('passes search filter to $queryRaw tagged template', async () => {
    mockDb.$queryRaw.mockImplementation(async (...args: unknown[]) => {
      const sql = joinTemplate(args);
      if (sql.includes('LIMIT')) return [];
      if (sql.includes('COUNT')) return [{ total: 0 }];
      return [{ '?column?': 1 }];
    });

    const token = await getAdminToken();
    await app.request('/api/v1/admin/customers?page=1&per_page=20&search=somchai', {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Verify $queryRaw was called with ILIKE in the template
    const calls = mockDb.$queryRaw.mock.calls;
    const listCall = calls.find((c: unknown[]) => joinTemplate(c).includes('LIMIT'));
    expect(listCall).toBeDefined();
    expect(joinTemplate(listCall)).toContain('ILIKE');

    // The search pattern should be passed as one of the interpolated values
    const values = listCall.slice(1);
    expect(values).toContain('%somchai%');
  });
});
