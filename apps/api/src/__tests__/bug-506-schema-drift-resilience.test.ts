/**
 * BUG-506 — Prisma schema drift resilience tests.
 *
 * Verifies that:
 *   1. GET /api/v1/admin/orders/:id returns 200 with audit_logs=[] when
 *      Prisma throws P2022 (column does not exist).
 *   2. GET /api/v1/admin/settings/audit-log returns 200 with empty data
 *      when Prisma throws P2022.
 *   3. isPrismaP2022 / isPrismaSchemaError / tagPrismaError correctly
 *      detect and tag schema-drift errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isPrismaP2022, isPrismaSchemaError, tagPrismaError } from '../lib/prisma-errors';

// ─── Mock DB ──────────────────────────────────────────────────────────

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
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      upsert: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    };
  }
  return db;
});

vi.mock('../lib/db', () => ({
  getDb: vi.fn(() => mockDb),
  resetDb: vi.fn(),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(false), hash: vi.fn() },
  compare: vi.fn().mockResolvedValue(false),
  hash: vi.fn(),
}));

import app from '../index';

const ADMIN_UUID = '00000000-0000-0000-0000-000000000099';

async function adminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'superadmin');
}

// ─── P2022 error factory ──────────────────────────────────────────────

function makeP2022Error(): Error & { code: string } {
  const err = new Error(
    'Invalid `prisma.auditLog.findMany()` invocation: The column `audit_logs.ip_address` does not exist in the current database.',
  ) as Error & { code: string };
  err.code = 'P2022';
  err.name = 'PrismaClientKnownRequestError';
  return err;
}

// ─── prisma-errors utility tests ──────────────────────────────────────

describe('BUG-506: prisma-errors helpers', () => {
  it('isPrismaP2022 detects P2022 by code', () => {
    expect(isPrismaP2022(makeP2022Error())).toBe(true);
  });

  it('isPrismaP2022 detects P2022 by message pattern', () => {
    const err = new Error('The column audit_logs.ip_address does not exist in the current database');
    expect(isPrismaP2022(err)).toBe(true);
  });

  it('isPrismaP2022 returns false for unrelated errors', () => {
    expect(isPrismaP2022(new Error('Connection refused'))).toBe(false);
    expect(isPrismaP2022(null)).toBe(false);
    expect(isPrismaP2022({ code: 'P2003' })).toBe(false);
  });

  it('isPrismaSchemaError detects P2021 (table missing)', () => {
    const err = { code: 'P2021' };
    expect(isPrismaSchemaError(err)).toBe(true);
  });

  it('tagPrismaError extracts structured tag from P2022', () => {
    const tag = tagPrismaError(makeP2022Error());
    expect(tag.tag).toBe('prisma_p2022');
    expect(tag.code).toBe('P2022');
    expect(tag.table).toBe('audit_logs');
    expect(tag.column).toBe('ip_address');
  });

  it('tagPrismaError returns prisma_unknown for non-schema errors', () => {
    const tag = tagPrismaError(new Error('Something else'));
    expect(tag.tag).toBe('prisma_unknown');
  });
});

// ─── Handler resilience tests ─────────────────────────────────────────

describe('BUG-506: GET /api/v1/admin/orders/:id — P2022 resilience', () => {
  const ORDER_ID = '00000000-0000-0000-0000-000000000001';

  beforeEach(() => {
    vi.clearAllMocks();

    // Seed a valid order for the detail endpoint
    mockDb.order.findUnique.mockResolvedValue({
      id: ORDER_ID,
      orderNumber: 'ORD-TEST-506',
      customerId: '00000000-0000-0000-0000-000000000005',
      status: 'paid_locked',
      totalAmount: 5000,
      deposit: 3000,
      deliveryFee: 100,
      discount: 0,
      creditApplied: 0,
      deliveryMethod: 'standard',
      returnMethod: null,
      messengerFeeSend: 0,
      messengerFeeReturn: 0,
      messengerDistanceKm: null,
      messengerPaymentMode: null,
      rentalStartDate: new Date('2026-05-05'),
      rentalEndDate: new Date('2026-05-07'),
      notes: '',
      createdAt: new Date(),
      updatedAt: new Date(),
      customer: {
        id: '00000000-0000-0000-0000-000000000005',
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        phone: '0812345678',
        address: { line1: '123 Test St', city: 'Bangkok', postalCode: '10110' },
        documents: [],
      },
      items: [{
        id: '00000000-0000-0000-0000-000000000010',
        productId: '00000000-0000-0000-0000-000000000020',
        productName: 'Test Dress',
        size: 'M',
        quantity: 1,
        status: 'pending',
        rentalPricePerDay: 1000,
        subtotal: 3000,
        lateFee: 0,
        damageFee: 0,
        product: {
          id: '00000000-0000-0000-0000-000000000020',
          sku: 'D001',
          name: 'Test Dress',
          category: 'dress',
          categoryRef: { slug: 'dress' },
          thumbnailUrl: null,
          images: [],
        },
      }],
      paymentSlips: [],
      statusLogs: [],
      availabilitySlots: [],
      afterSalesEvents: [],
      financeTransactions: [],
    });
  });

  it('returns 200 with audit_logs=[] when auditLog.findMany throws P2022', async () => {
    // Simulate P2022 error from Prisma
    mockDb.auditLog.findMany.mockRejectedValue(makeP2022Error());

    const token = await adminToken();
    const res = await app.request(
      `/api/v1/admin/orders/${ORDER_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { audit_logs: unknown[]; _meta?: { warning: string } } };
    expect(body.data.audit_logs).toEqual([]);
    expect(body.data).toHaveProperty('order_number', 'ORD-TEST-506');
    expect(body.data._meta).toEqual({ warning: 'audit_logs_unavailable' });
  });

  it('returns 200 with populated audit_logs when no error', async () => {
    mockDb.auditLog.findMany.mockResolvedValue([{
      id: 'log-1',
      action: 'STATUS_CHANGE',
      resource: 'order',
      details: { from: 'unpaid', to: 'paid_locked' },
      adminId: ADMIN_UUID,
      createdAt: new Date('2026-05-05T10:00:00Z'),
      admin: { name: 'Admin', email: 'admin@cutebunny.rental' },
    }]);

    const token = await adminToken();
    const res = await app.request(
      `/api/v1/admin/orders/${ORDER_ID}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { data: { audit_logs: unknown[]; _meta?: { warning: string } } };
    expect(body.data.audit_logs).toHaveLength(1);
    expect(body.data._meta).toBeUndefined();
  });
});

describe('BUG-506: GET /api/v1/admin/settings/audit-log — P2022 resilience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 with empty data when auditLog.findMany throws P2022', async () => {
    mockDb.auditLog.findMany.mockRejectedValue(makeP2022Error());
    mockDb.auditLog.count.mockRejectedValue(makeP2022Error());

    const token = await adminToken();
    const res = await app.request(
      '/api/v1/admin/settings/audit-log?per_page=10',
      { headers: { Authorization: `Bearer ${token}` } },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { data: unknown[]; meta: { total: number; _meta?: { warning: string } } };
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
    expect(body.meta._meta).toEqual({ warning: 'audit_logs_unavailable' });
  });
});
