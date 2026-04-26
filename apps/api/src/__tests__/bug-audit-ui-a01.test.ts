/**
 * BUG-AUDIT-UI-A01 — Audit Log UI for shop owner (Issue #34).
 *
 * The existing `GET /api/v1/admin/settings/audit-log` (BUG-504-A08)
 * exposed a forensic-friendly read surface but lacked the spec'd
 * filters required by the new Settings → Audit Log tab:
 *   • `from` / `to`        — inclusive ISO 8601 date range
 *   • `section`            — multi-value filter on the SystemConfig
 *                            group resolved from `details.key`
 *                            (e.g. `finance`, `calendar`, `shipping`,
 *                            `customer_ux`)
 *   • `actor`              — multi-value filter on `adminId`
 *   • `q`                  — case-insensitive substring on
 *                            `details.key`
 *   • `pageSize`           — alias for `per_page` / `limit`
 *
 * Auth tighten (1-line side-benefit, ratified in the BUG-AUDIT-UI-A01
 * approval message): the GET endpoint moves from any-authenticated-
 * staff to superadmin-only via `requireRole('superadmin')` on the
 * route handler. This closes the gap noted in BUG-504-A08 gate (b).
 * The POST handler keeps its current "any admin" gating since A06.5's
 * client-side drift-banner fires from non-superadmin sessions.
 *
 * Each row in the response gains:
 *   • `key`                — `details.key`, or null
 *   • `section`            — group resolved via `resolveGroup(key)`,
 *                            or null
 *   • `old_value` / `new_value` — pulled from `details.old_value` /
 *                            `details.new_value`, defensively
 *                            truncated to ≤500 chars each
 *
 * Default 7-day window: when neither `from`/`to` nor `since` is
 * supplied, `from = now - 7d` is enforced server-side. Explicit
 * `from`/`to`/`since` always win.
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
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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
import { resolveGroup, FIXED_ALLOWED_KEYS } from '../routes/admin/settings';

const SUPERADMIN_UUID = '00000000-0000-0000-0000-000000000001';
const STAFF_UUID = '00000000-0000-0000-0000-000000000002';
const OTHER_ADMIN_UUID = '00000000-0000-0000-0000-000000000003';

async function superadminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(SUPERADMIN_UUID, 'super@cutebunny.rental', 'superadmin');
}

async function staffToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(STAFF_UUID, 'staff@cutebunny.rental', 'staff');
}

function buildRow(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    adminId: SUPERADMIN_UUID,
    orderId: null,
    action: 'UPDATE',
    resource: 'system_config',
    resourceId: 'cfg-1',
    details: {
      key: 'late_return_fee',
      old_value: '50',
      new_value: '75',
    },
    ipAddress: null,
    createdAt: new Date('2026-04-25T10:00:00.000Z'),
    admin: {
      id: SUPERADMIN_UUID,
      email: 'super@cutebunny.rental',
      name: 'Super Admin',
    },
    ...overrides,
  };
}

describe('BUG-AUDIT-UI-A01 — Audit Log UI filter expansion + auth tighten', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.auditLog.findMany.mockResolvedValue([]);
    mockDb.auditLog.count.mockResolvedValue(0);
  });

  // ── Gate 1 — section filter happy path ────────────────────────────────
  it('gate 1: ?section=finance narrows by SystemConfig group resolved from details.key', async () => {
    const token = await superadminToken();
    mockDb.auditLog.findMany.mockResolvedValueOnce([buildRow()]);
    mockDb.auditLog.count.mockResolvedValueOnce(1);

    const res = await app.request(
      '/api/v1/admin/settings/audit-log?section=finance&resource=system_config',
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);
    expect(mockDb.auditLog.findMany).toHaveBeenCalledTimes(1);

    const findManyArgs = mockDb.auditLog.findMany.mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    // Server must translate `section=finance` to a Prisma JSON-path
    // filter that matches every key in FIXED_ALLOWED_KEYS whose group
    // is `finance`. We assert the AND-clause carries an OR-list of
    // those keys so the SQL can hit a btree index on details->>'key'
    // if one is added later.
    const financeKeys = Object.entries(FIXED_ALLOWED_KEYS)
      .filter(([, v]) => v.group === 'finance')
      .map(([k]) => k);
    expect(financeKeys).toContain('late_return_fee');

    const hasSectionClause = JSON.stringify(findManyArgs.where).includes(
      'late_return_fee',
    );
    expect(hasSectionClause).toBe(true);
    expect((findManyArgs.where as { resource?: string }).resource).toBe(
      'system_config',
    );
  });

  // ── Gate 2 — actor filter happy path ──────────────────────────────────
  it('gate 2: ?actor=<id> filters by exact adminId match', async () => {
    const token = await superadminToken();
    mockDb.auditLog.findMany.mockResolvedValueOnce([
      buildRow({ adminId: OTHER_ADMIN_UUID }),
    ]);
    mockDb.auditLog.count.mockResolvedValueOnce(1);

    const res = await app.request(
      `/api/v1/admin/settings/audit-log?actor=${OTHER_ADMIN_UUID}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);

    const findManyArgs = mockDb.auditLog.findMany.mock.calls[0][0] as {
      where: { adminId?: unknown };
    };
    expect(findManyArgs.where.adminId).toEqual(OTHER_ADMIN_UUID);
  });

  // ── Gate 3 — date-range boundary ──────────────────────────────────────
  it('gate 3: ?from=<ISO>&to=<ISO> applies inclusive gte/lte on createdAt', async () => {
    const token = await superadminToken();
    const from = '2026-04-20T00:00:00.000Z';
    const to = '2026-04-26T23:59:59.999Z';
    mockDb.auditLog.findMany.mockResolvedValueOnce([buildRow()]);
    mockDb.auditLog.count.mockResolvedValueOnce(1);

    await app.request(
      `/api/v1/admin/settings/audit-log?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    );

    const findManyArgs = mockDb.auditLog.findMany.mock.calls[0][0] as {
      where: { createdAt?: { gte?: Date; lte?: Date } };
    };
    expect(findManyArgs.where.createdAt?.gte).toEqual(new Date(from));
    expect(findManyArgs.where.createdAt?.lte).toEqual(new Date(to));
  });

  // ── Gate 4 — pagination ───────────────────────────────────────────────
  it('gate 4: ?page=2&pageSize=50 issues skip=50 take=50 and reports meta', async () => {
    const token = await superadminToken();
    mockDb.auditLog.findMany.mockResolvedValueOnce([buildRow()]);
    mockDb.auditLog.count.mockResolvedValueOnce(120);

    const res = await app.request(
      '/api/v1/admin/settings/audit-log?page=2&pageSize=50',
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(200);

    const findManyArgs = mockDb.auditLog.findMany.mock.calls[0][0] as {
      skip: number;
      take: number;
      orderBy: unknown;
    };
    expect(findManyArgs.skip).toBe(50);
    expect(findManyArgs.take).toBe(50);
    expect(findManyArgs.orderBy).toEqual({ createdAt: 'desc' });

    const body = (await res.json()) as { meta: Record<string, unknown> };
    expect(body.meta.page).toBe(2);
    expect(body.meta.per_page).toBe(50);
    expect(body.meta.pageSize).toBe(50);
    expect(body.meta.total).toBe(120);
    expect(body.meta.total_pages).toBe(3);
  });

  // ── Gate 5 — staff → 403 (auth-tighten regression pin) ───────────────
  it('gate 5: non-superadmin token receives 403 FORBIDDEN', async () => {
    const token = await staffToken();
    const res = await app.request(
      '/api/v1/admin/settings/audit-log',
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('FORBIDDEN');
    expect(mockDb.auditLog.findMany).not.toHaveBeenCalled();
  });

  // ── Gate 6 — response shape includes key / section / old_value / new_value ─
  it('gate 6: each row carries key, section, old_value, new_value alongside the existing UI/forensic shape', async () => {
    const token = await superadminToken();
    mockDb.auditLog.findMany.mockResolvedValueOnce([buildRow()]);
    mockDb.auditLog.count.mockResolvedValueOnce(1);

    const res = await app.request(
      '/api/v1/admin/settings/audit-log',
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    );
    const body = (await res.json()) as {
      data: Array<Record<string, unknown>>;
    };
    expect(body.data).toHaveLength(1);
    const row = body.data[0];
    expect(row.key).toBe('late_return_fee');
    expect(row.section).toBe('finance');
    expect(row.old_value).toBe('50');
    expect(row.new_value).toBe('75');
    // BUG-504-A08 forensic + admin-UI fields must coexist.
    expect(row.action).toBe('UPDATE');
    expect(row.admin_email).toBe('super@cutebunny.rental');
    expect(row.actor_id).toBe(SUPERADMIN_UUID);
  });

  // ── Gate 7 — resolveGroup unit gate ──────────────────────────────────
  it('gate 7: resolveGroup correctly maps allow-listed keys to their groups', () => {
    expect(resolveGroup('late_return_fee')).toBe('finance');
    expect(resolveGroup('shipping_duration_days')).toBe('calendar');
    expect(resolveGroup('shipping_days_NORTH')).toBe('shipping');
    expect(resolveGroup('shipping_fee_enabled')).toBe('shipping');
    expect(resolveGroup('min_rental_days')).toBe('customer_ux');
    expect(resolveGroup('unknown_key')).toBeNull();
    expect(resolveGroup(null)).toBeNull();
    expect(resolveGroup(undefined)).toBeNull();
  });

  // ── Gate 8 — default last-7d window when no from/to/since supplied ───
  it('gate 8: omitting from/to/since enforces a default 7-day window', async () => {
    const token = await superadminToken();
    mockDb.auditLog.findMany.mockResolvedValueOnce([]);
    mockDb.auditLog.count.mockResolvedValueOnce(0);

    const before = Date.now();
    await app.request(
      '/api/v1/admin/settings/audit-log',
      { method: 'GET', headers: { Authorization: `Bearer ${token}` } },
    );
    const after = Date.now();

    const findManyArgs = mockDb.auditLog.findMany.mock.calls[0][0] as {
      where: { createdAt?: { gte?: Date } };
    };
    const gte = findManyArgs.where.createdAt?.gte;
    expect(gte).toBeInstanceOf(Date);
    // Window must be within ±2s of (now - 7d).
    const expectedMin = before - 7 * 24 * 60 * 60 * 1000 - 2000;
    const expectedMax = after - 7 * 24 * 60 * 60 * 1000 + 2000;
    expect(gte!.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(gte!.getTime()).toBeLessThanOrEqual(expectedMax);
  });
});
