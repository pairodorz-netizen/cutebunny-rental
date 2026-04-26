/**
 * BUG-505-A01 / BUG-504-A08-commit2 — pre-check + Cache-Control gates.
 *
 * History:
 *   • BUG-504-RC2 (PR #89) added a pre-flight `db.product.count`
 *     before the FK-RESTRICTed `db.category.delete` call.
 *   • BUG-505-A01 (PR #90) narrowed the count to `deletedAt: null`
 *     so soft-deleted tombstones (which keep their `category_id`
 *     for Restore) would not block a category that had no ACTIVE
 *     products. A `$executeRaw UPDATE products SET category_id =
 *     NULL WHERE category_id = $1 AND deleted_at IS NOT NULL` was
 *     supposed to clear the tombstone FK before `category.delete`.
 *   • BUG-504-A08-commit2 (this update): production evidence
 *     2026-04-26 (owner-run SQL, Cloudflare ray 9f250bf8fe01e395)
 *     showed 4 tombstones retained `category_id` across multiple
 *     DELETE attempts — the `$executeRaw` UPDATE never effectively
 *     reached storage. A08-commit2 widens the pre-check to count
 *     ALL products (active + tombstones), so any non-zero count
 *     triggers 409 IN_USE before `category.delete` is reached. This
 *     regresses BUG-505-A01's user-facing goal until A06 commit 3
 *     FINAL drops the dual-write surface and the FK column.
 *
 * Fix contract pinned by this file (A08-commit2):
 *   • Pre-check filters by `categoryId` only (NO `deletedAt` filter).
 *     `db.product.count` MUST be invoked with `{ where: { categoryId } }`.
 *   • Category with N>0 ACTIVE products → 409 IN_USE.
 *   • Category with N>0 soft-deleted-only tombstones → 409 IN_USE
 *     (regression of BUG-505-A01 — see gate 3 inversion below).
 *   • A08-commit1 (PR #97) layer-2 P2003 catch remains as
 *     defense-in-depth for any P2003 that still reaches storage.
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

  // ── Gate 1 — pre-check counts ALL products (A08-commit2) ─────────────
  it('gate 1: pre-check counts ALL products (no deletedAt filter)', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });

    await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });

    expect(mockDb.product.count).toHaveBeenCalledTimes(1);
    // A08-commit2: widened to active + tombstones. The previous
    // BUG-505-A01 contract (`deletedAt: null`) is regressed until
    // A06 commit 3 FINAL drops the FK column.
    expect(mockDb.product.count).toHaveBeenCalledWith({
      where: { categoryId: SEED_ROW.id },
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

  // ── Gate 3 — soft-deleted tombstones now BLOCK delete (A08-commit2) ──
  // INVERTED from the BUG-505-A01 contract. Production evidence
  // 2026-04-26 (owner-run SQL) showed the `$executeRaw` tombstone-
  // clear UPDATE never effectively reaches storage, so the FK still
  // fired P2003 on `category.delete`. A08-commit2 widens the pre-
  // check to count tombstones too, so any tombstone-only category
  // now 409s before storage is ever touched. Restoring the BUG-505-
  // A01 user-facing goal is queued for the day A06 commit 3 FINAL
  // drops the FK column entirely.
  it('gate 3: 409 IN_USE when only soft-deleted tombstones reference the category', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    // 4 tombstones (matches the 2026-04-26 prod evidence on `casual`).
    mockDb.product.count.mockResolvedValueOnce(4);

    const res = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error: { code: string; details?: { products_count?: number } };
    };
    expect(body.error.code).toBe('IN_USE');
    expect(body.error.details?.products_count).toBe(4);
    expect(mockDb.category.delete).not.toHaveBeenCalled();
    // Tombstone-clear `$executeRaw` UPDATE is unreachable when
    // pre-check 409s. Asserting it never fires guards against
    // future re-introduction of the BUG-505-A01-era code path.
    expect(mockDb.$executeRaw).not.toHaveBeenCalled();
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
