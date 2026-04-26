/**
 * BUG-404-A01 — Admin product create error envelope
 *
 * Spec gates exercised here (all MUST pass before merge):
 *   1. Duplicate SKU (Prisma P2002 with target=['sku'])
 *        → HTTP 409
 *        → JSON envelope {error:{code:'sku_conflict',field:'sku',message:...}}
 *   2. Duplicate SKU (pre-check hit: db.product.findFirst returns an active row)
 *        → HTTP 409
 *        → JSON envelope with the SAME shape as #1, so the frontend
 *          (BUG-404-A02) can branch on a single `code`.
 *   3. Unknown thrown error (e.g. raw `Error('boom')`)
 *        → HTTP 500
 *        → JSON envelope {error:{code:'internal_error',message:...}}
 *        → no stack trace, no raw DB error in the body.
 *   4. SQLSTATE 23505 fallback (raw pg-style error surfacing outside Prisma)
 *        → HTTP 409 with sku_conflict envelope (same as P2002).
 *   5. Happy path (`db.product.create` resolves) → 201 + product JSON
 *      shape unchanged from pre-A01 behaviour.
 *   6. All error responses carry Content-Type: application/json.
 *   7. Redaction: response bodies never contain Authorization header
 *      value, request body fields, stack frames, or raw DB error text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const models = [
    'product',
    'brand',
    'productImage',
    'auditLog',
    'productStockLog',
    'availabilityCalendar',
    'systemConfig',
    'adminUser',
    // BUG-504-A06 step 2/3: admin POST /products now resolves the
    // category slug → FK via db.category.findUnique during dual-write.
    'category',
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: vi.fn(async (ops: unknown[]) => {
      if (Array.isArray(ops)) return ops.map(() => ({ id: 'mock-id', stockOnHand: 0 }));
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
    };
  }
  return db;
});

vi.mock('../lib/db', () => ({
  getDb: vi.fn(() => mockDb),
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn() },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn(),
}));

import app from '../index';
import { Prisma } from '@prisma/client';

async function getAdminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken('00000000-0000-0000-0000-000000000099', 'admin@cutebunny.rental', 'superadmin');
}

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sku: 'D001',
    name: 'Minimal Test Product',
    // BUG-504-A06 commit 3 — POST now requires category_id (UUID); the
    // legacy `category` slug input was dropped from the zod schema.
    category_id: '00000000-0000-0000-0000-0000000000c1',
    size: ['M'],
    color: ['red'],
    rental_price_1day: 100,
    rental_price_3day: 250,
    rental_price_5day: 400,
    ...overrides,
  };
}

async function postCreate(body: unknown, token: string): Promise<Response> {
  return app.request('/api/v1/admin/products', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
}

// Utility: assert envelope invariants that must hold for EVERY error response.
function assertErrorEnvelopeInvariants(res: Response, body: unknown): void {
  // Gate #6: JSON content type.
  expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
  expect(body).not.toBeNull();
  expect(typeof body).toBe('object');
  const envelope = body as { error?: { code?: unknown; message?: unknown } };
  expect(envelope.error).toBeTruthy();
  expect(typeof envelope.error!.code).toBe('string');
  expect(typeof envelope.error!.message).toBe('string');
}

// Utility: gate #7 redaction check. Body must not leak internals.
function assertNoInternalLeakage(serialised: string, reqBody: Record<string, unknown>, token: string): void {
  // No raw bearer token or authorization value.
  expect(serialised).not.toContain(token);
  expect(serialised.toLowerCase()).not.toContain('bearer ');
  // No stack-frame markers.
  expect(serialised).not.toMatch(/\bat .+ \(.+:\d+:\d+\)/);
  // No raw Prisma / pg internals.
  expect(serialised).not.toMatch(/PrismaClientKnownRequestError/i);
  expect(serialised).not.toMatch(/\bPrisma\b.*\bmeta\b/i);
  expect(serialised).not.toMatch(/duplicate key value violates unique constraint/i);
  // No copied request body fields (e.g. the full submitted name / category).
  expect(serialised).not.toContain(String(reqBody.name));
}

describe('BUG-404-A01 — admin product create error envelope', () => {
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    token = await getAdminToken();
    // Default happy-path stubs.
    mockDb.product.findFirst.mockResolvedValue(null);
    mockDb.product.create.mockResolvedValue({
      id: 'prod-mock-1',
      sku: 'D001',
      name: 'Minimal Test Product',
      category: 'wedding',
      categoryId: '00000000-0000-0000-0000-0000000000c1',
    });
    // BUG-504-A06 step 2/3: dual-write resolver needs a category row.
    mockDb.category.findUnique.mockResolvedValue({
      id: '00000000-0000-0000-0000-0000000000c1',
      slug: 'wedding',
    });
  });

  // ─────────────────────────────────────────────────────────────
  // Gate #1 — Prisma P2002 on SKU unique index
  // ─────────────────────────────────────────────────────────────
  it('maps Prisma P2002 on sku to 409 sku_conflict envelope', async () => {
    // Bypass the pre-check so the create() throws.
    mockDb.product.findFirst.mockResolvedValue(null);
    const p2002 = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed on the fields: (`sku`)',
      { code: 'P2002', clientVersion: 'test', meta: { target: ['sku'] } },
    );
    mockDb.product.create.mockRejectedValue(p2002);

    const reqBody = validBody();
    const res = await postCreate(reqBody, token);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; field?: string; message: string } };
    assertErrorEnvelopeInvariants(res, body);
    expect(body.error.code).toBe('sku_conflict');
    expect(body.error.field).toBe('sku');
    assertNoInternalLeakage(JSON.stringify(body), reqBody, token);
  });

  // ─────────────────────────────────────────────────────────────
  // Gate #2 — existing pre-check path emits the SAME envelope
  // ─────────────────────────────────────────────────────────────
  it('pre-check duplicate hit emits the same sku_conflict envelope', async () => {
    mockDb.product.findFirst.mockResolvedValue({
      id: 'existing-1',
      sku: 'D001',
      deletedAt: null,
    });

    const reqBody = validBody();
    const res = await postCreate(reqBody, token);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; field?: string; message: string } };
    assertErrorEnvelopeInvariants(res, body);
    expect(body.error.code).toBe('sku_conflict');
    expect(body.error.field).toBe('sku');
    // pre-check must NOT invoke create()
    expect(mockDb.product.create).not.toHaveBeenCalled();
  });

  // ─────────────────────────────────────────────────────────────
  // Gate #3 — catch-all for unknown errors
  // ─────────────────────────────────────────────────────────────
  it('maps unknown thrown error to 500 internal_error with no stack leak', async () => {
    mockDb.product.findFirst.mockResolvedValue(null);
    const boom = new Error('boom: secret internal details here');
    boom.stack = 'Error: boom\n    at internal (/srv/api.js:42:10)';
    mockDb.product.create.mockRejectedValue(boom);

    const reqBody = validBody();
    const res = await postCreate(reqBody, token);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assertErrorEnvelopeInvariants(res, body);
    expect(body.error.code).toBe('internal_error');
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain('boom: secret internal details here');
    assertNoInternalLeakage(serialised, reqBody, token);
  });

  // ─────────────────────────────────────────────────────────────
  // Gate #4 — SQLSTATE 23505 fallback (pre-Prisma-mapping / raw PG)
  // ─────────────────────────────────────────────────────────────
  it('maps raw SQLSTATE 23505 error to 409 sku_conflict (fallback path)', async () => {
    mockDb.product.findFirst.mockResolvedValue(null);
    const raw = new Error(
      'duplicate key value violates unique constraint "products_sku_key" (SQLSTATE 23505)',
    );
    mockDb.product.create.mockRejectedValue(raw);

    const reqBody = validBody();
    const res = await postCreate(reqBody, token);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string; field?: string; message: string } };
    assertErrorEnvelopeInvariants(res, body);
    expect(body.error.code).toBe('sku_conflict');
    expect(body.error.field).toBe('sku');
    assertNoInternalLeakage(JSON.stringify(body), reqBody, token);
  });

  // ─────────────────────────────────────────────────────────────
  // Gate #5 — happy path shape is unchanged
  // ─────────────────────────────────────────────────────────────
  it('happy path returns 201 with product JSON of the same shape as pre-A01', async () => {
    mockDb.product.findFirst.mockResolvedValue(null);
    mockDb.product.create.mockResolvedValue({
      id: 'prod-mock-1',
      sku: 'MDT-S-WH-001',
      name: 'Memo Doll Top2',
      category: 'wedding',
    });

    const res = await postCreate(validBody({ sku: 'MDT-S-WH-001', name: 'Memo Doll Top2' }), token);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
    const body = (await res.json()) as { data: { id: string; sku: string; name: string; category: string } };
    // Pre-A01 contract: `{ data: { id, sku, name, category } }` — NOT a change.
    expect(body.data.id).toBe('prod-mock-1');
    expect(body.data.sku).toBe('MDT-S-WH-001');
    expect(body.data.name).toBe('Memo Doll Top2');
    expect(body.data.category).toBe('wedding');
  });

  // ─────────────────────────────────────────────────────────────
  // Gate #6 — every error response is JSON-typed (spot-check multi)
  // ─────────────────────────────────────────────────────────────
  it('all error responses are application/json across handler paths', async () => {
    // Validation error path: zod rejects missing required fields
    const res400 = await postCreate({ sku: '' }, token);
    expect(res400.status).toBe(400);
    expect(res400.headers.get('content-type') ?? '').toMatch(/application\/json/i);

    // sku_conflict path (pre-check)
    mockDb.product.findFirst.mockResolvedValue({ id: 'x', sku: 'D001', deletedAt: null });
    const res409 = await postCreate(validBody(), token);
    expect(res409.status).toBe(409);
    expect(res409.headers.get('content-type') ?? '').toMatch(/application\/json/i);

    // internal_error path
    mockDb.product.findFirst.mockResolvedValue(null);
    mockDb.product.create.mockRejectedValue(new Error('boom'));
    const res500 = await postCreate(validBody({ sku: 'UNIQUE-SKU-1' }), token);
    expect(res500.status).toBe(500);
    expect(res500.headers.get('content-type') ?? '').toMatch(/application\/json/i);
  });
});
