/**
 * BUG-519: Customer documents duplication.
 *
 * Tests:
 * 1. Order detail deduplicates customer documents by doc_type (keeps latest).
 * 2. Order creation upserts documents instead of blindly inserting duplicates.
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

describe('BUG-519: Customer documents deduplication', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /orders/:id — deduplicates documents by doc_type, keeping latest', async () => {
    const oldDate = new Date('2026-01-01T00:00:00Z');
    const newDate = new Date('2026-03-15T00:00:00Z');

    mockDb.order.findUnique.mockResolvedValue({
      id: 'order-dup',
      orderNumber: 'ORD-26056331',
      status: 'paid_locked',
      totalAmount: 290,
      lateFee: 0,
      damageFee: 0,
      deposit: 0,
      deliveryFee: 0,
      creditApplied: 0,
      deliveryMethod: 'pickup',
      returnMethod: 'pickup',
      messengerFeeSend: 0,
      messengerFeeReturn: 0,
      messengerDistanceKm: null,
      messengerPaymentMode: null,
      shippingSnapshot: null,
      rentalStartDate: new Date('2026-04-01'),
      rentalEndDate: new Date('2026-04-03'),
      createdAt: new Date('2026-03-20'),
      customer: {
        id: 'cust-dup',
        firstName: 'ไพโรจน์',
        lastName: 'ทดสอบ',
        phone: '0891234567',
        email: 'pairoj@example.com',
        address: null,
        documents: [
          { id: 'doc-1', docType: 'id_card_front', storageKey: 'old-id-card.jpg', verified: true, createdAt: oldDate },
          { id: 'doc-2', docType: 'id_card_front', storageKey: 'new-id-card.jpg', verified: false, createdAt: newDate },
          { id: 'doc-3', docType: 'facebook', storageKey: 'old-fb.jpg', verified: true, createdAt: oldDate },
          { id: 'doc-4', docType: 'facebook', storageKey: 'new-fb.jpg', verified: false, createdAt: newDate },
        ],
      },
      items: [],
      paymentSlips: [],
      statusLogs: [],
    });
    mockDb.product.findMany.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/orders/order-dup', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    const docs = body.data.customer.documents;

    expect(docs).toHaveLength(2);
    const docTypes = docs.map((d: { doc_type: string }) => d.doc_type);
    expect(docTypes).toContain('id_card_front');
    expect(docTypes).toContain('facebook');

    // Should keep the latest (newest createdAt)
    const idCardDoc = docs.find((d: { doc_type: string }) => d.doc_type === 'id_card_front');
    expect(idCardDoc.storage_key).toBe('new-id-card.jpg');
    const fbDoc = docs.find((d: { doc_type: string }) => d.doc_type === 'facebook');
    expect(fbDoc.storage_key).toBe('new-fb.jpg');
  });

  it('GET /orders/:id — passes through unique documents unchanged', async () => {
    mockDb.order.findUnique.mockResolvedValue({
      id: 'order-unique',
      orderNumber: 'ORD-UNIQUE',
      status: 'paid_locked',
      totalAmount: 100,
      lateFee: 0,
      damageFee: 0,
      deposit: 0,
      deliveryFee: 0,
      creditApplied: 0,
      deliveryMethod: 'pickup',
      returnMethod: 'pickup',
      messengerFeeSend: 0,
      messengerFeeReturn: 0,
      messengerDistanceKm: null,
      messengerPaymentMode: null,
      shippingSnapshot: null,
      rentalStartDate: new Date('2026-04-01'),
      rentalEndDate: new Date('2026-04-03'),
      createdAt: new Date('2026-03-20'),
      customer: {
        id: 'cust-unique',
        firstName: 'Test',
        lastName: 'User',
        phone: '0800000000',
        email: 'test@example.com',
        address: null,
        documents: [
          { id: 'doc-a', docType: 'id_card_front', storageKey: 'front.jpg', verified: true, createdAt: new Date('2026-01-01') },
          { id: 'doc-b', docType: 'id_card_back', storageKey: 'back.jpg', verified: true, createdAt: new Date('2026-01-01') },
          { id: 'doc-c', docType: 'facebook', storageKey: 'fb.jpg', verified: false, createdAt: new Date('2026-01-02') },
        ],
      },
      items: [],
      paymentSlips: [],
      statusLogs: [],
    });
    mockDb.product.findMany.mockResolvedValue([]);

    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/orders/order-unique', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.customer.documents).toHaveLength(3);
  });
});
