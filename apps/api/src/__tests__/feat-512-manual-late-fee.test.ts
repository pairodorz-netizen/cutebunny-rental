/**
 * FEAT-512 — Manual Late Fee / Damage Fee entry on final status change.
 *
 * Tests:
 *   1. Status transition to 'returned' with late_fee + damage_fee persists on order
 *   2. Status transition to 'finished' with late_fee + damage_fee persists on order
 *   3. Status transition WITHOUT fees defaults to 0
 *   4. Total recomputes: subtotal + deposit + deliveryFee + lateFee + damageFee - discount - creditApplied
 *   5. Audit log captures entered fees (including 0)
 *   6. Finance transactions created for non-zero fees
 *   7. Non-final status transitions ignore late_fee/damage_fee
 *   8. paid_locked semantics preserved (fees don't unlock paid)
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
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}

async function patchStatus(token: string, body: Record<string, unknown>): Promise<Response> {
  return app.request(`/api/v1/admin/orders/${ORDER_ID}/status`, {
    method: 'PATCH',
    headers: authHeaders(token),
    body: JSON.stringify(body),
  });
}

describe('FEAT-512: Manual Late Fee / Damage Fee on status change', () => {
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    token = await getAdminToken();
    mockDb.$transaction.mockImplementation(async (ops: unknown) => {
      if (typeof ops === 'function') return (ops as (tx: unknown) => unknown)(mockDb);
      if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[]);
      return [];
    });
    mockDb.customer.findUnique.mockResolvedValue(MOCK_CUSTOMER);
  });

  it('persists late_fee + damage_fee when transitioning to returned', async () => {
    const orderShipped = { ...MOCK_ORDER, status: 'shipped', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderShipped);
    mockDb.order.update.mockResolvedValue({ ...orderShipped, status: 'returned', lateFee: 500, damageFee: 200, totalAmount: 7300 });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-1' });

    const res = await patchStatus(token, { to_status: 'returned', late_fee: 500, damage_fee: 200 });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.late_fee).toBe(500);
    expect(json.data.damage_fee).toBe(200);

    // Verify order.update was called with fee data
    const updateCall = mockDb.order.update.mock.calls[0][0];
    expect(updateCall.data.lateFee).toBe(500);
    expect(updateCall.data.damageFee).toBe(200);
    // totalAmount = 3500 + 3000 + 100 + 500 + 200 - 0 - 0 = 7300
    expect(updateCall.data.totalAmount).toBe(7300);
  });

  it('persists late_fee + damage_fee when transitioning to finished', async () => {
    const orderCleaning = { ...MOCK_ORDER, status: 'cleaning', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderCleaning);
    mockDb.order.update.mockResolvedValue({ ...orderCleaning, status: 'finished', lateFee: 1000, damageFee: 500, totalAmount: 8100 });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-2' });

    const res = await patchStatus(token, { to_status: 'finished', late_fee: 1000, damage_fee: 500, fee_note: 'Returned 3 days late with stain' });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.late_fee).toBe(1000);
    expect(json.data.damage_fee).toBe(500);

    const updateCall = mockDb.order.update.mock.calls[0][0];
    expect(updateCall.data.lateFee).toBe(1000);
    expect(updateCall.data.damageFee).toBe(500);
    // totalAmount = 3500 + 3000 + 100 + 1000 + 500 - 0 - 0 = 8100
    expect(updateCall.data.totalAmount).toBe(8100);
  });

  it('defaults to 0 when no fees provided on final status', async () => {
    const orderShipped = { ...MOCK_ORDER, status: 'shipped', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderShipped);
    mockDb.order.update.mockResolvedValue({ ...orderShipped, status: 'returned', lateFee: 0, damageFee: 0 });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-3' });

    const res = await patchStatus(token, { to_status: 'returned' });
    expect(res.status).toBe(200);

    const updateCall = mockDb.order.update.mock.calls[0][0];
    expect(updateCall.data.lateFee).toBe(0);
    expect(updateCall.data.damageFee).toBe(0);
    // totalAmount = 3500 + 3000 + 100 + 0 + 0 - 0 - 0 = 6600
    expect(updateCall.data.totalAmount).toBe(6600);
  });

  it('correctly recomputes total with discount + creditApplied', async () => {
    const orderWithDiscount = { ...MOCK_ORDER, status: 'shipped', lateFee: 0, damageFee: 0, discount: 500, creditApplied: 200 };
    mockDb.order.findUnique.mockResolvedValue(orderWithDiscount);
    mockDb.order.update.mockResolvedValue({ ...orderWithDiscount, status: 'returned', lateFee: 300, damageFee: 100 });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-4' });

    const res = await patchStatus(token, { to_status: 'returned', late_fee: 300, damage_fee: 100 });
    expect(res.status).toBe(200);

    const updateCall = mockDb.order.update.mock.calls[0][0];
    // totalAmount = 3500 + 3000 + 100 + 300 + 100 - 500 - 200 = 6300
    expect(updateCall.data.totalAmount).toBe(6300);
  });

  it('records fees in audit log (including 0)', async () => {
    const orderShipped = { ...MOCK_ORDER, status: 'shipped', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderShipped);
    mockDb.order.update.mockResolvedValue({ ...orderShipped, status: 'returned', lateFee: 0, damageFee: 0 });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-5' });

    await patchStatus(token, { to_status: 'returned' });

    // Find the auditLog.create call
    const auditCalls = mockDb.auditLog.create.mock.calls;
    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    const auditDetails = auditCalls[0][0].data.details;
    expect(auditDetails.late_fee).toBe(0);
    expect(auditDetails.damage_fee).toBe(0);
  });

  it('creates finance transactions for non-zero fees', async () => {
    const orderCleaning = { ...MOCK_ORDER, status: 'cleaning', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderCleaning);
    mockDb.order.update.mockResolvedValue({ ...orderCleaning, status: 'finished', lateFee: 600, damageFee: 400 });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-6' });

    await patchStatus(token, { to_status: 'finished', late_fee: 600, damage_fee: 400 });

    const ftCalls = mockDb.financeTransaction.create.mock.calls;
    const txTypes = ftCalls.map((c: unknown[]) => (c[0] as { data: { txType: string } }).data.txType);
    expect(txTypes).toContain('late_fee');
    expect(txTypes).toContain('damage_fee');

    const lateFtx = ftCalls.find((c: unknown[]) => (c[0] as { data: { txType: string } }).data.txType === 'late_fee');
    expect((lateFtx![0] as { data: { amount: number } }).data.amount).toBe(600);
    const damageFtx = ftCalls.find((c: unknown[]) => (c[0] as { data: { txType: string } }).data.txType === 'damage_fee');
    expect((damageFtx![0] as { data: { amount: number } }).data.amount).toBe(400);
  });

  it('does NOT create fee finance transactions when fees are 0', async () => {
    const orderCleaning = { ...MOCK_ORDER, status: 'cleaning', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderCleaning);
    mockDb.order.update.mockResolvedValue({ ...orderCleaning, status: 'finished', lateFee: 0, damageFee: 0 });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-7' });

    await patchStatus(token, { to_status: 'finished' });

    const ftCalls = mockDb.financeTransaction.create.mock.calls;
    const txTypes = ftCalls.map((c: unknown[]) => (c[0] as { data: { txType: string } }).data.txType);
    expect(txTypes).not.toContain('late_fee');
    expect(txTypes).not.toContain('damage_fee');
  });

  it('ignores late_fee/damage_fee on non-final status transitions', async () => {
    const orderPaid = { ...MOCK_ORDER, status: 'paid_locked', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderPaid);
    mockDb.order.update.mockResolvedValue({ ...orderPaid, status: 'shipped', lateFee: 0, damageFee: 0 });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-8' });

    const res = await patchStatus(token, { to_status: 'shipped', late_fee: 999, damage_fee: 888 });
    expect(res.status).toBe(200);

    const updateCall = mockDb.order.update.mock.calls[0][0];
    // Non-final: should NOT have lateFee/damageFee in update data
    expect(updateCall.data.lateFee).toBeUndefined();
    expect(updateCall.data.damageFee).toBeUndefined();
    expect(updateCall.data.totalAmount).toBeUndefined();
  });

  it('preserves paid_locked semantics — fees do not change paid status', async () => {
    // An order in paid_locked can only go to shipped (forward)
    // Fees should not unlock or change the paid status
    const orderPaid = { ...MOCK_ORDER, status: 'paid_locked', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderPaid);
    mockDb.order.update.mockResolvedValue({ ...orderPaid, status: 'shipped' });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-9' });

    const res = await patchStatus(token, { to_status: 'shipped' });
    expect(res.status).toBe(200);

    // Verify status changed but paid_locked was properly transitioned
    const json = await res.json();
    expect(json.data.current_status).toBe('shipped');
    expect(json.data.previous_status).toBe('paid_locked');
  });

  it('includes fee_note in audit log when provided', async () => {
    const orderShipped = { ...MOCK_ORDER, status: 'shipped', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderShipped);
    mockDb.order.update.mockResolvedValue({ ...orderShipped, status: 'returned', lateFee: 500, damageFee: 0 });
    mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-10' });

    await patchStatus(token, { to_status: 'returned', late_fee: 500, fee_note: 'Returned 2 days late' });

    const auditCalls = mockDb.auditLog.create.mock.calls;
    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    const auditDetails = auditCalls[0][0].data.details;
    expect(auditDetails.fee_note).toBe('Returned 2 days late');
  });

  it('validates late_fee must be non-negative integer', async () => {
    const orderShipped = { ...MOCK_ORDER, status: 'shipped', lateFee: 0, damageFee: 0 };
    mockDb.order.findUnique.mockResolvedValue(orderShipped);

    const res = await patchStatus(token, { to_status: 'returned', late_fee: -100 });
    expect(res.status).toBe(400);
  });
});
