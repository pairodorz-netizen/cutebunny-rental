/**
 * BUG-521: Finance > Transactions deposit_returned displays as positive amount.
 *
 * Fix: deposit_returned is classified as outflow; amount is negated in response.
 * direction field is added to each transaction row.
 * deposit_returned is included in Total Expenses in summary/report endpoints.
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

describe('BUG-521: deposit_returned sign and direction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('transactions endpoint: deposit_returned has negative amount and direction=outflow', async () => {
    const depositTx = {
      id: 'tx-1',
      orderId: 'ord-1',
      productId: null,
      categoryId: null,
      txType: 'deposit_returned',
      amount: 4140,
      note: null,
      createdBy: null,
      createdAt: new Date('2026-05-10'),
      order: { orderNumber: 'ORD-26048933' },
      product: null,
      category: null,
    };

    mockDb.financeTransaction.findMany.mockResolvedValue([depositTx]);
    mockDb.financeTransaction.count.mockResolvedValue(1);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/transactions', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.data.data[0];

    expect(row.direction).toBe('outflow');
    expect(row.amount).toBe(-4140);
    expect(row.tx_type).toBe('deposit_returned');
  });

  it('transactions endpoint: rental_revenue has positive amount and direction=inflow', async () => {
    const revenueTx = {
      id: 'tx-2',
      orderId: 'ord-2',
      productId: 'prod-1',
      categoryId: null,
      txType: 'rental_revenue',
      amount: 2750,
      note: null,
      createdBy: null,
      createdAt: new Date('2026-05-10'),
      order: { orderNumber: 'ORD-26048934' },
      product: { name: 'Lace Bridal Gown', sku: 'WED-001' },
      category: null,
    };

    mockDb.financeTransaction.findMany.mockResolvedValue([revenueTx]);
    mockDb.financeTransaction.count.mockResolvedValue(1);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/transactions', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.data.data[0];

    expect(row.direction).toBe('inflow');
    expect(row.amount).toBe(2750);
  });

  it('transactions endpoint: category_name falls back to formatted txType (BUG-522)', async () => {
    const tx = {
      id: 'tx-3',
      orderId: null,
      productId: null,
      categoryId: null,
      txType: 'deposit_returned',
      amount: 1000,
      note: null,
      createdBy: null,
      createdAt: new Date('2026-05-10'),
      order: null,
      product: null,
      category: null,
    };

    mockDb.financeTransaction.findMany.mockResolvedValue([tx]);
    mockDb.financeTransaction.count.mockResolvedValue(1);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/transactions', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const row = body.data.data[0];

    expect(row.category_name).toBe('Deposit Returned');
    // BUG-537: deposit types are now classified as DEPOSIT, not EXPENSE
    expect(row.category_type).toBe('DEPOSIT');
  });

  it('BUG-537: summary endpoint: deposit_returned is NOT in total_expenses, shown separately', async () => {
    // BUG-220: include deposit_received so invariant (returned ≤ received) is satisfied
    const txData = [
      { txType: 'rental_revenue', amount: 2750, createdAt: new Date('2026-05-10'), category: null },
      { txType: 'deposit_received', amount: 5000, createdAt: new Date('2026-05-10'), category: null },
      { txType: 'deposit_returned', amount: 4140, createdAt: new Date('2026-05-10'), category: null },
    ];

    mockDb.financeTransaction.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      const include = args?.include as Record<string, unknown> | undefined;
      if (include?.category) return txData;
      if (include?.order) return txData.filter((t) => t.txType === 'rental_revenue').map((t) => ({ ...t, order: null }));
      return [];
    });
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.financeCategory.findMany.mockResolvedValue([]);
    // BUG-536: getProductRentalCounts uses $queryRaw
    mockDb.$queryRaw.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const totals = body.data.totals;

    expect(totals.total_revenue).toBe(2750);
    // BUG-537: deposit_returned is no longer in total_expenses
    expect(totals.total_expenses).toBe(0);
    expect(totals.net_profit).toBe(2750);
    // Deposit shown separately
    expect(totals.deposit_returned).toBe(4140);
    expect(totals.deposit_received).toBe(5000);
    expect(totals.net_deposit).toBe(860);
  });

  it('BUG-537: by_category tags deposit_returned as DEPOSIT type', async () => {
    const txData = [
      { txType: 'rental_revenue', amount: 2750, createdAt: new Date('2026-05-10'), category: null },
      { txType: 'deposit_returned', amount: 4140, createdAt: new Date('2026-05-10'), category: null },
    ];

    mockDb.financeTransaction.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      const include = args?.include as Record<string, unknown> | undefined;
      if (include?.category) return txData;
      if (include?.order) return txData.filter((t) => t.txType === 'rental_revenue').map((t) => ({ ...t, order: null }));
      return [];
    });
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.financeCategory.findMany.mockResolvedValue([]);
    mockDb.$queryRaw.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const depositCat = body.data.by_category.find((c: { category_name: string }) => c.category_name === 'deposit_returned');
    expect(depositCat).toBeDefined();
    expect(depositCat.category_type).toBe('DEPOSIT');
  });
});
