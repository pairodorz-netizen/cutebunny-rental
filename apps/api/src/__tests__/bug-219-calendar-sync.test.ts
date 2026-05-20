/**
 * BUG-219: Calendar availability not synced with paid orders.
 *
 * Root cause: Admin order creation (POST /api/v1/admin/orders) did not call
 * confirmHolds() after creating a paid order, so the calendar never showed
 * booked dates. Similarly, transitioning to paid_locked via PATCH .../status
 * did not sync the calendar either.
 *
 * Fix: Call confirmHolds() for each item when:
 *   1. Admin creates an order with mark_as_paid = true
 *   2. Admin transitions an order to paid_locked
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConfirmHolds = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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
    $queryRawUnsafe: vi.fn().mockResolvedValue([]),
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
      groupBy: vi.fn().mockResolvedValue([]),
    };
  }
  return db;
});

vi.mock('../lib/db', () => ({ getDb: vi.fn(() => mockDb) }));
vi.mock('../lib/availability', () => ({
  confirmHolds: mockConfirmHolds,
  createLifecycleBlocks: vi.fn().mockResolvedValue(undefined),
  releaseTentativeHolds: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../lib/notifications', () => ({ sendOrderStatusNotification: vi.fn() }));
vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(true), hash: vi.fn() },
  compare: vi.fn().mockResolvedValue(true),
  hash: vi.fn(),
}));

import app from '../index';

async function getAdminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken('00000000-0000-0000-0000-000000000099', 'admin@cutebunny.rental', 'superadmin');
}

describe('BUG-219: Calendar availability sync for admin orders', () => {
  let token: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    token = await getAdminToken();
  });

  describe('POST /api/v1/admin/orders — mark_as_paid = true', () => {
    it('should call confirmHolds for each item when creating paid order', async () => {
      const productId = '00000000-0000-0000-0000-000000000001';
      const startDate = '2026-05-19';
      const endDate = '2026-05-22';

      mockDb.customer.findFirst.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000005',
        firstName: 'Test',
        lastName: 'User',
        phone: '0899999999',
        email: 'test@test.com',
      });
      mockDb.order.findFirst.mockResolvedValue(null);
      mockDb.product.findMany.mockResolvedValue([
        { id: productId, name: 'Wedding Dress', sku: 'WED-001', rentalPrice1Day: 1500 },
      ]);
      mockDb.order.create.mockResolvedValue({
        id: 'new-order-id',
        orderNumber: 'ORD-2026001',
        customerId: '00000000-0000-0000-0000-000000000005',
        status: 'paid_locked',
        rentalStartDate: new Date(startDate),
        rentalEndDate: new Date(endDate),
        totalDays: 3,
        subtotal: 4500,
        deposit: 3000,
        deliveryFee: 100,
        totalAmount: 7600,
        createdAt: new Date(),
        items: [
          { id: 'item-1', productId, productName: 'Wedding Dress', size: 'M', quantity: 1, subtotal: 4500 },
        ],
        customer: { id: '00000000-0000-0000-0000-000000000005', firstName: 'Test', lastName: 'User', phone: '0899999999' },
      });

      const res = await app.request('/api/v1/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customer_name: 'Test User',
          customer_phone: '0899999999',
          rental_start_date: startDate,
          rental_end_date: endDate,
          items: [{ product_id: productId, size: 'M', quantity: 1, subtotal: 4500 }],
          deposit: 3000,
          delivery_fee: 100,
          mark_as_paid: true,
        }),
      });

      expect(res.status).toBe(201);
      expect(mockConfirmHolds).toHaveBeenCalledTimes(1);
      expect(mockConfirmHolds).toHaveBeenCalledWith(
        mockDb,
        productId,
        expect.any(Date),
        3,
        'new-order-id',
      );
    });

    it('should NOT call confirmHolds when mark_as_paid is false', async () => {
      const productId = '00000000-0000-0000-0000-000000000001';

      mockDb.customer.findFirst.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000005',
        firstName: 'Test',
        lastName: 'User',
        phone: '0899999999',
        email: 'test@test.com',
      });
      mockDb.order.findFirst.mockResolvedValue(null);
      mockDb.product.findMany.mockResolvedValue([
        { id: productId, name: 'Wedding Dress', sku: 'WED-001', rentalPrice1Day: 1500 },
      ]);
      mockDb.order.create.mockResolvedValue({
        id: 'new-order-id',
        orderNumber: 'ORD-2026001',
        customerId: '00000000-0000-0000-0000-000000000005',
        status: 'unpaid',
        rentalStartDate: new Date('2026-05-19'),
        rentalEndDate: new Date('2026-05-22'),
        totalDays: 3,
        subtotal: 4500,
        deposit: 3000,
        deliveryFee: 100,
        totalAmount: 7600,
        createdAt: new Date(),
        items: [
          { id: 'item-1', productId, productName: 'Wedding Dress', size: 'M', quantity: 1, subtotal: 4500 },
        ],
        customer: { id: '00000000-0000-0000-0000-000000000005', firstName: 'Test', lastName: 'User', phone: '0899999999' },
      });

      const res = await app.request('/api/v1/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customer_name: 'Test User',
          customer_phone: '0899999999',
          rental_start_date: '2026-05-19',
          rental_end_date: '2026-05-22',
          items: [{ product_id: productId, size: 'M', quantity: 1, subtotal: 4500 }],
          deposit: 3000,
          delivery_fee: 100,
          mark_as_paid: false,
        }),
      });

      expect(res.status).toBe(201);
      expect(mockConfirmHolds).not.toHaveBeenCalled();
    });

    it('should call confirmHolds for multiple items', async () => {
      const product1 = '00000000-0000-0000-0000-000000000001';
      const product2 = '00000000-0000-0000-0000-000000000002';

      mockDb.customer.findFirst.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000005',
        firstName: 'Test',
        lastName: 'User',
        phone: '0899999999',
        email: 'test@test.com',
      });
      mockDb.order.findFirst.mockResolvedValue(null);
      mockDb.product.findMany.mockResolvedValue([
        { id: product1, name: 'Wedding Dress', sku: 'WED-001', rentalPrice1Day: 1500 },
        { id: product2, name: 'Evening Gown', sku: 'EVE-001', rentalPrice1Day: 1200 },
      ]);
      mockDb.order.create.mockResolvedValue({
        id: 'new-order-id',
        orderNumber: 'ORD-2026001',
        customerId: '00000000-0000-0000-0000-000000000005',
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-19'),
        rentalEndDate: new Date('2026-05-24'),
        totalDays: 5,
        subtotal: 9000,
        deposit: 5000,
        deliveryFee: 100,
        totalAmount: 14100,
        createdAt: new Date(),
        items: [
          { id: 'item-1', productId: product1, productName: 'Wedding Dress', size: 'M', quantity: 1, subtotal: 5000 },
          { id: 'item-2', productId: product2, productName: 'Evening Gown', size: 'S', quantity: 1, subtotal: 4000 },
        ],
        customer: { id: '00000000-0000-0000-0000-000000000005', firstName: 'Test', lastName: 'User', phone: '0899999999' },
      });

      const res = await app.request('/api/v1/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customer_name: 'Test User',
          customer_phone: '0899999999',
          rental_start_date: '2026-05-19',
          rental_end_date: '2026-05-24',
          items: [
            { product_id: product1, size: 'M', quantity: 1, subtotal: 5000 },
            { product_id: product2, size: 'S', quantity: 1, subtotal: 4000 },
          ],
          deposit: 5000,
          delivery_fee: 100,
          mark_as_paid: true,
        }),
      });

      expect(res.status).toBe(201);
      expect(mockConfirmHolds).toHaveBeenCalledTimes(2);
      expect(mockConfirmHolds).toHaveBeenCalledWith(mockDb, product1, expect.any(Date), 5, 'new-order-id');
      expect(mockConfirmHolds).toHaveBeenCalledWith(mockDb, product2, expect.any(Date), 5, 'new-order-id');
    });

    it('confirmHolds failure should not break order creation', async () => {
      const productId = '00000000-0000-0000-0000-000000000001';
      mockConfirmHolds.mockRejectedValue(new Error('DB connection timeout'));

      mockDb.customer.findFirst.mockResolvedValue({
        id: '00000000-0000-0000-0000-000000000005',
        firstName: 'Test',
        lastName: 'User',
        phone: '0899999999',
        email: 'test@test.com',
      });
      mockDb.order.findFirst.mockResolvedValue(null);
      mockDb.product.findMany.mockResolvedValue([
        { id: productId, name: 'Wedding Dress', sku: 'WED-001', rentalPrice1Day: 1500 },
      ]);
      mockDb.order.create.mockResolvedValue({
        id: 'new-order-id',
        orderNumber: 'ORD-2026001',
        customerId: '00000000-0000-0000-0000-000000000005',
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-19'),
        rentalEndDate: new Date('2026-05-22'),
        totalDays: 3,
        subtotal: 4500,
        deposit: 3000,
        deliveryFee: 100,
        totalAmount: 7600,
        createdAt: new Date(),
        items: [
          { id: 'item-1', productId, productName: 'Wedding Dress', size: 'M', quantity: 1, subtotal: 4500 },
        ],
        customer: { id: '00000000-0000-0000-0000-000000000005', firstName: 'Test', lastName: 'User', phone: '0899999999' },
      });

      const res = await app.request('/api/v1/admin/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          customer_name: 'Test User',
          customer_phone: '0899999999',
          rental_start_date: '2026-05-19',
          rental_end_date: '2026-05-22',
          items: [{ product_id: productId, size: 'M', quantity: 1, subtotal: 4500 }],
          deposit: 3000,
          delivery_fee: 100,
          mark_as_paid: true,
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('PATCH /api/v1/admin/orders/:id/status — transition to paid_locked', () => {
    it('should call confirmHolds when transitioning from unpaid to paid_locked', async () => {
      const orderId = '00000000-0000-0000-0000-000000000006';
      const productId = '00000000-0000-0000-0000-000000000001';
      const startDate = new Date('2026-05-19');
      const endDate = new Date('2026-05-22');

      mockDb.order.findUnique.mockResolvedValue({
        id: orderId,
        orderNumber: 'ORD-2026002',
        customerId: '00000000-0000-0000-0000-000000000005',
        status: 'unpaid',
        rentalStartDate: startDate,
        rentalEndDate: endDate,
        totalDays: 3,
        subtotal: 4500,
        deposit: 3000,
        deliveryFee: 100,
        discount: 0,
        creditApplied: 0,
        totalAmount: 7600,
        lateFee: 0,
        damageFee: 0,
        shippingSnapshot: null,
      });
      mockDb.$transaction.mockResolvedValue([
        { id: orderId, orderNumber: 'ORD-2026002', status: 'paid_locked', lateFee: 0, damageFee: 0, totalAmount: 7600 },
        { id: 'log-id' },
      ]);
      mockDb.orderItem.findMany.mockResolvedValue([
        { id: 'item-1', productId, productName: 'Wedding Dress', size: 'M', quantity: 1 },
      ]);

      const res = await app.request(`/api/v1/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to_status: 'paid_locked' }),
      });

      expect(res.status).toBe(200);
      expect(mockConfirmHolds).toHaveBeenCalledTimes(1);
      expect(mockConfirmHolds).toHaveBeenCalledWith(
        mockDb,
        productId,
        startDate,
        3,
        orderId,
      );
    });

    it('should NOT call confirmHolds when transitioning to other statuses', async () => {
      const orderId = '00000000-0000-0000-0000-000000000006';

      mockDb.order.findUnique.mockResolvedValue({
        id: orderId,
        orderNumber: 'ORD-2026002',
        customerId: '00000000-0000-0000-0000-000000000005',
        status: 'paid_locked',
        rentalStartDate: new Date('2026-05-19'),
        rentalEndDate: new Date('2026-05-22'),
        totalDays: 3,
        subtotal: 4500,
        deposit: 3000,
        deliveryFee: 100,
        discount: 0,
        creditApplied: 0,
        totalAmount: 7600,
        lateFee: 0,
        damageFee: 0,
        shippingSnapshot: null,
      });
      mockDb.$transaction.mockResolvedValue([
        { id: orderId, orderNumber: 'ORD-2026002', status: 'shipped', lateFee: 0, damageFee: 0, totalAmount: 7600 },
        { id: 'log-id' },
      ]);

      const res = await app.request(`/api/v1/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ to_status: 'shipped' }),
      });

      expect(res.status).toBe(200);
      expect(mockConfirmHolds).not.toHaveBeenCalled();
    });
  });
});
