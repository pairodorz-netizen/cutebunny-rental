/**
 * BUG-504-A07 — observability gate.
 *
 * Pinned by live incident 2026-04-26 19:53 GMT+9 (Cloudflare ray
 * 9f250bf8fe01e395): three consecutive 500s on
 * `DELETE /api/v1/admin/categories/:id` returned the redacted
 * "Unexpected server error" envelope, but the Workers Logs ray JSON
 * had `exception:{}` and `logs:{}` — i.e. zero structured signal
 * about what threw. The catch-all `onError` returned the wire
 * envelope without emitting any `console.error` line.
 *
 * Promotes §8.1 BUG-UX-TRANSIENT-5XX to a confirmed regression
 * (2/2 occurrences inside the watch window expiring 2026-05-03).
 *
 * Gate (single):
 *   When a route handler under `adminCategories` throws, the global
 *   `onError` handler must:
 *     (1) emit ONE `console.error` line tagged `[admin-categories]`
 *         carrying a JSON payload with at least the keys
 *         `err_message`, `err_name`, `err_code`, `err_stack`,
 *         `categoryId`, `userId`, `requestId`;
 *     (2) preserve the existing wire contract — HTTP 500 with the
 *         redacted `{ error: { code: 'internal_error', ... } }`
 *         envelope (byte-for-byte unchanged).
 *
 * Speculative root-cause fixes (`$executeRaw` UUID cast, P2003 → 409
 * race translation) are explicitly DEFERRED to A07-commit2, gated by
 * a live capture of the new structured log against a reproducer.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
      delete: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      upsert: vi.fn().mockResolvedValue({ id: 'mock-id' }),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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
const CATEGORY_UUID = '11111111-1111-1111-1111-111111111111';

async function superadminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'superadmin');
}

describe('BUG-504-A07 — admin categories onError emits structured log', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let consoleErrorSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Force the DELETE handler's first DB call to throw so we hit
    // `onError`. Mimic the shape of a Prisma known-request error so
    // the `err_code` capture branch is exercised.
    const thrown: Error & { code?: string } = Object.assign(
      new Error('forced throw for observability test'),
      { code: 'P2003', name: 'PrismaClientKnownRequestError' },
    );
    mockDb.category.findUnique = vi.fn().mockRejectedValue(thrown);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('catch path emits a single tagged console.error line with the documented JSON payload, and preserves the 500 envelope', async () => {
    const token = await superadminToken();
    const res = await app.request(`/api/v1/admin/categories/${CATEGORY_UUID}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        // Cloudflare ray header — captured into the structured payload.
        'cf-ray': 'test-ray-deadbeef',
      },
    });

    // Wire contract preserved (byte-for-byte) — redacted envelope.
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string; message?: string } };
    expect(body.error?.code).toBe('internal_error');
    expect(body.error?.message).toBe('Unexpected server error');

    // Exactly one `[admin-categories]` console.error line emitted from
    // the catch-all (other test files may have their own logging; we
    // filter to our tag to keep the assertion tight).
    const taggedCalls = (consoleErrorSpy.mock.calls as unknown[][]).filter(
      (c: unknown[]) => c[0] === '[admin-categories]',
    );
    expect(taggedCalls.length).toBe(1);

    const [, payloadJson] = taggedCalls[0] as [string, string];
    expect(typeof payloadJson).toBe('string');
    const payload = JSON.parse(payloadJson) as Record<string, unknown>;

    // Required keys present.
    for (const key of [
      'err_message',
      'err_name',
      'err_code',
      'err_stack',
      'categoryId',
      'userId',
      'requestId',
    ]) {
      expect(payload, `payload missing key "${key}"`).toHaveProperty(key);
    }

    // Identity fields populated from the forced throw.
    expect(payload.err_message).toBe('forced throw for observability test');
    expect(payload.err_name).toBe('PrismaClientKnownRequestError');
    expect(payload.err_code).toBe('P2003');
    expect(typeof payload.err_stack).toBe('string');
    // Stack is truncated to 5 frames joined by " | ".
    expect((payload.err_stack as string).split(' | ').length).toBeLessThanOrEqual(5);

    // Request-scope identifiers captured.
    expect(payload.categoryId).toBe(CATEGORY_UUID);
    expect(payload.userId).toBe(ADMIN_UUID);
    expect(payload.requestId).toBe('test-ray-deadbeef');
  });
});
