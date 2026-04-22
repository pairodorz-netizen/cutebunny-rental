/**
 * BUG-504-A02: Public `GET /api/v1/categories` Worker route.
 *
 * TDD acceptance gates (13 total):
 *   1.  Route mounted (200, not 404)
 *   2.  Envelope shape `{ data: [...] }`
 *   3.  Row count = 7 when 7 mocked rows returned
 *   4.  Ordered by sort_order ASC
 *   5.  Each item exposes exactly the 7 public fields
 *   6.  Field names are snake_case (id/slug/name_th/name_en/sort_order/
 *       visible_frontend/visible_backend) — no camelCase leak
 *   7.  Prisma called with `orderBy: { sortOrder: 'asc' }`
 *   8.  Cache-Control: public, max-age=300, s-maxage=300
 *   9.  Content-Type: application/json
 *  10.  CORS preflight (OPTIONS) returns 204 with GET allowed
 *  11.  Public (no Authorization header) → 200
 *  12.  DB throw → 500 JSON envelope via `error()` helper, no stack / DB leak
 *  13.  Empty table → 200 with `{ data: [] }` (not 404)
 *
 * Scope: A02 only — API route. No admin CRUD (A03), no customer wiring
 * (A04), no Playwright (A05), no enum cutover (A06).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Inline hoisted mockDb — mirrors t01-api-contracts.test.ts pattern.
// Adds `category` model that the A01-created Prisma model exposes.
const mockDb = vi.hoisted(() => {
  const models = [
    'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
    'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
    'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
    'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
    'auditLog', 'inventoryUnit', 'comboSet', 'comboSetItem', 'productStockLog',
    'financeCategory', 'systemConfig', 'notificationLog',
    // A01 addition:
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

// Canonical A01 seed — same 7 rows the migration inserted. Keys are the
// Prisma-client camelCase representation (matching schema.prisma
// @map("…") directives). The route handler is responsible for
// projecting these to snake_case at the API boundary.
const CANONICAL_SEED = [
  { id: '11111111-1111-1111-1111-111111111001', slug: 'wedding',     nameTh: 'ชุดแต่งงาน',  nameEn: 'Wedding',     sortOrder: 10, visibleFrontend: true, visibleBackend: true, createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111002', slug: 'evening',     nameTh: 'ชุดราตรี',     nameEn: 'Evening',     sortOrder: 20, visibleFrontend: true, visibleBackend: true, createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111003', slug: 'cocktail',    nameTh: 'ค็อกเทล',      nameEn: 'Cocktail',    sortOrder: 30, visibleFrontend: true, visibleBackend: true, createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111004', slug: 'casual',      nameTh: 'ชุดลำลอง',    nameEn: 'Casual',      sortOrder: 40, visibleFrontend: true, visibleBackend: true, createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111005', slug: 'costume',     nameTh: 'ชุดแฟนซี',    nameEn: 'Costume',     sortOrder: 50, visibleFrontend: true, visibleBackend: true, createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111006', slug: 'traditional', nameTh: 'ชุดไทย',       nameEn: 'Traditional', sortOrder: 60, visibleFrontend: true, visibleBackend: true, createdAt: new Date(), updatedAt: new Date() },
  { id: '11111111-1111-1111-1111-111111111007', slug: 'accessories', nameTh: 'เครื่องประดับ', nameEn: 'Accessories', sortOrder: 70, visibleFrontend: true, visibleBackend: true, createdAt: new Date(), updatedAt: new Date() },
];

const PUBLIC_FIELDS = [
  'id',
  'slug',
  'name_th',
  'name_en',
  'sort_order',
  'visible_frontend',
  'visible_backend',
] as const;

describe('BUG-504-A02: GET /api/v1/categories', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.category.findMany.mockResolvedValue(CANONICAL_SEED);
  });

  // ─── Gate 1 ─ route mounted ────────────────────────────────────────
  it('gate 1: route is mounted (200, not 404)', async () => {
    const res = await app.request('/api/v1/categories');
    expect(res.status).toBe(200);
  });

  // ─── Gate 2 ─ envelope shape ───────────────────────────────────────
  it('gate 2: returns envelope { data: [...] }', async () => {
    const res = await app.request('/api/v1/categories');
    const body = await res.json();
    expect(body).toHaveProperty('data');
    expect(Array.isArray(body.data)).toBe(true);
  });

  // ─── Gate 3 ─ count ────────────────────────────────────────────────
  it('gate 3: returns 7 items when DB has 7 rows', async () => {
    const res = await app.request('/api/v1/categories');
    const body = await res.json();
    expect(body.data).toHaveLength(7);
  });

  // ─── Gate 4 ─ ordered by sort_order ASC ────────────────────────────
  it('gate 4: items are ordered by sort_order ascending', async () => {
    const res = await app.request('/api/v1/categories');
    const body = await res.json();
    const sortOrders = body.data.map((c: { sort_order: number }) => c.sort_order);
    expect(sortOrders).toEqual([10, 20, 30, 40, 50, 60, 70]);
    for (let i = 1; i < sortOrders.length; i++) {
      expect(sortOrders[i]).toBeGreaterThan(sortOrders[i - 1]);
    }
  });

  // ─── Gate 5 ─ exact public field set ───────────────────────────────
  it('gate 5: each item exposes exactly the 7 public fields (no more, no less)', async () => {
    const res = await app.request('/api/v1/categories');
    const body = await res.json();
    for (const item of body.data) {
      const keys = Object.keys(item).sort();
      expect(keys).toEqual([...PUBLIC_FIELDS].sort());
    }
  });

  // ─── Gate 6 ─ snake_case at the boundary ───────────────────────────
  it('gate 6: field names are snake_case — no camelCase leak from Prisma', async () => {
    const res = await app.request('/api/v1/categories');
    const body = await res.json();
    const serialized = JSON.stringify(body);
    // Sanity: snake_case keys appear in the body.
    expect(serialized).toContain('"slug"');
    expect(serialized).toContain('"name_th"');
    expect(serialized).toContain('"name_en"');
    expect(serialized).toContain('"sort_order"');
    expect(serialized).toContain('"visible_frontend"');
    expect(serialized).toContain('"visible_backend"');
    // Forbidden: Prisma camelCase must NOT reach the wire.
    expect(serialized).not.toContain('"nameTh"');
    expect(serialized).not.toContain('"nameEn"');
    expect(serialized).not.toContain('"sortOrder"');
    expect(serialized).not.toContain('"visibleFrontend"');
    expect(serialized).not.toContain('"visibleBackend"');
    // Also: no incidental DB columns leak.
    expect(serialized).not.toContain('"createdAt"');
    expect(serialized).not.toContain('"updatedAt"');
    expect(serialized).not.toContain('"created_at"');
    expect(serialized).not.toContain('"updated_at"');
  });

  // ─── Gate 7 ─ Prisma call shape ────────────────────────────────────
  it('gate 7: Prisma findMany called with orderBy: { sortOrder: "asc" }', async () => {
    await app.request('/api/v1/categories');
    expect(mockDb.category.findMany).toHaveBeenCalledTimes(1);
    const callArg = mockDb.category.findMany.mock.calls[0][0];
    expect(callArg).toMatchObject({ orderBy: { sortOrder: 'asc' } });
  });

  // ─── Gate 8 ─ Cache-Control ────────────────────────────────────────
  it('gate 8: sets Cache-Control: public, max-age=300, s-maxage=300', async () => {
    const res = await app.request('/api/v1/categories');
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/public/);
    expect(cc).toMatch(/max-age=300/);
    expect(cc).toMatch(/s-maxage=300/);
  });

  // ─── Gate 9 ─ Content-Type ─────────────────────────────────────────
  it('gate 9: responds with application/json', async () => {
    const res = await app.request('/api/v1/categories');
    const ct = res.headers.get('content-type') ?? '';
    expect(ct).toMatch(/application\/json/);
  });

  // ─── Gate 10 ─ CORS preflight ──────────────────────────────────────
  it('gate 10: OPTIONS preflight returns 2xx with GET allowed', async () => {
    const res = await app.request('/api/v1/categories', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://customer-eta-ruby.vercel.app',
        'Access-Control-Request-Method': 'GET',
      },
    });
    expect([200, 204]).toContain(res.status);
    const methods = res.headers.get('access-control-allow-methods') ?? '';
    expect(methods.toUpperCase()).toContain('GET');
  });

  // ─── Gate 11 ─ public (no auth) ────────────────────────────────────
  it('gate 11: no Authorization header → 200 (public endpoint)', async () => {
    const res = await app.request('/api/v1/categories', {
      headers: { /* deliberately empty */ },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('data');
  });

  // ─── Gate 12 ─ DB throw → 500 JSON envelope ────────────────────────
  it('gate 12: DB throw → 500 JSON envelope, no stack / DB leak', async () => {
    mockDb.category.findMany.mockRejectedValueOnce(
      new Error('kaboom: relation "categories" does not exist')
    );
    const res = await app.request('/api/v1/categories');
    expect(res.status).toBe(500);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.error).toHaveProperty('code');
    expect(body.error).toHaveProperty('message');
    const serialized = JSON.stringify(body);
    // Redaction baseline (mirror BUG-404-A01 / BUG-405-A01):
    expect(serialized).not.toContain('kaboom');
    expect(serialized).not.toContain('relation');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toMatch(/at \S+ \(/); // no Node.js stack frames
  });

  // ─── Gate 13 ─ empty table ─────────────────────────────────────────
  it('gate 13: empty table → 200 with { data: [] }', async () => {
    mockDb.category.findMany.mockResolvedValueOnce([]);
    const res = await app.request('/api/v1/categories');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ data: [] });
  });
});
