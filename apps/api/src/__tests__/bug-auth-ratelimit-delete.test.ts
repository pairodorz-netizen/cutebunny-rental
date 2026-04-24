/**
 * BUG-AUTH operator escape hatch — DELETE /api/v1/admin/auth/rate-limit/:ip
 *
 * Gates:
 *   • 401 without JWT
 *   • 403 for staff role (superadmin-only)
 *   • 400 if :ip is empty (covered via route 404 since ":ip" must match)
 *   • 200 + clears the KV entry (backend=kv)
 *   • 200 + clears the in-memory entry when no KV is bound (backend=memory)
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
const TARGET_IP = '203.0.113.77';

interface KvEntry {
  value: string;
  expiresAt: number | null;
}
interface FakeKV {
  get: (key: string) => Promise<string | null>;
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<void>;
  delete: (key: string) => Promise<void>;
  __dump: () => Record<string, KvEntry>;
}
function createFakeKV(): FakeKV {
  const store = new Map<string, KvEntry>();
  return {
    async get(key) {
      return store.get(key)?.value ?? null;
    },
    async put(key, value, options) {
      const expiresAt =
        options?.expirationTtl !== undefined
          ? Date.now() + options.expirationTtl * 1000
          : null;
      store.set(key, { value, expiresAt });
    },
    async delete(key) {
      store.delete(key);
    },
    __dump() {
      return Object.fromEntries(store);
    },
  };
}

async function superadminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'superadmin');
}
async function staffToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'staff@cutebunny.rental', 'staff');
}

function del(ip: string, token?: string, env?: object) {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return app.request(
    `/api/v1/admin/auth/rate-limit/${ip}`,
    { method: 'DELETE', headers },
    env,
  );
}

describe('BUG-AUTH — DELETE /api/v1/admin/auth/rate-limit/:ip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401 without Authorization header', async () => {
    const res = await del(TARGET_IP);
    expect(res.status).toBe(401);
  });

  it('403 for staff role (superadmin-only)', async () => {
    const res = await del(TARGET_IP, await staffToken());
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('FORBIDDEN');
  });

  it('200 + clears the KV entry when RATE_LIMIT_KV is bound', async () => {
    const kv = createFakeKV();
    // Seed a fake counter for this IP on the login path.
    await kv.put(
      `rl:${TARGET_IP}:/api/v1/admin/auth/login`,
      JSON.stringify({ count: 6, resetAt: Date.now() + 900_000 }),
      { expirationTtl: 900 },
    );
    expect(Object.keys(kv.__dump()).length).toBe(1);

    const res = await del(TARGET_IP, await superadminToken(), {
      RATE_LIMIT_KV: kv,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { cleared: boolean; ip: string; path: string; backend: string };
    };
    expect(body.data).toEqual({
      cleared: true,
      ip: TARGET_IP,
      path: '/api/v1/admin/auth/login',
      backend: 'kv',
    });
    expect(Object.keys(kv.__dump()).length).toBe(0);
  });

  it('200 + reports memory backend when no KV is bound', async () => {
    const res = await del(TARGET_IP, await superadminToken());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { cleared: boolean; backend: string };
    };
    expect(body.data.cleared).toBe(true);
    expect(body.data.backend).toBe('memory');
  });
});
