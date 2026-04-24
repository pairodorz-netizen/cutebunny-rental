/**
 * BUG-CAL-05 — PATCH /api/v1/admin/calendar/cell integration tests.
 *
 * Scope:
 *   • Auth gates (401 / 403)
 *   • Body validation (zod)
 *   • State-machine enforcement (CONFIRM_REQUIRED, noop)
 *   • Update-or-create on AvailabilityCalendar
 *   • Audit log written with from/to state + resource id
 *
 * Uses the same mocked-Prisma pattern as bug504-admin-categories-route.
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
const PRODUCT_UUID = '11111111-1111-1111-1111-111111111111';
const SLOT_UUID = '22222222-2222-2222-2222-222222222222';

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

function patch(body: unknown, token?: string) {
  return app.request('/api/v1/admin/calendar/cell', {
    method: 'PATCH',
    headers: jsonHeaders(token),
    body: JSON.stringify(body),
  });
}

describe('BUG-CAL-05 — PATCH /admin/calendar/cell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.availabilityCalendar.findFirst.mockResolvedValue(null);
    mockDb.availabilityCalendar.create.mockResolvedValue({ id: SLOT_UUID });
    mockDb.availabilityCalendar.update.mockResolvedValue({ id: SLOT_UUID });
    mockDb.auditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('401 without Authorization header', async () => {
    const res = await patch({
      product_id: PRODUCT_UUID,
      date: '2026-04-20',
      unit_index: 1,
      new_state: 'booked',
    });
    expect(res.status).toBe(401);
  });

  it('200 on staff token (staff+ can edit)', async () => {
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 1, new_state: 'booked' },
      token,
    );
    expect(res.status).toBe(200);
  });

  it('200 on superadmin token', async () => {
    const token = await superadminToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 1, new_state: 'booked' },
      token,
    );
    expect(res.status).toBe(200);
  });

  it('400 VALIDATION_ERROR on bad date format', async () => {
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '20-04-2026', unit_index: 1, new_state: 'booked' },
      token,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 VALIDATION_ERROR on unknown state', async () => {
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 1, new_state: 'on-fire' },
      token,
    );
    expect(res.status).toBe(400);
  });

  it('400 VALIDATION_ERROR on missing unit_index (must be explicit null)', async () => {
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', new_state: 'booked' },
      token,
    );
    expect(res.status).toBe(400);
  });

  it('writes slotStatus via update when a row already exists', async () => {
    mockDb.availabilityCalendar.findFirst.mockResolvedValue({
      id: SLOT_UUID,
      slotStatus: 'available',
    });
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 1, new_state: 'booked' },
      token,
    );
    expect(res.status).toBe(200);
    expect(mockDb.availabilityCalendar.update).toHaveBeenCalledTimes(1);
    expect(mockDb.availabilityCalendar.update).toHaveBeenCalledWith({
      where: { id: SLOT_UUID },
      data: { slotStatus: 'booked' },
    });
    expect(mockDb.availabilityCalendar.create).not.toHaveBeenCalled();
  });

  it('creates slot when none exists (from=available implied)', async () => {
    mockDb.availabilityCalendar.findFirst.mockResolvedValue(null);
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 2, new_state: 'shipping' },
      token,
    );
    expect(res.status).toBe(200);
    expect(mockDb.availabilityCalendar.create).toHaveBeenCalledTimes(1);
    const arg = mockDb.availabilityCalendar.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({
      productId: PRODUCT_UUID,
      slotStatus: 'shipping',
      unitIndex: 2,
    });
  });

  it('200 noop when from === to (no update, no audit)', async () => {
    mockDb.availabilityCalendar.findFirst.mockResolvedValue({
      id: SLOT_UUID,
      slotStatus: 'booked',
    });
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 1, new_state: 'booked' },
      token,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.noop).toBe(true);
    expect(mockDb.availabilityCalendar.update).not.toHaveBeenCalled();
    expect(mockDb.availabilityCalendar.create).not.toHaveBeenCalled();
    expect(mockDb.auditLog.create).not.toHaveBeenCalled();
  });

  it('409 CONFIRM_REQUIRED on booked → available without confirmed: true', async () => {
    mockDb.availabilityCalendar.findFirst.mockResolvedValue({
      id: SLOT_UUID,
      slotStatus: 'booked',
    });
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 1, new_state: 'available' },
      token,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFIRM_REQUIRED');
    // Must NOT have mutated the slot.
    expect(mockDb.availabilityCalendar.update).not.toHaveBeenCalled();
  });

  it('200 on booked → available when confirmed: true', async () => {
    mockDb.availabilityCalendar.findFirst.mockResolvedValue({
      id: SLOT_UUID,
      slotStatus: 'booked',
    });
    const token = await staffToken();
    const res = await patch(
      {
        product_id: PRODUCT_UUID,
        date: '2026-04-20',
        unit_index: 1,
        new_state: 'available',
        confirmed: true,
      },
      token,
    );
    expect(res.status).toBe(200);
    expect(mockDb.availabilityCalendar.update).toHaveBeenCalledTimes(1);
  });

  it('409 CONFIRM_REQUIRED for any non-available → available', async () => {
    const token = await staffToken();
    for (const from of ['cleaning', 'blocked_repair', 'tentative', 'shipping', 'washing', 'late_return']) {
      mockDb.availabilityCalendar.findFirst.mockResolvedValueOnce({
        id: SLOT_UUID,
        slotStatus: from,
      });
      const res = await patch(
        { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 1, new_state: 'available' },
        token,
      );
      expect(res.status, `${from} → available`).toBe(409);
    }
  });

  it('writes audit log row with from/to state + resource id', async () => {
    mockDb.availabilityCalendar.findFirst.mockResolvedValue({
      id: SLOT_UUID,
      slotStatus: 'available',
    });
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 3, new_state: 'cleaning' },
      token,
    );
    expect(res.status).toBe(200);
    expect(mockDb.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArg = mockDb.auditLog.create.mock.calls[0][0];
    expect(auditArg.data).toMatchObject({
      adminId: ADMIN_UUID,
      action: 'UPDATE',
      resource: 'availability_calendar',
      resourceId: SLOT_UUID,
      details: {
        product_id: PRODUCT_UUID,
        date: '2026-04-20',
        unit_index: 3,
        from_state: 'available',
        to_state: 'cleaning',
      },
    });
  });

  it('accepts unit_index: null (legacy aggregate row)', async () => {
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: null, new_state: 'tentative' },
      token,
    );
    expect(res.status).toBe(200);
    const whereArg = mockDb.availabilityCalendar.findFirst.mock.calls[0][0];
    expect(whereArg.where).toMatchObject({ unitIndex: null });
  });

  it('returns { from, to, noop: false } on a real transition', async () => {
    mockDb.availabilityCalendar.findFirst.mockResolvedValue({
      id: SLOT_UUID,
      slotStatus: 'tentative',
    });
    const token = await staffToken();
    const res = await patch(
      { product_id: PRODUCT_UUID, date: '2026-04-20', unit_index: 1, new_state: 'booked' },
      token,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ from: 'tentative', to: 'booked', noop: false });
  });
});
