/**
 * BUG-504-A03: Admin-only write endpoints for the `categories` table.
 *
 * Scope (API side):
 *   • GET    /api/v1/admin/categories         — admin list (incl. hidden)
 *   • POST   /api/v1/admin/categories         — create
 *   • PATCH  /api/v1/admin/categories/:id     — partial update
 *   • DELETE /api/v1/admin/categories/:id     — hard delete
 *
 * Non-goals (explicitly NOT in A03):
 *   • products.category enum cutover  (A06)
 *   • customer-site wiring            (A04)
 *   • legacy /api/v1/admin/settings/categories endpoints — UNTOUCHED so
 *     the existing products.tsx dropdown keeps working.
 *   • public cache purge on write — 5-min edge staleness is acceptable
 *     and documented in the PR body.
 *
 * TDD acceptance gates (ratified by Qew):
 *   1.  401 without Authorization header (all methods).
 *   2.  403 with a non-superadmin token (POST / PATCH / DELETE only).
 *   3.  200 admin list returns every row (incl. hidden) in
 *       `sort_order ASC`, snake_case at the API boundary.
 *   4.  Admin list has NO `Cache-Control` header (admin writes must
 *       read-back fresh).
 *   5.  POST validates required fields
 *       (slug / name_th / name_en / sort_order).
 *   6.  POST returns 409 on duplicate slug (server-side unique guard
 *       independent of the DB P2002).
 *   7.  POST 201 returns the created row in snake_case.
 *   8.  PATCH is partial — unspecified fields preserved.
 *   9.  PATCH 404 when the id does not exist.
 *  10.  PATCH returns 409 if the new slug collides with another row.
 *  11.  DELETE 204 on success, 404 on missing id.
 *  12.  DB throw on any write path → 500 JSON envelope via `onError()`,
 *       no stack, no DB leak, Content-Type: application/json.
 *  13.  A02 public `GET /api/v1/categories` shape untouched (regression
 *       guard — the existing snake_case keys + Cache-Control: public,
 *       max-age=300, s-maxage=300 are preserved).
 *  14.  Empty name_th / name_en rejected with 400 VALIDATION_ERROR
 *       (i18n both required).
 *  15.  Slug must match `^[a-z0-9_-]+$` — uppercase / whitespace / dot
 *       rejected.
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

async function superadminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'superadmin');
}

async function staffToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'staff@cutebunny.rental', 'staff');
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

const CANONICAL_SEED = [
  { ...SEED_ROW },
  { id: '11111111-1111-1111-1111-111111111002', slug: 'evening',     nameTh: 'ชุดราตรี',     nameEn: 'Evening',     sortOrder: 20, visibleFrontend: true,  visibleBackend: true,  createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111003', slug: 'cocktail',    nameTh: 'ค็อกเทล',      nameEn: 'Cocktail',    sortOrder: 30, visibleFrontend: true,  visibleBackend: true,  createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111004', slug: 'casual',      nameTh: 'ชุดลำลอง',    nameEn: 'Casual',      sortOrder: 40, visibleFrontend: true,  visibleBackend: true,  createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111005', slug: 'costume',     nameTh: 'ชุดแฟนซี',    nameEn: 'Costume',     sortOrder: 50, visibleFrontend: false, visibleBackend: true,  createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111006', slug: 'traditional', nameTh: 'ชุดไทย',       nameEn: 'Traditional', sortOrder: 60, visibleFrontend: true,  visibleBackend: true,  createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111007', slug: 'accessories', nameTh: 'เครื่องประดับ', nameEn: 'Accessories', sortOrder: 70, visibleFrontend: true,  visibleBackend: true,  createdAt: new Date(), updatedAt: new Date() },
];

const PUBLIC_FIELDS = ['id', 'slug', 'name_th', 'name_en', 'sort_order', 'visible_frontend', 'visible_backend'] as const;

function assertErrorEnvelopeInvariants(res: Response, body: unknown): void {
  expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
  const err = (body as { error?: { code?: unknown; message?: unknown; details?: unknown; stack?: unknown } }).error;
  expect(err).toBeTruthy();
  expect(typeof err?.code).toBe('string');
  expect(typeof err?.message).toBe('string');
  // No stack / raw Prisma text / bearer leak.
  const serialized = JSON.stringify(body);
  expect(serialized).not.toMatch(/at \w+ \(/); // JS stack frames
  expect(serialized).not.toMatch(/Prisma/i);
  expect(serialized).not.toMatch(/Bearer /i);
}

describe('BUG-504-A03 — admin categories CRUD', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // default: list returns 7 canonical rows
    mockDb.category.findMany.mockResolvedValue(CANONICAL_SEED);
    mockDb.category.findUnique.mockResolvedValue(null);
    mockDb.category.create.mockResolvedValue(SEED_ROW);
    mockDb.category.update.mockResolvedValue(SEED_ROW);
    mockDb.category.delete.mockResolvedValue(SEED_ROW);
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  // ── Gate 1 — unauthenticated 401 for every verb ─────────────────────
  it('401 without Authorization header on all four verbs', async () => {
    const paths: Array<[string, string, Record<string, unknown> | null]> = [
      ['GET',    '/api/v1/admin/categories',          null],
      ['POST',   '/api/v1/admin/categories',          { slug: 'new', name_th: 'ใหม่', name_en: 'New', sort_order: 80 }],
      ['PATCH',  '/api/v1/admin/categories/11111111-1111-1111-1111-111111111001', { name_en: 'X' }],
      ['DELETE', '/api/v1/admin/categories/11111111-1111-1111-1111-111111111001', null],
    ];
    for (const [method, path, body] of paths) {
      const res = await app.request(path, {
        method,
        headers: jsonHeaders(),
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  // ── Gate 2 — staff token hits 403 on writes ─────────────────────────
  it('403 on write verbs with non-superadmin (staff) token', async () => {
    const token = await staffToken();
    const writes: Array<[string, string, Record<string, unknown> | null]> = [
      ['POST',   '/api/v1/admin/categories',          { slug: 'new', name_th: 'ใหม่', name_en: 'New', sort_order: 80 }],
      ['PATCH',  '/api/v1/admin/categories/11111111-1111-1111-1111-111111111001', { name_en: 'X' }],
      ['DELETE', '/api/v1/admin/categories/11111111-1111-1111-1111-111111111001', null],
    ];
    for (const [method, path, body] of writes) {
      const res = await app.request(path, {
        method,
        headers: jsonHeaders(token),
        body: body ? JSON.stringify(body) : undefined,
      });
      expect(res.status, `${method} ${path}`).toBe(403);
    }
  });

  // ── Gate 3 — admin list shape & order ───────────────────────────────
  it('GET list returns 7 rows in sort_order ASC with snake_case keys', async () => {
    const token = await superadminToken();
    const res = await app.request('/api/v1/admin/categories', { headers: jsonHeaders(token) });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(7);
    // Ensure Prisma called with correct orderBy
    expect(mockDb.category.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { sortOrder: 'asc' } }),
    );
    // snake_case, exact key set
    for (const item of body.data) {
      expect(Object.keys(item).sort()).toEqual([...PUBLIC_FIELDS].sort());
    }
    // Includes hidden row (costume.visible_frontend=false)
    const costume = body.data.find((r) => r.slug === 'costume');
    expect(costume?.visible_frontend).toBe(false);
  });

  // ── Gate 4 — admin list has NO Cache-Control (always fresh) ─────────
  it('admin list response must not advertise cache', async () => {
    const token = await superadminToken();
    const res = await app.request('/api/v1/admin/categories', { headers: jsonHeaders(token) });
    const cache = res.headers.get('cache-control');
    // Either absent or an explicit no-store; never the public 300s of A02
    if (cache) expect(cache).not.toMatch(/public/i);
  });

  // ── Gate 5 — POST rejects missing fields ────────────────────────────
  it('POST rejects when slug / name_th / name_en / sort_order missing', async () => {
    const token = await superadminToken();
    const bodies = [
      { name_th: 'ใหม่', name_en: 'New', sort_order: 80 },                     // no slug
      { slug: 'new',     name_en: 'New', sort_order: 80 },                     // no name_th
      { slug: 'new',     name_th: 'ใหม่', sort_order: 80 },                    // no name_en
      { slug: 'new',     name_th: 'ใหม่', name_en: 'New' },                    // no sort_order
      {},                                                                      // empty
    ];
    for (const body of bodies) {
      const res = await app.request('/api/v1/admin/categories', {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
      const json = await res.json() as { error: { code: string } };
      expect(json.error.code).toBe('VALIDATION_ERROR');
    }
  });

  // ── Gate 6 — POST duplicate slug → 409 ──────────────────────────────
  it('POST returns 409 when slug already exists', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    const res = await app.request('/api/v1/admin/categories', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ slug: 'wedding', name_th: 'ใหม่', name_en: 'New', sort_order: 80 }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(body.error.message).toMatch(/wedding/i);
    expect(mockDb.category.create).not.toHaveBeenCalled();
  });

  // ── Gate 7 — POST 201 snake_case on success ─────────────────────────
  it('POST 201 returns created row in snake_case', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce(null);
    mockDb.category.create.mockResolvedValueOnce({
      id: 'new-id',
      slug: 'new-slug',
      nameTh: 'ใหม่',
      nameEn: 'New',
      sortOrder: 80,
      visibleFrontend: true,
      visibleBackend: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await app.request('/api/v1/admin/categories', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ slug: 'new-slug', name_th: 'ใหม่', name_en: 'New', sort_order: 80 }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(Object.keys(body.data).sort()).toEqual([...PUBLIC_FIELDS].sort());
    expect(body.data.slug).toBe('new-slug');
    expect(body.data.name_th).toBe('ใหม่');
    expect(body.data.name_en).toBe('New');
    expect(body.data.sort_order).toBe(80);
    // Prisma arg uses camelCase (schema-mapped)
    expect(mockDb.category.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          slug: 'new-slug',
          nameTh: 'ใหม่',
          nameEn: 'New',
          sortOrder: 80,
        }),
      }),
    );
  });

  // ── Gate 8 — PATCH is partial ───────────────────────────────────────
  it('PATCH with only name_en does NOT touch other fields', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    mockDb.category.update.mockResolvedValueOnce({ ...SEED_ROW, nameEn: 'Wedding Pro' });
    const res = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name_en: 'Wedding Pro' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data.name_en).toBe('Wedding Pro');
    expect(mockDb.category.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SEED_ROW.id },
        data: { nameEn: 'Wedding Pro' }, // only this one field
      }),
    );
  });

  // ── Gate 9 — PATCH 404 when missing ─────────────────────────────────
  it('PATCH returns 404 when id does not exist', async () => {
    const token = await superadminToken();
    mockDb.category.findUnique.mockResolvedValueOnce(null);
    const res = await app.request('/api/v1/admin/categories/11111111-0000-0000-0000-000000000000', {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name_en: 'X' }),
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
    expect(mockDb.category.update).not.toHaveBeenCalled();
  });

  // ── Gate 10 — PATCH slug collision → 409 ────────────────────────────
  it('PATCH returns 409 when new slug collides with another row', async () => {
    const token = await superadminToken();
    // first findUnique (by id) resolves to current row; second (by slug) resolves to OTHER row
    mockDb.category.findUnique
      .mockResolvedValueOnce({ ...SEED_ROW })                                // fetch current
      .mockResolvedValueOnce({ ...SEED_ROW, id: 'other-id', slug: 'evening' }); // slug conflict
    const res = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ slug: 'evening' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe('CONFLICT');
    expect(mockDb.category.update).not.toHaveBeenCalled();
  });

  // ── Gate 11 — DELETE 204 / 404 ──────────────────────────────────────
  it('DELETE returns 204 on success, 404 on missing', async () => {
    const token = await superadminToken();

    // success
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    const ok = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });
    expect(ok.status).toBe(204);
    expect(await ok.text()).toBe('');
    expect(mockDb.category.delete).toHaveBeenCalledWith({ where: { id: SEED_ROW.id } });

    // missing
    mockDb.category.findUnique.mockResolvedValueOnce(null);
    const miss = await app.request('/api/v1/admin/categories/11111111-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });
    expect(miss.status).toBe(404);
    const body = await miss.json() as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  // ── Gate 12 — onError redacted 500 envelope ─────────────────────────
  it('DB throw on any write returns 500 JSON envelope with redaction baseline', async () => {
    const token = await superadminToken();

    // POST path
    mockDb.category.findUnique.mockRejectedValueOnce(new Error('connection terminated'));
    const r1 = await app.request('/api/v1/admin/categories', {
      method: 'POST',
      headers: jsonHeaders(token),
      body: JSON.stringify({ slug: 'boom', name_th: 'x', name_en: 'y', sort_order: 80 }),
    });
    expect(r1.status).toBe(500);
    const b1 = await r1.json();
    assertErrorEnvelopeInvariants(r1, b1);
    expect((b1 as { error: { code: string; message: string } }).error.code).toBe('internal_error');

    // PATCH path
    mockDb.category.findUnique.mockRejectedValueOnce(new Error('connection terminated'));
    const r2 = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name_en: 'X' }),
    });
    expect(r2.status).toBe(500);
    assertErrorEnvelopeInvariants(r2, await r2.json());

    // DELETE path
    mockDb.category.findUnique.mockRejectedValueOnce(new Error('connection terminated'));
    const r3 = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'DELETE',
      headers: jsonHeaders(token),
    });
    expect(r3.status).toBe(500);
    assertErrorEnvelopeInvariants(r3, await r3.json());
  });

  // ── Gate 13 — A02 public GET regression guard ───────────────────────
  it('A02 public GET /api/v1/categories shape + Cache-Control untouched', async () => {
    mockDb.category.findMany.mockResolvedValueOnce(CANONICAL_SEED);
    const res = await app.request('/api/v1/categories');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300');
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(7);
    for (const item of body.data) {
      expect(Object.keys(item).sort()).toEqual([...PUBLIC_FIELDS].sort());
    }
  });

  // ── Gate 14 — empty name_th / name_en rejected ──────────────────────
  it('empty name_th or name_en rejected with 400', async () => {
    const token = await superadminToken();
    const empties = [
      { slug: 'new', name_th: '',    name_en: 'New', sort_order: 80 },
      { slug: 'new', name_th: 'ใหม่', name_en: '',   sort_order: 80 },
    ];
    for (const body of empties) {
      const res = await app.request('/api/v1/admin/categories', {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
    // PATCH to empty also rejected
    mockDb.category.findUnique.mockResolvedValueOnce({ ...SEED_ROW });
    const r = await app.request(`/api/v1/admin/categories/${SEED_ROW.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(token),
      body: JSON.stringify({ name_en: '' }),
    });
    expect(r.status).toBe(400);
  });

  // ── Gate 15 — slug format guard ─────────────────────────────────────
  it('rejects uppercase / whitespace / dot slugs', async () => {
    const token = await superadminToken();
    const invalid = ['Wedding', 'new slug', 'new.slug', 'NEW', 'new/slug'];
    for (const slug of invalid) {
      const res = await app.request('/api/v1/admin/categories', {
        method: 'POST',
        headers: jsonHeaders(token),
        body: JSON.stringify({ slug, name_th: 'ใหม่', name_en: 'New', sort_order: 80 }),
      });
      expect(res.status, `slug ${slug}`).toBe(400);
    }
  });
});
