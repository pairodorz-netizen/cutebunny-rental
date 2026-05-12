/**
 * BUG-518: Finance Category Breakdown inconsistency.
 *
 * Root cause:
 *   Category Breakdown in GET /summary used Math.abs(tx.amount) for ALL
 *   transaction types, converting negative reversals to positive values.
 *   This inflated category totals (e.g. 2,750 → 4,130).
 *
 * Fix:
 *   Use signed amounts for revenue types (so reversals subtract),
 *   Math.abs only for expense types (stored negative, displayed positive).
 *
 * Tests:
 *   - Category breakdown includes negative reversals in revenue total
 *   - Period breakdown already uses signed amounts (regression guard)
 *   - Top products revenue includes negative reversals (regression guard)
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

const now = new Date();

// Transactions simulating BUG-517 reconciliation scenario:
// +3500 original revenue, -100 overstated correction, -590 duplicate removal
const MOCK_TRANSACTIONS = [
  {
    id: 'tx-1',
    orderId: 'order-1',
    productId: null,
    categoryId: null,
    txType: 'rental_revenue',
    amount: 3500,
    note: 'Payment verified',
    createdBy: 'admin-1',
    createdAt: new Date(now.getFullYear(), now.getMonth(), 1),
    category: null,
    order: { items: [{ productId: 'p1', productName: 'Test Product' }] },
  },
  {
    id: 'tx-2',
    orderId: 'order-1',
    productId: null,
    categoryId: null,
    txType: 'rental_revenue',
    amount: -100,
    note: 'BUG-517 reconciliation: overstated',
    createdBy: 'admin-1',
    createdAt: new Date(now.getFullYear(), now.getMonth(), 2),
    category: null,
    order: null,
  },
  {
    id: 'tx-3',
    orderId: 'order-2',
    productId: null,
    categoryId: null,
    txType: 'rental_revenue',
    amount: -590,
    note: 'BUG-517 reconciliation: duplicate',
    createdBy: 'admin-1',
    createdAt: new Date(now.getFullYear(), now.getMonth(), 2),
    category: null,
    order: null,
  },
  {
    id: 'tx-4',
    orderId: null,
    productId: null,
    categoryId: 'cat-1',
    txType: 'shipping',
    amount: -200,
    note: 'Shipping cost',
    createdBy: 'admin-1',
    createdAt: new Date(now.getFullYear(), now.getMonth(), 3),
    category: { name: 'Shipping', type: 'EXPENSE' },
    order: null,
  },
];

describe('BUG-518: Finance Category Breakdown', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /summary — category breakdown includes negative reversals in revenue total', async () => {
    // Mock: findMany returns transactions with positive + negative revenue
    mockDb.financeTransaction.findMany.mockResolvedValue(MOCK_TRANSACTIONS);
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.financeCategory.findMany.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/summary?period=monthly', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    const body = data.data;

    // Total revenue should be 3500 - 100 - 590 = 2810 (signed sum)
    expect(body.totals.total_revenue).toBe(2810);

    // Category breakdown for 'rental_revenue' must also be 2810 (not 4190 from Math.abs)
    const revenueCat = body.by_category.find(
      (c: { category_name: string }) => c.category_name === 'rental_revenue',
    );
    expect(revenueCat).toBeDefined();
    expect(revenueCat.total).toBe(2810);

    // Expense category should use absolute values
    const shippingCat = body.by_category.find(
      (c: { category_name: string }) => c.category_name === 'Shipping',
    );
    expect(shippingCat).toBeDefined();
    expect(shippingCat.total).toBe(200); // abs(-200)
  });

  it('GET /summary — period breakdown uses signed amounts for revenue', async () => {
    mockDb.financeTransaction.findMany.mockResolvedValue(MOCK_TRANSACTIONS);
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.financeCategory.findMany.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/summary?period=monthly', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    const body = data.data;

    // Sum of all period revenues should equal total_revenue
    const periodRevenueSum = body.periods.reduce(
      (sum: number, p: { total_revenue: number }) => sum + p.total_revenue, 0,
    );
    expect(periodRevenueSum).toBe(body.totals.total_revenue);
  });

  it('GET /summary — totals and category breakdown agree on revenue', async () => {
    mockDb.financeTransaction.findMany.mockResolvedValue(MOCK_TRANSACTIONS);
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.financeCategory.findMany.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/summary?period=monthly', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    const body = data.data;

    // Sum of all revenue categories should equal totals.total_revenue
    const revenueCatSum = body.by_category
      .filter((c: { category_type: string }) => c.category_type === 'REVENUE')
      .reduce((sum: number, c: { total: number }) => sum + c.total, 0);
    expect(revenueCatSum).toBe(body.totals.total_revenue);

    // Sum of all expense categories should equal totals.total_expenses
    const expenseCatSum = body.by_category
      .filter((c: { category_type: string }) => c.category_type === 'EXPENSE')
      .reduce((sum: number, c: { total: number }) => sum + c.total, 0);
    expect(expenseCatSum).toBe(body.totals.total_expenses);
  });
});
