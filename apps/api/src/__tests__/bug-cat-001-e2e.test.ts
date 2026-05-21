/**
 * BUG-CAT-001 — E2E: admin create category → public API includes it → cleanup DELETE.
 *
 * Validates the full lifecycle with mocked DB:
 *   1. POST /api/v1/admin/categories creates a new category.
 *   2. GET  /api/v1/categories returns it (visibleFrontend=true, 0 products).
 *   3. DELETE /api/v1/admin/categories/:id removes it.
 *   4. GET  /api/v1/categories no longer includes it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const TEST_CAT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee0001';

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
    $executeRaw: vi.fn().mockResolvedValue(0),
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
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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

async function superadminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken('00000000-0000-0000-0000-000000000099', 'admin@cutebunny.rental', 'superadmin');
}

const TEST_CAT_ROW = {
  id: TEST_CAT_ID,
  slug: 'test-e2e-cat',
  nameTh: 'ทดสอบ',
  nameEn: 'Test E2E Category',
  sortOrder: 999,
  visibleFrontend: true,
  visibleBackend: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('BUG-CAT-001 E2E — admin create → public read → admin delete → public gone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('full lifecycle: create → public includes → delete → public excludes', async () => {
    const token = await superadminToken();
    const jsonHeaders = (t?: string) => {
      const h: Record<string, string> = { 'Content-Type': 'application/json' };
      if (t) h['Authorization'] = `Bearer ${t}`;
      return h;
    };

    // ── Step 1: admin POST creates category ──────────────────────
    mockDb.category.findUnique.mockResolvedValueOnce(null); // slug not taken
    mockDb.category.create.mockResolvedValueOnce(TEST_CAT_ROW);

    const createRes = await app.request('/api/v1/admin/categories', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({
        slug: 'test-e2e-cat',
        name_th: 'ทดสอบ',
        name_en: 'Test E2E Category',
        sort_order: 999,
        visible_frontend: true,
        visible_backend: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.data.slug).toBe('test-e2e-cat');
    expect(created.data.visible_frontend).toBe(true);

    // ── Step 2: public GET includes the new category ─────────────
    mockDb.category.findMany.mockResolvedValueOnce([TEST_CAT_ROW]);

    const publicRes = await app.request('/api/v1/categories');
    expect(publicRes.status).toBe(200);
    const publicBody = await publicRes.json();
    expect(publicBody.data).toHaveLength(1);
    expect(publicBody.data[0].slug).toBe('test-e2e-cat');
    expect(publicBody.data[0].visible_frontend).toBe(true);

    // ── Step 3: admin DELETE removes category ────────────────────
    mockDb.category.findUnique.mockResolvedValueOnce(TEST_CAT_ROW);
    mockDb.product.count.mockResolvedValueOnce(0); // no products referencing it
    mockDb.category.delete.mockResolvedValueOnce(TEST_CAT_ROW);

    const deleteRes = await app.request(`/api/v1/admin/categories/${TEST_CAT_ID}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });
    expect(deleteRes.status).toBe(204);

    // ── Step 4: public GET no longer includes it ─────────────────
    mockDb.category.findMany.mockResolvedValueOnce([]);

    const afterDeleteRes = await app.request('/api/v1/categories');
    expect(afterDeleteRes.status).toBe(200);
    const afterBody = await afterDeleteRes.json();
    expect(afterBody.data).toHaveLength(0);
  });
});
