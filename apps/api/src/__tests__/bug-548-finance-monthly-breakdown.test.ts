/**
 * BUG-548: Finance Summary monthly breakdown shows 0 expenses.
 *
 * Root cause: variable costs (product.variableCost × rental count) were only
 * added to the grand-total `total_expenses` but NOT distributed into the
 * per-period breakdown. The period loop only aggregated financeTransaction
 * records (shipping, cogs, etc.) which were empty for most tenants.
 *
 * Fix: a date-filtered $queryRaw joins order_items → orders → products to
 * get per-item variable costs, then aggregates them into each period's
 * expenses alongside transaction-based expenses.
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

describe('BUG-548: Finance monthly breakdown variable costs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('period breakdown includes variable costs per month', async () => {
    const txData = [
      { txType: 'rental_revenue', amount: 290, createdAt: new Date('2026-04-15'), category: null },
      { txType: 'rental_revenue', amount: 590, createdAt: new Date('2026-05-10'), category: null },
    ];

    mockDb.financeTransaction.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      const include = args?.include as Record<string, unknown> | undefined;
      if (include?.category) return txData;
      if (include?.order) return txData.map((t) => ({ ...t, order: null }));
      return [];
    });
    mockDb.order.findMany.mockResolvedValue([
      { createdAt: new Date('2026-04-15') },
      { createdAt: new Date('2026-05-10') },
    ]);
    mockDb.financeCategory.findMany.mockResolvedValue([]);

    // BUG-548: mock $queryRaw to return per-item variable costs for VC query
    // and rental counts for getProductRentalCounts
    mockDb.$queryRaw.mockImplementation(async (...args: unknown[]) => {
      const strings = args[0];
      if (Array.isArray(strings) && strings.some((s: string) => typeof s === 'string' && s.includes('variable_cost'))) {
        return [
          { createdAt: new Date('2026-04-15'), variableCost: 100 },
          { createdAt: new Date('2026-05-10'), variableCost: 200 },
        ];
      }
      // getProductRentalCounts
      return [
        { productId: 'prod-1', count: 1 },
        { productId: 'prod-2', count: 1 },
      ];
    });

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/summary?period=monthly', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Period breakdown should include variable costs
    const apr = body.data.periods.find((p: { period_label: string }) => p.period_label === '2026-04');
    const may = body.data.periods.find((p: { period_label: string }) => p.period_label === '2026-05');

    expect(apr).toBeDefined();
    expect(apr.total_expenses).toBe(100); // VC from April order
    expect(apr.total_revenue).toBe(290);

    expect(may).toBeDefined();
    expect(may.total_expenses).toBe(200); // VC from May order
    expect(may.total_revenue).toBe(590);

    // Grand total should match sum of periods
    expect(body.data.totals.total_expenses).toBe(300); // 100 + 200
    expect(body.data.totals.total_variable_costs).toBe(300);
    expect(body.data.totals.total_revenue).toBe(880); // 290 + 590
  });

  it('period breakdown shows 0 expenses when no variable costs or transactions', async () => {
    mockDb.financeTransaction.findMany.mockResolvedValue([]);
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.financeCategory.findMany.mockResolvedValue([]);
    mockDb.$queryRaw.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data.periods).toHaveLength(0);
    expect(body.data.totals.total_expenses).toBe(0);
    expect(body.data.totals.total_variable_costs).toBe(0);
  });

  it('combines transaction expenses and variable costs in same period', async () => {
    const txData = [
      { txType: 'rental_revenue', amount: 500, createdAt: new Date('2026-05-10'), category: null },
      { txType: 'shipping', amount: -50, createdAt: new Date('2026-05-10'), category: null },
    ];

    mockDb.financeTransaction.findMany.mockImplementation(async (args: Record<string, unknown>) => {
      const include = args?.include as Record<string, unknown> | undefined;
      if (include?.category) return txData;
      if (include?.order) return txData.filter((t) => t.txType === 'rental_revenue').map((t) => ({ ...t, order: null }));
      return [];
    });
    mockDb.order.findMany.mockResolvedValue([{ createdAt: new Date('2026-05-10') }]);
    mockDb.financeCategory.findMany.mockResolvedValue([]);

    mockDb.$queryRaw.mockImplementation(async (...args: unknown[]) => {
      const strings = args[0];
      if (Array.isArray(strings) && strings.some((s: string) => typeof s === 'string' && s.includes('variable_cost'))) {
        return [{ createdAt: new Date('2026-05-10'), variableCost: 100 }];
      }
      return [];
    });

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/finance/summary?period=monthly', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    const may = body.data.periods.find((p: { period_label: string }) => p.period_label === '2026-05');
    expect(may).toBeDefined();
    // shipping (50) + variable cost (100) = 150
    expect(may.total_expenses).toBe(150);
    expect(may.total_revenue).toBe(500);
    expect(may.net_profit).toBe(350); // 500 - 150

    expect(body.data.totals.total_expenses).toBe(150);
  });
});
