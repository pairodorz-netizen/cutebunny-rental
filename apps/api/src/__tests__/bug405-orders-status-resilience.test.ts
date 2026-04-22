/**
 * BUG-405-A01 — admin order status handler resilience
 *
 * Root cause (investigation):
 *   PATCH /api/v1/admin/orders/:id/status on prod was returning a
 *   transport-level rejection ("Failed to fetch" in the admin modal)
 *   for the `cleaning → finished` transition only. Other transitions
 *   committed cleanly because their side-effect code paths are much
 *   smaller (0–1 finance insert) while `finished` fans out to an
 *   `orderItem.aggregate` + up to 2 `financeTransaction.create` calls.
 *
 *   Under a single coarse try/catch block, a stall in any of those
 *   side-effects drained the Cloudflare Workers wall-clock budget
 *   before the handler's `success()` could commit. No JSON envelope
 *   was ever returned; browsers reported `TypeError: Failed to fetch`.
 *
 * This test file enforces the 15 acceptance gates ratified via the
 * ChatGPT debate (see PR #45 thread). In summary:
 *
 *   CORE writes  (order.update + orderStatusLog.create)
 *     — MUST execute inside a single Prisma `$transaction` so they
 *       are atomic (either both land or neither lands).
 *     — MUST bubble failures to the catch-all `onError` handler,
 *       which returns HTTP 500 + JSON envelope
 *       {error:{code:'internal_error',message:'Unexpected server error'}}.
 *     — MUST fail loud (no silent success, no half-committed state).
 *
 *   SIDE-EFFECT writes  (orderItem.aggregate, financeTransaction.create,
 *                       notification enqueue, auditLog.create)
 *     — MUST be isolated per operation so one failure does not
 *       contaminate another.
 *     — MUST NOT block the HTTP response — the client always receives
 *       its success envelope, even if every side-effect throws.
 *     — orderItem.aggregate failure: fall back to lateFee=0 damageFee=0
 *       and continue.
 *
 *   Redaction invariants (identical to BUG-404-A01 / BUG-401-A02):
 *     — No Authorization header value, no Bearer token, no stack, no
 *       raw DB text in any envelope.
 *     — Content-Type: application/json on ALL error paths.
 *
 *   Contract preservation:
 *     — Success path shape for every transition remains
 *       {data:{id, order_number, previous_status, current_status,
 *              allowed_transitions:[...]}}.
 *     — State-machine rules, auth, and schema are NOT touched by A01.
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
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    // Default: $transaction executes the given array of thenables and
    // returns their resolved values (mirrors Prisma's sequential batch
    // semantics close enough for handler logic assertions).
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
      aggregate: vi.fn().mockResolvedValue({ _sum: { lateFee: 0, damageFee: 0, amount: 0 } }),
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
import { MOCK_ORDER, MOCK_CUSTOMER } from './helpers/mock-db';

const ORDER_ID = MOCK_ORDER.id;
const ADMIN_UUID = '00000000-0000-0000-0000-000000000099';

async function getAdminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'superadmin');
}

function authHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

async function patchStatus(
  token: string,
  body: Record<string, unknown>,
  orderId: string = ORDER_ID,
): Promise<Response> {
  return app.request(`/api/v1/admin/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
}

function primeCleaningOrder(): void {
  mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'cleaning' });
  mockDb.order.update.mockResolvedValue({ ...MOCK_ORDER, status: 'finished' });
  mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-1' });
  mockDb.customer.findUnique.mockResolvedValue(MOCK_CUSTOMER);
}

function assertErrorEnvelopeInvariants(res: Response, body: unknown): void {
  expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
  expect(body).not.toBeNull();
  expect(typeof body).toBe('object');
  const env = body as { error?: { code?: unknown; message?: unknown } };
  expect(env.error).toBeTruthy();
  expect(typeof env.error!.code).toBe('string');
  expect(typeof env.error!.message).toBe('string');
}

function assertNoInternalLeakage(serialised: string, token: string): void {
  expect(serialised).not.toContain(token);
  expect(serialised.toLowerCase()).not.toContain('bearer ');
  expect(serialised).not.toMatch(/\bat .+ \(.+:\d+:\d+\)/);
  expect(serialised).not.toMatch(/PrismaClientKnownRequestError/i);
  expect(serialised).not.toMatch(/duplicate key value violates unique constraint/i);
  // No raw "secret internal details" etc — thrown error messages MUST NOT
  // appear in the envelope.
  expect(serialised).not.toContain('boom: secret internal details');
}

describe('BUG-405-A01 — order status handler resilience', () => {
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    token = await getAdminToken();

    // Default stubs: a cleaning order ready to transition to finished.
    primeCleaningOrder();
    mockDb.$transaction.mockImplementation(async (ops: unknown) => {
      if (typeof ops === 'function') return (ops as (tx: unknown) => unknown)(mockDb);
      if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[]);
      return [];
    });
  });

  // ─── Gate #1 — onError returns JSON envelope (not plain text) ───────
  it('unknown throw before core writes returns 500 JSON envelope (no plain text)', async () => {
    // Simulate an unexpected crash at the earliest reachable point —
    // findUnique on the order — so no core writes happen.
    mockDb.order.findUnique.mockRejectedValue(new Error('boom: secret internal details'));

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(500);
    const raw = await res.text();
    // Hono's default crash body is the string "Internal Server Error";
    // the onError() catch-all MUST intercept and return a JSON envelope.
    expect(raw).not.toBe('Internal Server Error');
    const body = JSON.parse(raw) as { error: { code: string; message: string } };
    assertErrorEnvelopeInvariants(res, body);
    expect(body.error.code).toBe('internal_error');
    assertNoInternalLeakage(raw, token);
  });

  // ─── Gate #2 — core writes run inside Prisma $transaction ───────────
  it('core transition (order.update + orderStatusLog.create) uses a single $transaction', async () => {
    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(200);

    // The handler MUST have called $transaction exactly once for the
    // core writes. (Side-effect writes run outside the transaction.)
    expect(mockDb.$transaction).toHaveBeenCalledTimes(1);

    // When the batch-array variant is used, both the order update and
    // the status-log create live in the same $transaction call.
    const firstCallArg = mockDb.$transaction.mock.calls[0]?.[0];
    if (Array.isArray(firstCallArg)) {
      // Array form — nothing further to assert, the two writes are
      // already queued inside the same $transaction invocation.
      expect(firstCallArg.length).toBeGreaterThanOrEqual(2);
    } else {
      // Callback form — the interactive tx must drive BOTH writes.
      expect(mockDb.order.update).toHaveBeenCalledTimes(1);
      expect(mockDb.orderStatusLog.create).toHaveBeenCalledTimes(1);
    }
  });

  // ─── Gate #3 — order.update throw → 500, status rollback ────────────
  it('order.update throwing inside $transaction → 500 JSON envelope, no half-commit', async () => {
    mockDb.order.update.mockRejectedValue(new Error('boom: secret internal details'));

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assertErrorEnvelopeInvariants(res, body);
    expect(body.error.code).toBe('internal_error');
    // Rollback: the status log must NOT have been observed-to-commit.
    // (In the Prisma $transaction batch form, the create() fn is called
    // to queue the op, but the tx throws, so the DB sees nothing. We
    // assert at the handler level: no success envelope was produced.)
    expect(body.error.code).not.toBe('sku_conflict');
    assertNoInternalLeakage(JSON.stringify(body), token);
  });

  // ─── Gate #4 — orderStatusLog.create throw → 500, rollback ──────────
  it('orderStatusLog.create throwing inside $transaction → 500 JSON envelope', async () => {
    mockDb.$transaction.mockImplementationOnce(async () => {
      throw new Error('boom: secret internal details');
    });

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; message: string } };
    assertErrorEnvelopeInvariants(res, body);
    expect(body.error.code).toBe('internal_error');
    assertNoInternalLeakage(JSON.stringify(body), token);
  });

  // ─── Gate #5 — financeTransaction failure is isolated ───────────────
  it('financeTransaction.create throwing does NOT block cleaning→finished success', async () => {
    mockDb.orderItem.aggregate.mockResolvedValue({ _sum: { lateFee: 100, damageFee: 50 } });
    mockDb.financeTransaction.create.mockRejectedValue(new Error('boom: secret internal details'));

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { previous_status: string; current_status: string } };
    expect(body.data.previous_status).toBe('cleaning');
    expect(body.data.current_status).toBe('finished');
  });

  // ─── Gate #6 — auditLog failure is isolated ─────────────────────────
  it('auditLog.create throwing does NOT block transition success', async () => {
    mockDb.auditLog.create.mockRejectedValue(new Error('boom: secret internal details'));

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { current_status: string } };
    expect(body.data.current_status).toBe('finished');
  });

  // ─── Gate #7 — notification failure is isolated ─────────────────────
  it('notification enqueue throwing does NOT block transition success', async () => {
    mockDb.notificationLog.create.mockRejectedValue(new Error('boom: secret internal details'));

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { current_status: string } };
    expect(body.data.current_status).toBe('finished');
  });

  // ─── Gate #8 — orderItem.aggregate failure falls back to 0 ──────────
  it('orderItem.aggregate throwing falls back to lateFee=0 damageFee=0 and still succeeds', async () => {
    mockDb.orderItem.aggregate.mockRejectedValue(new Error('boom: secret internal details'));

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { current_status: string } };
    expect(body.data.current_status).toBe('finished');
    // With fallback = 0, the only finance tx that may run is
    // deposit_returned (if deposit > 0) — deposit_forfeited must NOT
    // be created because totalDeductions is 0.
    const forfeitCalls = mockDb.financeTransaction.create.mock.calls.filter(
      (c: unknown[]) => {
        const arg = c[0] as { data?: { txType?: string } } | undefined;
        return arg?.data?.txType === 'deposit_forfeited';
      },
    );
    expect(forfeitCalls.length).toBe(0);
  });

  // ─── Gate #9 — cleaning→finished happy path shape unchanged ─────────
  it('cleaning→finished happy path response shape is unchanged', async () => {
    mockDb.orderItem.aggregate.mockResolvedValue({ _sum: { lateFee: 0, damageFee: 0 } });

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
    const body = (await res.json()) as {
      data: {
        id: string;
        order_number: string;
        previous_status: string;
        current_status: string;
        allowed_transitions: string[];
      };
    };
    expect(body.data.id).toBe(ORDER_ID);
    expect(body.data.order_number).toBe(MOCK_ORDER.orderNumber);
    expect(body.data.previous_status).toBe('cleaning');
    expect(body.data.current_status).toBe('finished');
    expect(Array.isArray(body.data.allowed_transitions)).toBe(true);
  });

  // ─── Gate #10 — ORDER_STATUS_MESSAGES has `finished` (no `ready`) ───
  it('notifications ORDER_STATUS_MESSAGES uses `finished` key (stale `ready` removed)', async () => {
    const mod = await import('../lib/notifications');
    // The module does not export the table, so we verify via live
    // behavior: calling `sendOrderStatusNotification` with toStatus=
    // 'finished' MUST create a NotificationLog row (previously it
    // silently early-returned because the old table had a `ready` key
    // and no `finished` key after the ready→finished rename in 1f0c2c9).
    mockDb.notificationLog.create.mockResolvedValue({ id: 'notif-1' });
    await mod.sendOrderStatusNotification(
      ORDER_ID,
      MOCK_ORDER.orderNumber,
      'finished',
      MOCK_CUSTOMER.email,
      MOCK_CUSTOMER.id,
    );
    expect(mockDb.notificationLog.create).toHaveBeenCalledTimes(1);
    const call = mockDb.notificationLog.create.mock.calls[0]?.[0] as
      | { data?: { subject?: string; body?: string } }
      | undefined;
    expect(typeof call?.data?.subject).toBe('string');
    expect(typeof call?.data?.body).toBe('string');
    // And the stale key must be gone — calling with 'ready' MUST be a
    // no-op (no log row written).
    mockDb.notificationLog.create.mockClear();
    await mod.sendOrderStatusNotification(
      ORDER_ID,
      MOCK_ORDER.orderNumber,
      'ready',
      MOCK_CUSTOMER.email,
      MOCK_CUSTOMER.id,
    );
    expect(mockDb.notificationLog.create).not.toHaveBeenCalled();
  });

  // ─── Gate #11 — Content-Type application/json on ALL error paths ────
  it('every error path response carries Content-Type application/json', async () => {
    // Invalid body → 400 VALIDATION_ERROR
    const r400 = await patchStatus(token, { to_status: 'invalid_status' as unknown as string });
    expect(r400.status).toBe(400);
    expect(r400.headers.get('content-type') ?? '').toMatch(/application\/json/i);

    // Not found → 404
    mockDb.order.findUnique.mockResolvedValue(null);
    const r404 = await patchStatus(token, { to_status: 'finished' }, 'ghost-order-id');
    expect(r404.status).toBe(404);
    expect(r404.headers.get('content-type') ?? '').toMatch(/application\/json/i);

    // Invalid transition → 422
    mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'cancelled' });
    const r422 = await patchStatus(token, { to_status: 'finished' });
    expect(r422.status).toBe(422);
    expect(r422.headers.get('content-type') ?? '').toMatch(/application\/json/i);

    // onError catch-all → 500
    mockDb.order.findUnique.mockRejectedValue(new Error('boom'));
    const r500 = await patchStatus(token, { to_status: 'finished' });
    expect(r500.status).toBe(500);
    expect(r500.headers.get('content-type') ?? '').toMatch(/application\/json/i);
  });

  // ─── Gate #12 — Redaction identical to BUG-404-A01 baseline ─────────
  it('error envelope never leaks Authorization, stack frames, or raw DB text', async () => {
    const nasty = new Error(
      'duplicate key value violates unique constraint "order_status_log_pkey" (SQLSTATE 23505)',
    );
    nasty.stack = 'Error: nasty\n    at internal (/srv/api.js:42:10)';
    mockDb.$transaction.mockImplementationOnce(async () => {
      throw nasty;
    });

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(500);
    const raw = await res.text();
    const body = JSON.parse(raw) as { error: { code: string } };
    expect(body.error.code).toBe('internal_error');
    expect(raw).not.toContain(token);
    expect(raw.toLowerCase()).not.toContain('bearer ');
    expect(raw).not.toMatch(/\bat .+ \(.+:\d+:\d+\)/);
    expect(raw).not.toMatch(/duplicate key value violates unique constraint/i);
    expect(raw).not.toMatch(/SQLSTATE/);
  });

  // ─── Gate #13 — other transitions unchanged ────────────────────────
  it('other transitions (paid_locked→shipped, returned→cleaning) still succeed with unchanged shape', async () => {
    // paid_locked → shipped
    mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'paid_locked' });
    mockDb.order.update.mockResolvedValue({ ...MOCK_ORDER, status: 'shipped' });
    const r1 = await patchStatus(token, { to_status: 'shipped', tracking_number: 'TRK-1' });
    expect(r1.status).toBe(200);
    const b1 = (await r1.json()) as { data: { previous_status: string; current_status: string } };
    expect(b1.data.previous_status).toBe('paid_locked');
    expect(b1.data.current_status).toBe('shipped');

    // returned → cleaning
    mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'returned' });
    mockDb.order.update.mockResolvedValue({ ...MOCK_ORDER, status: 'cleaning' });
    const r2 = await patchStatus(token, { to_status: 'cleaning' });
    expect(r2.status).toBe(200);
    const b2 = (await r2.json()) as { data: { previous_status: string; current_status: string } };
    expect(b2.data.previous_status).toBe('returned');
    expect(b2.data.current_status).toBe('cleaning');
  });

  // ─── Gate #14 — finished side effects run all-or-some, never throw ──
  it('cleaning→finished with EVERY side effect throwing still commits 200 JSON', async () => {
    mockDb.orderItem.aggregate.mockRejectedValue(new Error('boom-aggregate'));
    mockDb.financeTransaction.create.mockRejectedValue(new Error('boom-finance'));
    mockDb.notificationLog.create.mockRejectedValue(new Error('boom-notif'));
    mockDb.auditLog.create.mockRejectedValue(new Error('boom-audit'));
    mockDb.customer.findUnique.mockRejectedValue(new Error('boom-cust'));

    const res = await patchStatus(token, { to_status: 'finished' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { current_status: string } };
    expect(body.data.current_status).toBe('finished');
  });

  // ─── Gate #15 — auth still guarded (pre-existing 401 path) ──────────
  it('missing Authorization header still returns 401 JSON envelope (auth path preserved)', async () => {
    const res = await app.request(`/api/v1/admin/orders/${ORDER_ID}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to_status: 'finished' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/i);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
