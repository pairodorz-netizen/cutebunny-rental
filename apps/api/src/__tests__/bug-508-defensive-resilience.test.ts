/**
 * BUG-508 — Defensive resilience tests.
 *
 * Verifies:
 *   1. Global app.onError returns 500 + JSON when unhandled error thrown.
 *   2. safeAuditLogCreate swallows P2022 errors and logs structured alert.
 *   3. safeAuditLogQuery returns degraded result on P2022.
 *   4. Product creation succeeds despite auditLog.create failing.
 *   5. Schema drift detector emits alert on ip_address errors.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
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
import { safeAuditLogCreate, safeAuditLogQuery } from '../lib/safe-audit-log';

const ADMIN_UUID = '00000000-0000-0000-0000-000000000099';

async function adminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'superadmin');
}

// ─── Error factories ──────────────────────────────────────────────────

function makeP2022Error(column = 'ip_address'): Error & { code: string } {
  const err = new Error(
    `Invalid \`prisma.auditLog.create()\` invocation: The column \`audit_logs.${column}\` does not exist in the current database.`,
  ) as Error & { code: string };
  err.code = 'P2022';
  err.name = 'PrismaClientKnownRequestError';
  return err;
}

function makeGenericError(): Error {
  return new Error('Connection pool exhausted');
}

// ─── Global error handler tests ───────────────────────────────────────

describe('BUG-508: Global app.onError handler', () => {
  it('returns 500 JSON with error envelope when unhandled error occurs', async () => {
    // Force a throw in a real route by making product.findMany throw
    mockDb.product.findMany.mockRejectedValueOnce(new Error('Unexpected DB crash'));

    const token = await adminToken();
    const res = await app.request('/api/v1/admin/products', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    // Should return 500 with JSON, not crash worker
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('internal_error');
  });

  it('returns JSON content-type on error', async () => {
    mockDb.product.findMany.mockRejectedValueOnce(new Error('DB down'));

    const token = await adminToken();
    const res = await app.request('/api/v1/admin/products', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

// ─── safeAuditLogCreate tests ─────────────────────────────────────────

describe('BUG-508: safeAuditLogCreate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls auditLog.create on success path', async () => {
    mockDb.auditLog.create.mockResolvedValueOnce({ id: 'audit-1' });

    await safeAuditLogCreate(mockDb as ReturnType<typeof import('../lib/db').getDb>, {
      adminId: ADMIN_UUID,
      action: 'CREATE',
      resource: 'product',
      resourceId: 'test-id',
    });

    expect(mockDb.auditLog.create).toHaveBeenCalledOnce();
  });

  it('swallows P2022 error without re-throwing', async () => {
    mockDb.auditLog.create.mockRejectedValueOnce(makeP2022Error());
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      safeAuditLogCreate(mockDb as ReturnType<typeof import('../lib/db').getDb>, {
        adminId: ADMIN_UUID,
        action: 'CREATE',
        resource: 'product',
        resourceId: 'test-id',
      }),
    ).resolves.toBeUndefined();

    consoleSpy.mockRestore();
  });

  it('logs audit_logs_unavailable on P2022 error', async () => {
    mockDb.auditLog.create.mockRejectedValueOnce(makeP2022Error());
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await safeAuditLogCreate(mockDb as ReturnType<typeof import('../lib/db').getDb>, {
      adminId: ADMIN_UUID,
      action: 'CREATE',
      resource: 'product',
      resourceId: 'test-id',
    });

    const logCalls = consoleSpy.mock.calls.map(c => c[0]);
    const unavailableLog = logCalls.find(l => typeof l === 'string' && l.includes('audit_logs_unavailable'));
    expect(unavailableLog).toBeDefined();

    consoleSpy.mockRestore();
  });

  it('emits schema_drift_detected on ip_address column error', async () => {
    mockDb.auditLog.create.mockRejectedValueOnce(makeP2022Error('ip_address'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await safeAuditLogCreate(mockDb as ReturnType<typeof import('../lib/db').getDb>, {
      adminId: ADMIN_UUID,
      action: 'CREATE',
      resource: 'product',
      resourceId: 'test-id',
    });

    const logCalls = consoleSpy.mock.calls.map(c => c[0]);
    const driftLog = logCalls.find(l => typeof l === 'string' && l.includes('schema_drift_detected'));
    expect(driftLog).toBeDefined();

    consoleSpy.mockRestore();
  });

  it('swallows non-schema errors gracefully', async () => {
    mockDb.auditLog.create.mockRejectedValueOnce(makeGenericError());
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      safeAuditLogCreate(mockDb as ReturnType<typeof import('../lib/db').getDb>, {
        adminId: ADMIN_UUID,
        action: 'CREATE',
        resource: 'product',
        resourceId: 'test-id',
      }),
    ).resolves.toBeUndefined();

    const logCalls = consoleSpy.mock.calls.map(c => c[0]);
    const failLog = logCalls.find(l => typeof l === 'string' && l.includes('audit_log_write_failed'));
    expect(failLog).toBeDefined();

    consoleSpy.mockRestore();
  });
});

// ─── safeAuditLogQuery tests ──────────────────────────────────────────

describe('BUG-508: safeAuditLogQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns data + degraded=false on success', async () => {
    const mockRows = [{ id: '1', action: 'CREATE' }];
    mockDb.auditLog.findMany.mockResolvedValueOnce(mockRows);

    const result = await safeAuditLogQuery(
      mockDb as ReturnType<typeof import('../lib/db').getDb>,
      { where: { orderId: 'test' } },
    );

    expect(result.data).toEqual(mockRows);
    expect(result.degraded).toBe(false);
  });

  it('returns empty array + degraded=true on P2022', async () => {
    mockDb.auditLog.findMany.mockRejectedValueOnce(makeP2022Error());
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await safeAuditLogQuery(
      mockDb as ReturnType<typeof import('../lib/db').getDb>,
      { where: { orderId: 'test' } },
    );

    expect(result.data).toEqual([]);
    expect(result.degraded).toBe(true);

    consoleSpy.mockRestore();
  });

  it('logs audit_logs_unavailable on P2022 query failure', async () => {
    mockDb.auditLog.findMany.mockRejectedValueOnce(makeP2022Error());
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await safeAuditLogQuery(
      mockDb as ReturnType<typeof import('../lib/db').getDb>,
      { where: { orderId: 'test' } },
    );

    const logCalls = consoleSpy.mock.calls.map(c => c[0]);
    const unavailableLog = logCalls.find(l => typeof l === 'string' && l.includes('audit_logs_unavailable'));
    expect(unavailableLog).toBeDefined();

    consoleSpy.mockRestore();
  });
});

// ─── Product creation with audit log failure ──────────────────────────

describe('BUG-508: Product creation with failed audit log', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Set up category mock for product creation
    mockDb.category.findFirst.mockResolvedValue({
      id: 'cat-1',
      slug: 'dress',
      nameTh: 'ชุดเดรส',
      nameEn: 'Dress',
      sortOrder: 1,
      visibleFrontend: true,
      visibleBackend: true,
    });
    mockDb.category.findUnique.mockResolvedValue({
      id: 'cat-1',
      slug: 'dress',
      nameTh: 'ชุดเดรส',
      nameEn: 'Dress',
    });

    // Product create success
    mockDb.product.create.mockResolvedValue({
      id: 'prod-1',
      sku: 'TEST-001',
      name: 'Test Product',
      categoryId: 'cat-1',
      rentalPrice1Day: 500,
      rentalPrice3Day: 1200,
      rentalPrice5Day: 1800,
      variableCost: 100,
      costPrice: 2000,
      thumbnailUrl: null,
      description: 'A test product',
      color: 'red',
      size: 'M',
      available: true,
      stockOnHand: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    });

    // Audit log FAILS with P2022
    mockDb.auditLog.create.mockRejectedValue(makeP2022Error());
  });

  it('product creation succeeds despite audit log P2022 failure', async () => {
    const token = await adminToken();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await app.request('/api/v1/admin/products', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sku: 'TEST-001',
        name: 'Test Product',
        category: 'dress',
        size: ['M'],
        color: ['red'],
        rental_price_1day: 500,
        rental_price_3day: 1200,
        rental_price_5day: 1800,
        variable_cost: 100,
        cost_price: 2000,
      }),
    });

    // Should return 201 (product created), not 500
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.sku).toBe('TEST-001');

    consoleSpy.mockRestore();
  });

  it('logs audit_logs_unavailable when product creation audit fails', async () => {
    const token = await adminToken();
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await app.request('/api/v1/admin/products', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sku: 'TEST-002',
        name: 'Test Product 2',
        category: 'dress',
        size: ['M'],
        color: ['red'],
        rental_price_1day: 500,
        rental_price_3day: 1200,
        rental_price_5day: 1800,
        variable_cost: 100,
        cost_price: 2000,
      }),
    });

    const logCalls = consoleSpy.mock.calls.map(c => c[0]);
    const unavailableLog = logCalls.find(l => typeof l === 'string' && l.includes('audit_logs_unavailable'));
    expect(unavailableLog).toBeDefined();

    consoleSpy.mockRestore();
  });
});
