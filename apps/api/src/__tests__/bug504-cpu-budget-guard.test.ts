/**
 * BUG-504: CPU-budget guard — the /summary endpoint must respond quickly
 * even under sequential load thanks to the in-memory cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const models = [
    'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
    'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
    'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
    'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
    'auditLog', 'inventoryUnit', 'comboSet', 'comboSetItem', 'productStockLog',
    'financeCategory', 'systemConfig', 'notificationLog', 'category',
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
      aggregate: vi.fn().mockResolvedValue({ _sum: { amount: 0 } }),
    };
  }
  db.order.groupBy = vi.fn().mockResolvedValue([]);
  return db;
});

vi.mock('../lib/db', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(false), hash: vi.fn() },
  compare: vi.fn().mockResolvedValue(false),
  hash: vi.fn(),
}));

import app from '../index';

async function getAdminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken('00000000-0000-0000-0000-000000000099', 'admin@cutebunny.rental', 'superadmin');
}

describe('BUG-504: CPU-budget guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('100 sequential /summary requests each respond in <50ms', async () => {
    const token = await getAdminToken();
    const durations: number[] = [];

    for (let i = 0; i < 100; i++) {
      const start = performance.now();
      const res = await app.request('/api/v1/admin/dashboard/summary', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const elapsed = performance.now() - start;
      durations.push(elapsed);
      expect(res.status).toBe(200);
    }

    const maxDuration = Math.max(...durations);
    expect(maxDuration).toBeLessThan(50);
  });

  it('/summary returns combined stats, overview, and lowStock', async () => {
    const token = await getAdminToken();
    const res = await app.request('/api/v1/admin/dashboard/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveProperty('stats');
    expect(body.data).toHaveProperty('overview');
    expect(body.data).toHaveProperty('lowStock');
    expect(body.data.stats).toHaveProperty('orders_today');
    expect(body.data.overview).toHaveProperty('total_products');
  });

  it('cache serves subsequent requests without additional DB queries', async () => {
    const token = await getAdminToken();

    // First request populates the cache
    await app.request('/api/v1/admin/dashboard/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const callCountAfterFirst = mockDb.order.count.mock.calls.length;

    // Second request should come from cache — no new DB calls
    const res = await app.request('/api/v1/admin/dashboard/summary', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect(mockDb.order.count.mock.calls.length).toBe(callCountAfterFirst);
  });
});
