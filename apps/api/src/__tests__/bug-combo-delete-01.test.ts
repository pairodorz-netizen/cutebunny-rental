/**
 * BUG-COMBO-DELETE-01 — DELETE /api/v1/admin/combo-sets/:id hardening.
 *
 * Scope:
 *   • 200 hard-delete when rentalCount === 0 (ComboSetItem cascades via Prisma)
 *   • 409 CONFLICT when rentalCount > 0 (no state change, preserves items)
 *   • 404 NOT_FOUND on missing id
 *   • Audit log row written with resource='combo_set', action='DELETE',
 *     resourceId, and details.mode='hard' on successful hard-delete
 *
 * Reuses the mocked-Prisma pattern from bug-cal-05-patch-cell.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const models = [
    'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
    'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
    'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
    'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
    'auditLog', 'inventoryUnit', 'comboSet', 'comboSetItem', 'productStockLog',
    'financeCategory', 'systemConfig', 'notificationLog', 'category',
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
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
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
const COMBO_UUID = '33333333-3333-3333-3333-333333333333';
const MISSING_UUID = '99999999-9999-9999-9999-999999999999';

async function staffToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken(ADMIN_UUID, 'staff@cutebunny.rental', 'staff');
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

function del(id: string, token: string) {
  return app.request(`/api/v1/admin/combo-sets/${id}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
}

const comboFixture = (overrides: Record<string, unknown> = {}) => ({
  id: COMBO_UUID,
  sku: 'C001',
  name: 'Envelope Tank & Milk Skirt Set',
  description: null,
  brandId: null,
  color: [],
  size: [],
  thumbnailUrl: null,
  rentalPrice1Day: 500,
  rentalPrice3Day: 1000,
  rentalPrice5Day: 1400,
  variableCost: 0,
  extraDayRate: 0,
  available: true,
  orphaned: false,
  rentalCount: 0,
  createdAt: new Date('2026-04-01T00:00:00Z'),
  updatedAt: new Date('2026-04-01T00:00:00Z'),
  ...overrides,
});

describe('BUG-COMBO-DELETE-01 — DELETE /admin/combo-sets/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.comboSet.findUnique.mockResolvedValue(null);
    mockDb.comboSet.delete.mockResolvedValue({ id: COMBO_UUID });
    mockDb.comboSetItem.deleteMany.mockResolvedValue({ count: 0 });
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  describe('404 — missing combo set', () => {
    it('returns 404 NOT_FOUND when combo set does not exist', async () => {
      const token = await staffToken();
      mockDb.comboSet.findUnique.mockResolvedValue(null);

      const res = await del(MISSING_UUID, token);

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBe('NOT_FOUND');
    });

    it('does NOT write audit log on 404', async () => {
      const token = await staffToken();
      mockDb.comboSet.findUnique.mockResolvedValue(null);

      await del(MISSING_UUID, token);

      expect(mockDb.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('409 — active rentals conflict', () => {
    it('returns 409 when rentalCount > 0', async () => {
      const token = await staffToken();
      mockDb.comboSet.findUnique.mockResolvedValue(
        comboFixture({ rentalCount: 2 }),
      );

      const res = await del(COMBO_UUID, token);

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error?: { code?: string; message?: string } };
      expect(body.error?.code).toBe('ACTIVE_RENTALS');
      expect(body.error?.message).toMatch(/rental/i);
    });

    it('does NOT call comboSet.delete when rentalCount > 0', async () => {
      const token = await staffToken();
      mockDb.comboSet.findUnique.mockResolvedValue(
        comboFixture({ rentalCount: 1 }),
      );

      await del(COMBO_UUID, token);

      expect(mockDb.comboSet.delete).not.toHaveBeenCalled();
      expect(mockDb.comboSetItem.deleteMany).not.toHaveBeenCalled();
    });

    it('does NOT write audit log on 409', async () => {
      const token = await staffToken();
      mockDb.comboSet.findUnique.mockResolvedValue(
        comboFixture({ rentalCount: 5 }),
      );

      await del(COMBO_UUID, token);

      expect(mockDb.auditLog.create).not.toHaveBeenCalled();
    });
  });

  describe('200 — hard delete (rentalCount === 0)', () => {
    it('returns 200 with { deleted: true, id, mode: "hard" }', async () => {
      const token = await staffToken();
      mockDb.comboSet.findUnique.mockResolvedValue(
        comboFixture({ rentalCount: 0 }),
      );

      const res = await del(COMBO_UUID, token);

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data?: { deleted?: boolean; id?: string; mode?: string };
      };
      expect(body.data?.deleted).toBe(true);
      expect(body.data?.id).toBe(COMBO_UUID);
      expect(body.data?.mode).toBe('hard');
    });

    it('calls comboSet.delete with the correct id', async () => {
      const token = await staffToken();
      mockDb.comboSet.findUnique.mockResolvedValue(
        comboFixture({ rentalCount: 0 }),
      );

      await del(COMBO_UUID, token);

      expect(mockDb.comboSet.delete).toHaveBeenCalledTimes(1);
      expect(mockDb.comboSet.delete).toHaveBeenCalledWith({
        where: { id: COMBO_UUID },
      });
    });
  });

  describe('audit log — hard delete path', () => {
    it('writes audit row with action=DELETE, resource=combo_set, resourceId, details.mode=hard', async () => {
      const token = await staffToken();
      mockDb.comboSet.findUnique.mockResolvedValue(
        comboFixture({ rentalCount: 0, sku: 'C001', name: 'Envelope Tank & Milk Skirt Set' }),
      );

      await del(COMBO_UUID, token);

      expect(mockDb.auditLog.create).toHaveBeenCalledTimes(1);
      const call = mockDb.auditLog.create.mock.calls[0][0] as {
        data: {
          action: string;
          resource: string;
          resourceId: string;
          adminId: string;
          details: Record<string, unknown>;
        };
      };
      expect(call.data.action).toBe('DELETE');
      expect(call.data.resource).toBe('combo_set');
      expect(call.data.resourceId).toBe(COMBO_UUID);
      expect(call.data.adminId).toBe(ADMIN_UUID);
      expect(call.data.details).toMatchObject({
        sku: 'C001',
        name: 'Envelope Tank & Milk Skirt Set',
        mode: 'hard',
      });
    });
  });

  describe('auth gates', () => {
    it('returns 401 without Authorization header', async () => {
      const res = await app.request(`/api/v1/admin/combo-sets/${COMBO_UUID}`, {
        method: 'DELETE',
      });
      expect(res.status).toBe(401);
    });
  });
});
