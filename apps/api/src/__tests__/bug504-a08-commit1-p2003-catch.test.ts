/**
 * BUG-504-A08 commit 1 — layer-2 P2003 catch on
 * `DELETE /api/v1/admin/categories/:id`.
 *
 * Pinned by the live A07 capture: the layer-1 pre-check (BUG-504-
 * RC2 + BUG-505-A01) ran `db.product.count({ where: { categoryId:
 * id, deletedAt: null } })` and cleared tombstones via `$executeRaw
 * UPDATE products SET category_id=NULL WHERE …`. In prod we observed
 * the count returning 0 yet `db.category.delete` still throwing
 * `PrismaClientKnownRequestError` with code `P2003` on
 * `products_category_id_fkey` (Cloudflare ray 9f250bf8fe01e395 +
 * reproducer 2026-04-26 ~20:28 GMT+9). A08-commit2 widens the pre-
 * check to count tombstones too, but this layer-2 catch remains as
 * defense-in-depth for any P2003 that still reaches storage (e.g.
 * race between count and delete, or a future regression of the
 * pre-check predicate).
 *
 * Gate (single):
 *   When `db.category.delete` throws an error whose `code` field
 *   is the string `"P2003"`, the handler must respond with HTTP
 *   409 carrying the JSON envelope
 *   `{ error: { code: "IN_USE", message, details: { slug } } }`
 *   — the same shape the layer-1 pre-check emits — instead of the
 *   redacted 500 `internal_error` envelope from `onError`. The
 *   `formatCategoryError` helper on the admin frontend already
 *   matches `code === 'IN_USE'` to render the localized
 *   `categoryErrorInUse` toast, so the user-facing UX is
 *   identical whether layer-1 or layer-2 fires.
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
const CATEGORY_UUID = '465492c0-804a-4929-bc8e-0612c81dea17';
const CATEGORY_SLUG = 'casual';

async function superadminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'admin@cutebunny.rental', 'superadmin');
}

describe('BUG-504-A08-commit1 — admin DELETE /categories/:id translates P2003 to 409 IN_USE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Layer-1 pre-check fires `findUnique` to confirm the category
    // exists, then `count` on products. Mimic the in-prod state we
    // captured: row exists, count says 0 (so the 409 IN_USE
    // pre-check is bypassed), and the FK enforcer at the storage
    // layer is the one that fails the delete.
    mockDb.category.findUnique = vi.fn().mockResolvedValue({
      id: CATEGORY_UUID,
      slug: CATEGORY_SLUG,
      nameTh: 'ลำลอง',
      nameEn: 'Casual',
      sortOrder: 3,
      visibleFrontend: true,
      visibleBackend: true,
    });
    mockDb.product.count = vi.fn().mockResolvedValue(0);
    mockDb.$executeRaw = vi.fn().mockResolvedValue(0);

    // The actual symptom: db.category.delete throws a Prisma-shaped
    // P2003 error. Use a plain Error with `code` set so the duck-
    // typed check in the handler exercises the catch branch.
    const thrown: Error & { code?: string; meta?: unknown } = Object.assign(
      new Error(
        'Invalid `prisma.category.delete()` invocation: Foreign key constraint violated: `products_category_id_fkey (index)`',
      ),
      {
        code: 'P2003',
        name: 'PrismaClientKnownRequestError',
        meta: { field_name: 'products_category_id_fkey (index)' },
      },
    );
    mockDb.category.delete = vi.fn().mockRejectedValue(thrown);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 409 IN_USE with the slug detail when db.category.delete throws P2003', async () => {
    const token = await superadminToken();
    const res = await app.request(`/api/v1/admin/categories/${CATEGORY_UUID}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
        'cf-ray': 'test-ray-a08-commit1',
      },
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as {
      error?: { code?: string; message?: string; details?: { slug?: string } };
    };
    expect(body.error?.code).toBe('IN_USE');
    expect(body.error?.message).toContain(CATEGORY_SLUG);
    expect(body.error?.details?.slug).toBe(CATEGORY_SLUG);
    // Sanity: the 500 envelope from `onError` must NOT be present.
    expect(body.error?.code).not.toBe('internal_error');
  });

  it('still propagates non-P2003 errors to the onError 500 envelope', async () => {
    // Non-FK throw must NOT be silently translated. Replace the
    // P2003 throw set up in beforeEach with a generic error.
    const generic = Object.assign(new Error('boom'), {
      code: 'P2010',
      name: 'PrismaClientKnownRequestError',
    });
    mockDb.category.delete = vi.fn().mockRejectedValue(generic);

    const token = await superadminToken();
    const res = await app.request(`/api/v1/admin/categories/${CATEGORY_UUID}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}`, 'cf-ray': 'test-ray-a08-fallthrough' },
    });

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe('internal_error');
  });
});
