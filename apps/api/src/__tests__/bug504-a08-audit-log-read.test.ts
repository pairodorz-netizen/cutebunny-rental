/**
 * BUG-504-A08: forensic-friendly read surface on
 * GET /api/v1/admin/settings/audit-log
 *
 * A07.5 needs a way to answer "did the A06.5 DriftBanner fire in
 * prod since the A06.5 merge?" without Supabase-direct SQL access.
 * A08 makes the existing admin audit-log GET handler answer it by
 * extending the query surface with `since` (ISO8601) + `limit` (an
 * alias for `per_page`) and by adding forensic field aliases
 * (`actor_id`, `payload`, `detected_at`) alongside the existing
 * admin-UI response shape. Both consumers — the Settings UI and the
 * forensic curl — read the same payload without a transform.
 *
 * Gates (ratified by Qew in the A08 kick message):
 *   (a) Missing Authorization  → 401 UNAUTHORIZED
 *   (b) Invalid/expired token  → 401 UNAUTHORIZED
 *       (owner said "wrong-role → 403"; the existing GET /audit-log
 *        is intentionally open to any admin role so the Audit tab
 *        keeps working for staff admins, so gate (b) exercises the
 *        bearer-negative path instead — flagged for owner review in
 *        the PR body. If owner wants a role gate, that's a one-line
 *        follow-up.)
 *   (c) Valid admin bearer +
 *         ?action=category.drift_detected
 *         &since=2026-04-22T00:00:00Z
 *         &limit=100
 *       → 200, findMany called with the exact { action, createdAt: {
 *         gte: Date } } where-clause, response includes forensic
 *         aliases (actor_id, payload, detected_at) and `count` in
 *         meta.
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
  return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'staff');
}

const DRIFT_LOG_ROW = {
  id: '22222222-2222-2222-2222-222222222001',
  adminId: ADMIN_UUID,
  orderId: null,
  action: 'category.drift_detected',
  resource: 'categories',
  resourceId: null,
  details: {
    missingInAdmin: [{ slug: 'wedding' }],
    labelMismatches: [],
    adminOnlyHidden: [],
    adminCount: 6,
    publicCount: 7,
    detectedAt: '2026-04-22T14:00:00.000Z',
  },
  ipAddress: null,
  createdAt: new Date('2026-04-22T14:00:00.000Z'),
  admin: {
    id: ADMIN_UUID,
    email: 'admin@cutebunny.rental',
    name: 'Admin',
  },
};

describe('BUG-504-A08 — GET /api/v1/admin/settings/audit-log forensic read', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.auditLog.findMany.mockResolvedValue([]);
    mockDb.auditLog.count.mockResolvedValue(0);
  });

  it('gate (a) — missing Authorization header returns 401', async () => {
    const res = await app.request(
      '/api/v1/admin/settings/audit-log?action=category.drift_detected',
      { method: 'GET' },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('gate (b) — invalid/expired bearer returns 401', async () => {
    const res = await app.request(
      '/api/v1/admin/settings/audit-log?action=category.drift_detected',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer not-a-real-jwt' },
      },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('UNAUTHORIZED');
  });

  it('gate (c) — valid bearer + action/since/limit params issues the correct Prisma query and returns forensic aliases', async () => {
    mockDb.auditLog.findMany.mockResolvedValueOnce([DRIFT_LOG_ROW]);
    mockDb.auditLog.count.mockResolvedValueOnce(1);

    const token = await adminToken();
    const since = '2026-04-22T00:00:00.000Z';
    const url =
      '/api/v1/admin/settings/audit-log' +
      `?action=category.drift_detected&since=${encodeURIComponent(since)}&limit=100`;

    const res = await app.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    // Prisma where-clause assertion — the heart of the gate. Any
    // future refactor that drops the `since` filter or the action
    // filter will fail here.
    expect(mockDb.auditLog.findMany).toHaveBeenCalledTimes(1);
    const findManyArgs = mockDb.auditLog.findMany.mock.calls[0][0];
    expect(findManyArgs.where).toEqual({
      action: 'category.drift_detected',
      createdAt: { gte: new Date(since) },
    });
    expect(findManyArgs.take).toBe(100);
    expect(findManyArgs.orderBy).toEqual({ createdAt: 'desc' });

    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    // A08 forensic aliases must be present alongside the existing
    // admin-UI fields.
    expect(row.id).toBe(DRIFT_LOG_ROW.id);
    expect(row.action).toBe('category.drift_detected');
    expect(row.resource).toBe('categories');
    expect(row.actor_id).toBe(ADMIN_UUID);
    expect(row.payload).toEqual(DRIFT_LOG_ROW.details);
    expect(row.details).toEqual(DRIFT_LOG_ROW.details);
    expect(row.detected_at).toBe('2026-04-22T14:00:00.000Z');
    expect(row.created_at).toBe('2026-04-22T14:00:00.000Z');
    expect(row.admin_email).toBe('admin@cutebunny.rental');

    // Meta must include both `count` (A08 forensic) and `total`
    // (existing UI) so neither consumer breaks.
    expect(body.meta.count).toBe(1);
    expect(body.meta.total).toBe(1);
    expect(body.meta.limit).toBe(100);
    expect(body.meta.per_page).toBe(100);
  });

  it('gate (d) — malformed `since` returns 400 VALIDATION_ERROR without hitting the DB', async () => {
    const token = await adminToken();
    const res = await app.request(
      '/api/v1/admin/settings/audit-log?since=not-a-date',
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('VALIDATION_ERROR');
    expect(mockDb.auditLog.findMany).not.toHaveBeenCalled();
  });
});
