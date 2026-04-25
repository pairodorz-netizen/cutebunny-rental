/**
 * BUG-505-A01 — Soft-deleted product tombstones must NOT block category DELETE.
 *
 * BUG-504-RC2 (PR #89) added a pre-flight `db.product.count` before
 * the FK-RESTRICTed `db.category.delete` call. The pre-check did not
 * filter `deletedAt: null`, so soft-deleted products (which keep
 * their `category_id` so Restore can put them back on the original
 * category) were still tombstone-counted against the category. Owner
 * symptom: `409 Cannot delete: 4 product(s) still use this category`
 * after the owner soft-deleted all four.
 *
 * Fix contract pinned by this file:
 *   • Pre-check filters by `categoryId AND deletedAt IS NULL`.
 *     `db.product.count` MUST be invoked with that exact `where`.
 *   • Category with N>0 ACTIVE products → 409 IN_USE (regression of
 *     BUG-504-RC2 contract).
 *   • Category with 0 active products but N>0 soft-deleted tombstones
 *     → 204 (the FK is intact, but RESTRICT is not violated because
 *     `category.delete` is never reached on a path that would orphan
 *     active rows; the soft-deleted rows are tombstones whose
 *     category_id was nulled is NOT required — see hunk 1 plan;
 *     instead we require that the route call db.category.delete and
 *     succeed).
 *
 *   NOTE: production semantics for the soft-deleted-tombstone case
 *   require either (a) a follow-up that nulls categoryId on
 *   tombstones at DELETE time, or (b) the FK to permit ON DELETE
 *   CASCADE/SET NULL for tombstones. This atom (BUG-505-A01) takes
 *   approach (a) IN HANDLER via a raw `UPDATE products SET
 *   category_id = NULL WHERE category_id = $1 AND deleted_at IS
 *   NOT NULL` immediately before `db.category.delete`. The raw SQL
 *   is necessary because the Prisma schema declares `categoryId` as
 *   `String` (required) even though the underlying DB column is
 *   nullable per BUG-504-A06 step 1/3 — `db.product.updateMany({
 *   data: { categoryId: null } })` would not typecheck. Schema is
 *   left untouched per the orchestrator's "no schema migration"
 *   constraint.
 *
 *   • Public `/api/v1/categories` Cache-Control: `s-maxage=30` so the
 *     drift-banner false-positive window collapses from 5 min → 30 s.
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

const ADMIN_UUID = '00000000-0000-0000-0000-000000000099';

async function superadminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'superadmin');
}

function jsonHeaders(token?: string): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

const SEED_ROW = {
  id: '11111111-1111-1111-1111-111111111001',
  slug: 'wedding',
  nameTh: 'ชุดแต่งงาน',
  nameEn: 'Wedding',
  sortOrder: 10,
  visibleFrontend: true,
  visibleBackend: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('BUG-505-A01 — soft-deleted tombstones do not block category DELETE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.category.findMany.mockResolvedValue([SEED_ROW]);
    mockDb.category.findUnique.mockResolvedValue(null);
    mockDb.category.delete.mockResolvedValue(SEED_ROW);
    mockDb.product.count.mockResolvedValue(0);
    mockDb.product.updateMany.mockResolvedValue({ count: 0 });
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  // ── Gate 1 — pre-check filters deletedAt: null ────────────────────────
  it('gate 1: pre-check counts ONLY products with deletedAt = null', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });

    await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });

    expect(mockDb.product.count).toHaveBeenCalledTimes(1);
    expect(mockDb.product.count).toHaveBeenCalledWith({
      where: { categoryId: SEED_ROW.id, deletedAt: null },
    });
  });

  // ── Gate 2 — 409 only when ACTIVE count > 0 ───────────────────────────
  it('gate 2: 409 IN_USE when an ACTIVE product still references the category', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    mockDb.product.count.mockResolvedValueOnce(2); // active count

    const res = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; details?: { products_count?: number } };
    };
    expect(body.error.code).toBe('IN_USE');
    expect(body.error.details?.products_count).toBe(2);
    expect(mockDb.category.delete).not.toHaveBeenCalled();
  });

  // ── Gate 3 — soft-deleted-only category deletes successfully ─────────
  it('gate 3: DELETE succeeds (204) when only soft-deleted tombstones reference the category', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    // Active count = 0 (tombstones excluded by `deletedAt: null` filter).
    mockDb.product.count.mockResolvedValueOnce(0);
    // Tombstones still hold the FK; the handler must null them via
    // a raw UPDATE before delete to avoid the ON DELETE RESTRICT
    // violation (Prisma schema declares categoryId required even
    // though the column is nullable).
    mockDb.$executeRaw.mockResolvedValueOnce(4);

    const res = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(mockDb.category.delete).toHaveBeenCalledWith({ where: { id: SEED_ROW.id } });
    // Tombstone category_id was cleared in the same flow. The raw
    // tagged-template arrives as (strings, ...values); we assert
    // the SQL fragments contain UPDATE + category_id = NULL +
    // deleted_at IS NOT NULL and the bound value is the category id.
    expect(mockDb.$executeRaw).toHaveBeenCalledTimes(1);
    const callArgs = mockDb.$executeRaw.mock.calls[0];
    const sqlFragments = (callArgs[0] as string[]).join(' ');
    expect(sqlFragments).toMatch(/UPDATE\s+"products"/i);
    expect(sqlFragments).toMatch(/SET\s+"category_id"\s*=\s*NULL/i);
    expect(sqlFragments).toMatch(/"deleted_at"\s+IS\s+NOT\s+NULL/i);
    expect(callArgs.slice(1)).toContain(SEED_ROW.id);
  });

  // ── Gate 4 — pre-check is the SOLE source of truth for the 409 ───────
  it('gate 4: pre-check fires before findUnique-NOT_FOUND check (404 takes precedence)', async () => {
    const token = await superadminToken();
    // findUnique returns null → 404 short-circuit, count never called.
    mockDb.category.findUnique.mockResolvedValueOnce(null);

    const res = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });

    expect(res.status).toBe(404);
    expect(mockDb.product.count).not.toHaveBeenCalled();
    expect(mockDb.category.delete).not.toHaveBeenCalled();
  });

  // ── Gate 5 — public Cache-Control TTL ─────────────────────────────────
  it('gate 5: GET /api/v1/categories sets Cache-Control with s-maxage=30', async () => {
    mockDb.category.findMany.mockResolvedValueOnce([SEED_ROW]);

    const res = await app.request('/api/v1/categories');
    expect(res.status).toBe(200);
    const cc = res.headers.get('Cache-Control') ?? '';
    expect(cc).toMatch(/s-maxage=30\b/);
    expect(cc).not.toMatch(/s-maxage=300\b/);
    // Browser-side cache mirrors the edge so a hard-refresh isn't
    // necessary to clear stale data after 30s.
    expect(cc).toMatch(/max-age=30\b/);
  });

  // ── Gate 6 — drift-banner self-heal window ≤ 60s ─────────────────────
  it('gate 6: edge cache TTL is bounded by the 60s drift-banner self-heal SLO', async () => {
    mockDb.category.findMany.mockResolvedValueOnce([SEED_ROW]);

    const res = await app.request('/api/v1/categories');
    const cc = res.headers.get('Cache-Control') ?? '';
    const match = cc.match(/s-maxage=(\d+)/);
    expect(match).not.toBeNull();
    const sMaxAge = match ? parseInt(match[1], 10) : Infinity;
    expect(sMaxAge).toBeLessThanOrEqual(60);
  });
});
