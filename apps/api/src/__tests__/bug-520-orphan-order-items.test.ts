/**
 * BUG-520: Orders with missing order_items or deleted products.
 *
 * The order list and detail endpoints must:
 * 1. Return items even when the associated product is hard-deleted (use snapshot fields).
 * 2. Render gracefully when order_items rows are missing (empty array, no crash).
 * 3. Batch-fetch product data separately to avoid FK failures.
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

const baseOrder = {
  id: 'order-001',
  orderNumber: 'ORD-26048933',
  status: 'finished',
  totalAmount: 4960,
  lateFee: 0,
  damageFee: 0,
  deposit: 4140,
  deliveryFee: 0,
  creditApplied: 0,
  deliveryMethod: 'pickup',
  returnMethod: 'pickup',
  messengerFeeSend: 0,
  messengerFeeReturn: 0,
  messengerDistanceKm: null,
  messengerPaymentMode: null,
  shippingSnapshot: null,
  rentalStartDate: new Date('2026-04-20'),
  rentalEndDate: new Date('2026-04-22'),
  createdAt: new Date('2026-04-22'),
  customer: {
    id: 'cust-001',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    phone: '0812345678',
    email: 'somchai@example.com',
    address: null,
    documents: [],
  },
  paymentSlips: [],
  statusLogs: [],
};

describe('BUG-520: Orphan order items / deleted product resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /orders/:id — returns empty items array when order has no order_items rows', async () => {
    mockDb.order.findUnique.mockResolvedValue({
      ...baseOrder,
      items: [],
    });
    mockDb.product.findMany.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/orders/order-001', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items).toEqual([]);
    expect(body.data.total_amount).toBe(4960);
  });

  it('GET /orders/:id — returns items with snapshot fields when product is deleted', async () => {
    const deletedProductId = 'prod-deleted-001';
    mockDb.order.findUnique.mockResolvedValue({
      ...baseOrder,
      items: [
        {
          id: 'item-001',
          orderId: 'order-001',
          productId: deletedProductId,
          productName: 'Vintage Lace Gown',
          size: 'M',
          quantity: 1,
          rentalPricePerDay: 410,
          subtotal: 820,
          status: 'returned',
          lateFee: 0,
          damageFee: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    // Product batch-fetch returns nothing (product hard-deleted)
    mockDb.product.findMany.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/orders/order-001', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].product_name).toBe('Vintage Lace Gown');
    expect(body.data.items[0].sku).toBe('');
    expect(body.data.items[0].thumbnail).toBeNull();
    expect(body.data.items[0].images).toEqual([]);
    expect(body.data.items[0].subtotal).toBe(820);
  });

  it('GET /orders/:id — enriches items with product data when product exists', async () => {
    const productId = 'prod-active-001';
    mockDb.order.findUnique.mockResolvedValue({
      ...baseOrder,
      items: [
        {
          id: 'item-002',
          orderId: 'order-001',
          productId,
          productName: 'Memo Doll Top',
          size: 'S',
          quantity: 1,
          rentalPricePerDay: 145,
          subtotal: 290,
          status: 'returned',
          lateFee: 0,
          damageFee: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    mockDb.product.findMany.mockResolvedValue([
      { id: productId, sku: 'MEMO-001', thumbnailUrl: 'https://example.com/memo.jpg', images: [{ id: 'img-1', url: 'https://example.com/full.jpg', altText: null, sortOrder: 0 }] },
    ]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/orders/order-001', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.items).toHaveLength(1);
    expect(body.data.items[0].product_name).toBe('Memo Doll Top');
    expect(body.data.items[0].sku).toBe('MEMO-001');
    expect(body.data.items[0].thumbnail).toBe('https://example.com/memo.jpg');
    expect(body.data.items[0].images).toHaveLength(1);
  });

  it('GET /orders — list endpoint uses snapshot fields when product missing', async () => {
    mockDb.order.findMany.mockResolvedValue([
      {
        ...baseOrder,
        items: [
          {
            id: 'item-003',
            productId: 'prod-gone',
            productName: 'Deleted Dress',
            size: 'L',
            quantity: 1,
            status: 'returned',
            subtotal: 590,
            lateFee: 0,
            damageFee: 0,
          },
        ],
      },
    ]);
    mockDb.order.count.mockResolvedValue(1);
    // Product not found (hard-deleted)
    mockDb.product.findMany.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/orders?page=1&page_size=10', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].items).toHaveLength(1);
    expect(body.data[0].items[0].product_name).toBe('Deleted Dress');
    expect(body.data[0].items[0].sku).toBe('');
    expect(body.data[0].items[0].thumbnail).toBeNull();
  });

  it('GET /orders — list endpoint handles product.findMany failure gracefully', async () => {
    mockDb.order.findMany.mockResolvedValue([
      {
        ...baseOrder,
        items: [
          {
            id: 'item-004',
            productId: 'prod-error',
            productName: 'Error Product',
            size: 'M',
            quantity: 1,
            status: 'pending',
            subtotal: 350,
            lateFee: 0,
            damageFee: 0,
          },
        ],
      },
    ]);
    mockDb.order.count.mockResolvedValue(1);
    // Simulate DB error on product fetch
    mockDb.product.findMany.mockRejectedValue(new Error('connection error'));

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/orders?page=1&page_size=10', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data[0].items[0].product_name).toBe('Error Product');
    expect(body.data[0].items[0].sku).toBe('');
  });
});
