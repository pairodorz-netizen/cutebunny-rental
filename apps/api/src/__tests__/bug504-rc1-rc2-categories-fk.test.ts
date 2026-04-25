/**
 * BUG-504-RC1-RC2 — Categories CRUD regression fix (Option B).
 *
 * Two unrelated bugs braided into one symptom:
 *
 *   RC-1 (frontend): `request<void>(... DELETE)` calls `await res.json()`
 *         on a 204 No Content body → `SyntaxError: Unexpected end of
 *         JSON input` → mutation onError fires → row stays in cache
 *         even though the server-side delete succeeded.
 *
 *   RC-2 (backend): DELETE handler does not pre-check products linked
 *         to the category; Prisma raises P2003 against the
 *         products_category_id_fkey (ON DELETE RESTRICT); Hono
 *         onError swallows it as a generic 500 internal_error.
 *
 * This test file pins the Option-B contract:
 *   • DELETE on a category with 0 linked products  →  204, no body.
 *   • DELETE on a category with N>0 linked products →  409 IN_USE
 *     with `details: { products_count, slug }`. No row deleted, no
 *     audit log written, no FK exception leaked as 500.
 *   • Structured DELETE/PATCH log envelope shape (route, method,
 *     identifier_hash, outcome, error_code) — pure-function gate so
 *     the redaction contract is testable without a Worker harness.
 *   • Frontend `parseAdminSuccessResponse` returns `undefined` for
 *     204 / empty body (never crashes on JSON.parse('')).
 *
 * Out of scope (deferred per orchestrator): RC-3 cache hardening.
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
import {
  parseAdminSuccessResponse,
  buildAdminCrudLogEntry,
} from '@cutebunny/shared/diagnostics';

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

describe('BUG-504-RC1-RC2 — Categories CRUD regression fix (Option B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.category.findMany.mockResolvedValue([SEED_ROW]);
    mockDb.category.findUnique.mockResolvedValue(null);
    mockDb.category.delete.mockResolvedValue(SEED_ROW);
    mockDb.product.count.mockResolvedValue(0);
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  // ── RC-2 Gate 1 — DELETE on in-use category returns 409 IN_USE ────────
  it('RC-2: DELETE on category with N>0 linked products returns 409 IN_USE', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    mockDb.product.count.mockResolvedValueOnce(3);

    const res = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });

    expect(res.status).toBe(409);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: { products_count?: number; slug?: string } };
    };
    expect(body.error.code).toBe('IN_USE');
    expect(body.error.message).toMatch(/product/i);
    expect(body.error.details?.products_count).toBe(3);
    expect(body.error.details?.slug).toBe('wedding');
  });

  // ── RC-2 Gate 2 — pre-check prevents Prisma DELETE call ───────────────
  it('RC-2: DELETE on in-use category does NOT call category.delete', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    mockDb.product.count.mockResolvedValueOnce(1);

    await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });

    expect(mockDb.category.delete).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  // ── RC-2 Gate 3 — DELETE on unused category preserves 204 contract ────
  it('RC-2: DELETE on category with 0 linked products still returns 204', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    mockDb.product.count.mockResolvedValueOnce(0);

    const res = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });

    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect(mockDb.category.delete).toHaveBeenCalledWith({ where: { id: SEED_ROW.id } });
    expect(mockDb.auditLog.create).toHaveBeenCalledTimes(1);
  });

  // ── RC-1 Gate 4 — parseAdminSuccessResponse handles 204 cleanly ───────
  it('RC-1: parseAdminSuccessResponse(204) returns undefined (no JSON parse)', async () => {
    const res = new Response(null, { status: 204 });
    const out = await parseAdminSuccessResponse(res);
    expect(out).toBeUndefined();
  });

  // ── RC-1 Gate 5 — parseAdminSuccessResponse parses 200 JSON ───────────
  it('RC-1: parseAdminSuccessResponse(200 JSON) returns parsed payload', async () => {
    const payload = { data: { id: 'abc', slug: 'wedding' } };
    const res = new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
    const out = await parseAdminSuccessResponse(res);
    expect(out).toEqual(payload);
  });

  // ── RC-1 Gate 5b — parseAdminSuccessResponse handles empty 200 body ───
  it('RC-1: parseAdminSuccessResponse(200 empty body) returns undefined', async () => {
    const res = new Response(null, { status: 200 });
    const out = await parseAdminSuccessResponse(res);
    expect(out).toBeUndefined();
  });

  // ── Logging Gate 6 — buildAdminCrudLogEntry shape + identifier_hash ──
  it('logging: buildAdminCrudLogEntry produces structured envelope with hashed identifier', () => {
    const entry = buildAdminCrudLogEntry({
      route: '/api/v1/admin/categories/:id',
      method: 'DELETE',
      identifier: SEED_ROW.id,
      outcome: 'in_use_blocked',
      errorCode: 'IN_USE',
    });

    expect(entry.route).toBe('/api/v1/admin/categories/:id');
    expect(entry.method).toBe('DELETE');
    expect(entry.outcome).toBe('in_use_blocked');
    expect(entry.error_code).toBe('IN_USE');

    // identifier_hash is a stable, non-reversible token (12 hex chars).
    expect(typeof entry.identifier_hash).toBe('string');
    expect(entry.identifier_hash).toMatch(/^[0-9a-f]{12}$/);
    // Same input → same hash (deterministic).
    const entry2 = buildAdminCrudLogEntry({
      route: '/api/v1/admin/categories/:id',
      method: 'DELETE',
      identifier: SEED_ROW.id,
      outcome: 'in_use_blocked',
      errorCode: 'IN_USE',
    });
    expect(entry2.identifier_hash).toBe(entry.identifier_hash);
    // Different input → different hash.
    const entry3 = buildAdminCrudLogEntry({
      route: '/api/v1/admin/categories/:id',
      method: 'DELETE',
      identifier: '11111111-1111-1111-1111-111111111002',
      outcome: 'success',
      errorCode: null,
    });
    expect(entry3.identifier_hash).not.toBe(entry.identifier_hash);

    // Raw identifier MUST NOT appear anywhere in the serialized envelope.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(SEED_ROW.id);
  });

  // ── Logging Gate 7 — buildAdminCrudLogEntry redaction edge cases ─────
  it('logging: buildAdminCrudLogEntry handles success path (no error_code)', () => {
    const entry = buildAdminCrudLogEntry({
      route: '/api/v1/admin/categories/:id',
      method: 'PATCH',
      identifier: SEED_ROW.id,
      outcome: 'success',
      errorCode: null,
    });
    expect(entry.error_code).toBeNull();
    expect(entry.outcome).toBe('success');
  });
});
