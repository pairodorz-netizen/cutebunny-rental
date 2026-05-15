/**
 * BUG-544: Product P&L formula tests.
 *
 * Validates:
 *   1. Paid/paid_locked orders are included in rental count and revenue
 *   2. Variable cost is deducted: gross_profit = revenue - (VC × rentals)
 *   3. Net P/L = revenue - buying_cost - (VC × rentals) + selling_price
 *   4. Unpaid/cancelled orders are excluded from P&L
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

describe('BUG-544 — Product P&L formula', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeProduct(overrides: Record<string, unknown> = {}) {
    return {
      id: '00000000-0000-0000-0000-000000000001',
      sku: 'T021',
      name: 'Memo Doll Top',
      nameI18n: { en: 'Memo Doll Top', th: 'เมโม่ ดอลล์ ท็อป' },
      description: 'Test product',
      categoryId: '00000000-0000-0000-0000-0000000000c1',
      categoryRef: { slug: 'tops' },
      brandId: null,
      brand: null,
      thumbnailUrl: 'https://example.com/thumb.jpg',
      images: [],
      size: ['S'],
      color: ['pink'],
      rentalPrice1Day: 290,
      rentalPrice3Day: 350,
      rentalPrice5Day: 450,
      retailPrice: 0,
      costPrice: 1000,
      sellingPrice: 0,
      variableCost: 100,
      deposit: 500,
      stockQuantity: 1,
      stockOnHand: 1,
      lowStockThreshold: 1,
      rentalCount: 0,
      currency: 'THB',
      available: true,
      productStatus: 'active',
      soldAt: null,
      extraDayRate: 50,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      orderItems: [],
      ...overrides,
    };
  }

  function makeOrderItem(status: string, subtotal: number) {
    return {
      subtotal,
      order: {
        id: `order-${Math.random().toString(36).slice(2)}`,
        orderNumber: `ORD-${Math.floor(Math.random() * 99999999)}`,
        status,
        rentalStartDate: new Date('2026-06-01'),
        rentalEndDate: new Date('2026-06-03'),
        totalDays: 3,
        createdAt: new Date('2026-06-01'),
        customer: { firstName: 'Test', lastName: 'User', phone: '0800000000', email: 'test@test.com' },
      },
    };
  }

  it('includes paid_locked orders in rental count and revenue', async () => {
    const { default: app } = await import('../routes/admin/products');
    const product = makeProduct({
      orderItems: [
        makeOrderItem('paid_locked', 290),
      ],
    });
    mockDb.product.findUnique.mockResolvedValue(product);

    const res = await app.request('/test-id/detail', {
      method: 'GET',
      headers: { Authorization: 'Bearer test' },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const pl = body.data.profit_summary;

    expect(pl.rental_count).toBe(1);
    expect(pl.total_rental_revenue).toBe(290);
    expect(pl.variable_cost_per_rental).toBe(100);
    expect(pl.total_variable_cost).toBe(100);
    expect(pl.gross_profit).toBe(190); // 290 - 100
    expect(pl.net_pl).toBe(-810); // 290 - 1000 - 100 + 0
  });

  it('includes shipped orders in rental count and revenue', async () => {
    const { default: app } = await import('../routes/admin/products');
    const product = makeProduct({
      orderItems: [
        makeOrderItem('shipped', 350),
      ],
    });
    mockDb.product.findUnique.mockResolvedValue(product);

    const res = await app.request('/test-id/detail', {
      method: 'GET',
      headers: { Authorization: 'Bearer test' },
    });

    const body = await res.json();
    const pl = body.data.profit_summary;

    expect(pl.rental_count).toBe(1);
    expect(pl.total_rental_revenue).toBe(350);
    expect(pl.gross_profit).toBe(250); // 350 - 100
  });

  it('excludes unpaid and cancelled orders from P&L', async () => {
    const { default: app } = await import('../routes/admin/products');
    const product = makeProduct({
      orderItems: [
        makeOrderItem('unpaid', 500),
        makeOrderItem('cancelled', 300),
        makeOrderItem('paid_locked', 290),
      ],
    });
    mockDb.product.findUnique.mockResolvedValue(product);

    const res = await app.request('/test-id/detail', {
      method: 'GET',
      headers: { Authorization: 'Bearer test' },
    });

    const body = await res.json();
    const pl = body.data.profit_summary;

    expect(pl.rental_count).toBe(1); // Only paid_locked
    expect(pl.total_rental_revenue).toBe(290);
    expect(pl.total_variable_cost).toBe(100);
  });

  it('calculates correct P&L with multiple rentals', async () => {
    const { default: app } = await import('../routes/admin/products');
    const product = makeProduct({
      costPrice: 2000,
      variableCost: 100,
      sellingPrice: 0,
      orderItems: [
        makeOrderItem('paid_locked', 290),
        makeOrderItem('finished', 350),
        makeOrderItem('returned', 500),
      ],
    });
    mockDb.product.findUnique.mockResolvedValue(product);

    const res = await app.request('/test-id/detail', {
      method: 'GET',
      headers: { Authorization: 'Bearer test' },
    });

    const body = await res.json();
    const pl = body.data.profit_summary;

    // 3 rentals: 290 + 350 + 500 = 1140 revenue
    expect(pl.rental_count).toBe(3);
    expect(pl.total_rental_revenue).toBe(1140);
    // VC = 100 × 3 = 300
    expect(pl.total_variable_cost).toBe(300);
    // Gross = 1140 - 300 = 840
    expect(pl.gross_profit).toBe(840);
    // Net = 1140 - 2000 - 300 + 0 = -1160
    expect(pl.net_pl).toBe(-1160);
  });

  it('includes selling_price in net_pl when product is sold', async () => {
    const { default: app } = await import('../routes/admin/products');
    const product = makeProduct({
      costPrice: 1000,
      variableCost: 100,
      sellingPrice: 5000,
      productStatus: 'sold',
      orderItems: [
        makeOrderItem('finished', 290),
      ],
    });
    mockDb.product.findUnique.mockResolvedValue(product);

    const res = await app.request('/test-id/detail', {
      method: 'GET',
      headers: { Authorization: 'Bearer test' },
    });

    const body = await res.json();
    const pl = body.data.profit_summary;

    expect(pl.rental_count).toBe(1);
    expect(pl.total_rental_revenue).toBe(290);
    expect(pl.gross_profit).toBe(190); // 290 - 100
    // Net = 290 - 1000 - 100 + 5000 = 4190
    expect(pl.net_pl).toBe(4190);
    expect(pl.selling_price).toBe(5000);
  });

  it('handles zero variable cost gracefully', async () => {
    const { default: app } = await import('../routes/admin/products');
    const product = makeProduct({
      variableCost: 0,
      orderItems: [
        makeOrderItem('paid_locked', 290),
      ],
    });
    mockDb.product.findUnique.mockResolvedValue(product);

    const res = await app.request('/test-id/detail', {
      method: 'GET',
      headers: { Authorization: 'Bearer test' },
    });

    const body = await res.json();
    const pl = body.data.profit_summary;

    expect(pl.variable_cost_per_rental).toBe(0);
    expect(pl.total_variable_cost).toBe(0);
    expect(pl.gross_profit).toBe(290);
  });

  it('handles null variable cost (defaults to 0)', async () => {
    const { default: app } = await import('../routes/admin/products');
    const product = makeProduct({
      variableCost: null,
      orderItems: [
        makeOrderItem('paid_locked', 290),
      ],
    });
    mockDb.product.findUnique.mockResolvedValue(product);

    const res = await app.request('/test-id/detail', {
      method: 'GET',
      headers: { Authorization: 'Bearer test' },
    });

    const body = await res.json();
    const pl = body.data.profit_summary;

    expect(pl.variable_cost_per_rental).toBe(0);
    expect(pl.total_variable_cost).toBe(0);
    expect(pl.gross_profit).toBe(290);
  });
});
