/**
 * T03: Admin Happy Path E2E
 * Login → view dashboard → verify slip → change order status
 * (unpaid→paid_locked→shipped→returned→cleaning→ready) → after-sales events
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock DB with vi.hoisted (runs before vi.mock factory)
const mockDb = vi.hoisted(() => {
  const models = [
    'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
    'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
    'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
    'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
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
}));

vi.mock('bcryptjs', () => ({
  default: { compare: vi.fn().mockResolvedValue(false), hash: vi.fn() },
  compare: vi.fn().mockResolvedValue(false),
  hash: vi.fn(),
}));

import app from '../index';
import { MOCK_ADMIN, MOCK_ORDER, MOCK_PAYMENT_SLIP, MOCK_PRODUCT, MOCK_CUSTOMER } from './helpers/mock-db';

async function getAdminToken(): Promise<string> {
  const { createToken } = await import('../middleware/auth');
  return createToken('00000000-0000-0000-0000-000000000099', 'admin@cutebunny.rental', 'superadmin');
}

function authHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

describe('T03: Admin Happy Path E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Step 1: Login ────────────────────────────────────────────────
  describe('Step 1: Admin login', () => {
    it('returns 401 for invalid credentials', async () => {
      mockDb.adminUser.findUnique.mockResolvedValue(null);

      const res = await app.request('/api/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'wrong@test.com', password: 'wrong' }),
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('returns 400 for missing email/password', async () => {
      const res = await app.request('/api/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('returns token on successful login', async () => {
      const bcrypt = await import('bcryptjs');
      (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValue(true);
      mockDb.adminUser.findUnique.mockResolvedValue(MOCK_ADMIN);
      mockDb.adminUser.update.mockResolvedValue(MOCK_ADMIN);

      const res = await app.request('/api/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@cutebunny.rental', password: 'admin123' }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveProperty('access_token');
      expect(body.data).toHaveProperty('token_type', 'Bearer');
      expect(body.data).toHaveProperty('expires_in');
      expect(body.data).toHaveProperty('admin');
      expect(body.data.admin).toHaveProperty('id', '00000000-0000-0000-0000-000000000099');
      expect(body.data.admin).toHaveProperty('email', MOCK_ADMIN.email);
      expect(body.data.admin).toHaveProperty('name', MOCK_ADMIN.name);
      expect(body.data.admin).toHaveProperty('role', 'superadmin');
    });

    it('returns 401 for wrong password', async () => {
      const bcrypt = await import('bcryptjs');
      (bcrypt.default.compare as ReturnType<typeof vi.fn>).mockResolvedValue(false);
      mockDb.adminUser.findUnique.mockResolvedValue(MOCK_ADMIN);

      const res = await app.request('/api/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'admin@cutebunny.rental', password: 'wrong' }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Step 2: View dashboard ───────────────────────────────────────
  describe('Step 2: View dashboard', () => {
    it('returns dashboard stats with correct shape', async () => {
      const token = await getAdminToken();

      mockDb.order.count.mockResolvedValue(5);
      mockDb.financeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 50000 } });
      mockDb.product.findMany.mockResolvedValue([
        { id: 'p1', sku: 'WED-001', name: 'Dress 1', rentalCount: 10, thumbnailUrl: null },
      ]);
      mockDb.customer.count.mockResolvedValue(20);

      const res = await app.request('/api/v1/admin/dashboard/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveProperty('orders_today');
      expect(body.data).toHaveProperty('orders_pending_payment');
      expect(body.data).toHaveProperty('orders_shipped');
      expect(body.data).toHaveProperty('overdue_returns');
      expect(body.data).toHaveProperty('revenue_this_month');
      expect(body.data).toHaveProperty('total_customers');
      expect(body.data).toHaveProperty('total_orders');
      expect(body.data).toHaveProperty('top_products');
      expect(body.data).toHaveProperty('low_stock_alert');
      expect(Array.isArray(body.data.top_products)).toBe(true);
    });
  });

  // ─── Step 3: Verify payment slip ──────────────────────────────────
  describe('Step 3: Verify payment slip', () => {
    it('approves slip and transitions order to paid_locked', async () => {
      const token = await getAdminToken();

      mockDb.paymentSlip.findFirst.mockResolvedValue(MOCK_PAYMENT_SLIP);
      mockDb.paymentSlip.update.mockResolvedValue({ ...MOCK_PAYMENT_SLIP, verificationStatus: 'verified' });
      mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'unpaid' });
      mockDb.order.update.mockResolvedValue({ ...MOCK_ORDER, status: 'paid_locked' });
      mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-1' });

      const res = await app.request(`/api/v1/admin/orders/${MOCK_ORDER.id}/payment-slip/verify`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          slip_id: '00000000-0000-0000-0000-000000000010',
          verified: true,
          note: 'Payment confirmed',
        }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveProperty('slip_id', '00000000-0000-0000-0000-000000000010');
      expect(body.data).toHaveProperty('verification_status', 'verified');
      expect(body.data).toHaveProperty('order_status', 'paid_locked');

      expect(mockDb.order.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: '00000000-0000-0000-0000-000000000006' },
          data: { status: 'paid_locked' },
        })
      );
      expect(mockDb.orderStatusLog.create).toHaveBeenCalled();
    });

    it('rejects slip without transitioning order', async () => {
      const token = await getAdminToken();

      mockDb.paymentSlip.findFirst.mockResolvedValue(MOCK_PAYMENT_SLIP);
      mockDb.paymentSlip.update.mockResolvedValue({ ...MOCK_PAYMENT_SLIP, verificationStatus: 'rejected' });

      const res = await app.request(`/api/v1/admin/orders/${MOCK_ORDER.id}/payment-slip/verify`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          slip_id: '00000000-0000-0000-0000-000000000010',
          verified: false,
          note: 'Unclear transfer details',
        }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.verification_status).toBe('rejected');
      expect(mockDb.order.update).not.toHaveBeenCalled();
    });

    it('returns 404 for non-existent slip', async () => {
      const token = await getAdminToken();
      mockDb.paymentSlip.findFirst.mockResolvedValue(null);

      const res = await app.request(`/api/v1/admin/orders/${MOCK_ORDER.id}/payment-slip/verify`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ slip_id: '00000000-0000-0000-0000-999999999999', verified: true }),
      });
      expect(res.status).toBe(404);
    });
  });

  // ─── Step 4: Status transitions (full lifecycle) ──────────────────
  describe('Step 4: Full order status lifecycle', () => {
    const transitions = [
      { from: 'unpaid', to: 'paid_locked' },
      { from: 'paid_locked', to: 'shipped', extra: { tracking_number: 'TRK-12345' } },
      { from: 'shipped', to: 'returned' },
      { from: 'returned', to: 'cleaning' },
      { from: 'cleaning', to: 'finished' },
    ];

    for (const { from, to, extra } of transitions) {
      it(`transitions ${from} → ${to}`, async () => {
        const token = await getAdminToken();

        mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: from });
        mockDb.order.update.mockResolvedValue({ ...MOCK_ORDER, status: to });
        mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-1' });

        const res = await app.request(`/api/v1/admin/orders/${MOCK_ORDER.id}/status`, {
          method: 'PATCH',
          headers: authHeaders(token),
          body: JSON.stringify({ to_status: to, ...extra }),
        });
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.data).toHaveProperty('previous_status', from);
        expect(body.data).toHaveProperty('current_status', to);
        expect(body.data).toHaveProperty('allowed_transitions');

        expect(mockDb.orderStatusLog.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              orderId: '00000000-0000-0000-0000-000000000006',
              fromStatus: from,
              toStatus: to,
            }),
          })
        );
      });
    }

    it('transitions cleaning → repair → ready', async () => {
      const token = await getAdminToken();

      // cleaning → repair
      mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'cleaning' });
      mockDb.order.update.mockResolvedValue({ ...MOCK_ORDER, status: 'repair' });
      mockDb.orderStatusLog.create.mockResolvedValue({ id: 'log-1' });

      let res = await app.request('/api/v1/admin/orders/00000000-0000-0000-0000-000000000006/status', {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ to_status: 'repair', note: 'Minor damage found' }),
      });
      expect(res.status).toBe(200);

      // repair → ready
      mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'repair' });
      mockDb.order.update.mockResolvedValue({ ...MOCK_ORDER, status: 'finished' });

      res = await app.request('/api/v1/admin/orders/00000000-0000-0000-0000-000000000006/status', {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ to_status: 'finished', note: 'Repair complete' }),
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── Step 5: After-sales events ───────────────────────────────────
  describe('Step 5: After-sales events', () => {
    it('creates late fee event', async () => {
      const token = await getAdminToken();

      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);
      mockDb.afterSalesEvent.create.mockResolvedValue({
        id: 'ase-001',
        eventType: 'late_fee',
        amount: 500,
        orderId: MOCK_ORDER.id,
      });
      mockDb.financeTransaction.create.mockResolvedValue({ id: 'ft-001' });

      const res = await app.request(`/api/v1/admin/orders/${MOCK_ORDER.id}/after-sales`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          event_type: 'late_fee',
          amount: 500,
          note: '2 days late',
        }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveProperty('event_id');
      expect(body.data).toHaveProperty('event_type', 'late_fee');
      expect(body.data).toHaveProperty('amount', 500);
      expect(body.data).toHaveProperty('order_id', MOCK_ORDER.id);

      expect(mockDb.financeTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: MOCK_ORDER.id,
            txType: 'late_fee',
            amount: 500,
          }),
        })
      );
    });

    it('creates damage fee event', async () => {
      const token = await getAdminToken();

      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);
      mockDb.afterSalesEvent.create.mockResolvedValue({
        id: 'ase-002',
        eventType: 'damage_fee',
        amount: 2000,
        orderId: MOCK_ORDER.id,
      });
      mockDb.financeTransaction.create.mockResolvedValue({ id: 'ft-002' });

      const res = await app.request(`/api/v1/admin/orders/${MOCK_ORDER.id}/after-sales`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          event_type: 'damage_fee',
          amount: 2000,
          note: 'Torn fabric on left sleeve',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.event_type).toBe('damage_fee');
    });

    it('creates force buy event', async () => {
      const token = await getAdminToken();

      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);
      mockDb.afterSalesEvent.create.mockResolvedValue({
        id: 'ase-003',
        eventType: 'force_buy',
        amount: 25000,
        orderId: MOCK_ORDER.id,
      });
      mockDb.financeTransaction.create.mockResolvedValue({ id: 'ft-003' });

      const res = await app.request(`/api/v1/admin/orders/${MOCK_ORDER.id}/after-sales`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          event_type: 'force_buy',
          amount: 25000,
          note: 'Irreparable damage',
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.event_type).toBe('force_buy');
      expect(body.data.amount).toBe(25000);
    });

    it('creates partial refund (negative finance transaction)', async () => {
      const token = await getAdminToken();

      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);
      mockDb.afterSalesEvent.create.mockResolvedValue({
        id: 'ase-004',
        eventType: 'partial_refund',
        amount: 1000,
        orderId: MOCK_ORDER.id,
      });
      mockDb.financeTransaction.create.mockResolvedValue({ id: 'ft-004' });

      const res = await app.request(`/api/v1/admin/orders/${MOCK_ORDER.id}/after-sales`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          event_type: 'partial_refund',
          amount: 1000,
          note: 'Goodwill refund',
        }),
      });
      expect(res.status).toBe(200);

      expect(mockDb.financeTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: -1000,
          }),
        })
      );
    });

    it('returns 404 for non-existent order', async () => {
      const token = await getAdminToken();
      mockDb.order.findUnique.mockResolvedValue(null);

      const res = await app.request('/api/v1/admin/orders/bad-id/after-sales', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ event_type: 'late_fee', amount: 500 }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 400 for invalid event_type', async () => {
      const token = await getAdminToken();

      const res = await app.request(`/api/v1/admin/orders/${MOCK_ORDER.id}/after-sales`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ event_type: 'invalid_type', amount: 500 }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Admin Orders List ────────────────────────────────────────────
  describe('Admin order list with filters', () => {
    it('lists orders with pagination', async () => {
      const token = await getAdminToken();

      mockDb.order.findMany.mockResolvedValue([{
        ...MOCK_ORDER,
        paymentSlips: [],
      }]);
      mockDb.order.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/admin/orders', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toHaveProperty('order_number');
      expect(body.data[0]).toHaveProperty('status');
      expect(body.data[0]).toHaveProperty('customer');
      expect(body.data[0]).toHaveProperty('items');
      expect(body.data[0]).toHaveProperty('total_amount');
    });
  });

  // ─── Admin Products CRUD ──────────────────────────────────────────
  describe('Admin product management', () => {
    it('lists products', async () => {
      const token = await getAdminToken();

      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/admin/products', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
    });

    it('creates product with i18n', async () => {
      const token = await getAdminToken();

      mockDb.product.findUnique.mockResolvedValue(null);
      mockDb.product.create.mockResolvedValue({
        id: 'new-prod-001',
        sku: 'EVE-100',
        name: 'Evening Gown',
        category: 'evening',
      });

      const res = await app.request('/api/v1/admin/products', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          sku: 'EVE-100',
          name: 'Evening Gown',
          name_i18n: { en: 'Evening Gown', th: 'ชุดราตรี', zh: '晚礼服' },
          category: 'evening',
          size: ['S', 'M'],
          color: ['black'],
          rental_price_1day: 1000,
          rental_price_3day: 2500,
          rental_price_5day: 4000,
          deposit: 2000,
        }),
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('sku', 'EVE-100');
    });

    it('rejects duplicate SKU', async () => {
      const token = await getAdminToken();

      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);

      const res = await app.request('/api/v1/admin/products', {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({
          sku: 'WED-001',
          name: 'Another Dress',
          category: 'wedding',
          size: ['M'],
          color: ['white'],
          rental_price_1day: 1000,
          rental_price_3day: 2500,
          rental_price_5day: 4000,
          deposit: 2000,
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('DUPLICATE_SKU');
    });
  });

  // ─── Admin Customers ──────────────────────────────────────────────
  describe('Admin customer management', () => {
    it('lists customers', async () => {
      const token = await getAdminToken();

      mockDb.customer.findMany.mockResolvedValue([MOCK_CUSTOMER]);
      mockDb.customer.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/admin/customers', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toHaveProperty('name');
      expect(body.data[0]).toHaveProperty('email');
      expect(body.data[0]).toHaveProperty('tier', 'silver');
      expect(body.data[0]).toHaveProperty('rental_count');
    });

    it('returns customer detail with rental history', async () => {
      const token = await getAdminToken();

      mockDb.customer.findUnique.mockResolvedValue({
        ...MOCK_CUSTOMER,
        documents: [],
        orders: [
          {
            id: 'order-1',
            orderNumber: 'ORD-240601',
            status: 'finished',
            totalAmount: 6600,
            rentalStartDate: new Date('2026-07-01'),
            rentalEndDate: new Date('2026-07-03'),
            createdAt: new Date(),
          },
        ],
      });

      const res = await app.request(`/api/v1/admin/customers/${MOCK_CUSTOMER.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveProperty('name');
      expect(body.data).toHaveProperty('tier');
      expect(body.data).toHaveProperty('rental_history');
      expect(body.data.rental_history).toHaveLength(1);
      expect(body.data.rental_history[0]).toHaveProperty('order_number');
      expect(body.data.rental_history[0]).toHaveProperty('status');
    });

    it('returns 404 for non-existent customer', async () => {
      const token = await getAdminToken();
      mockDb.customer.findUnique.mockResolvedValue(null);

      const res = await app.request('/api/v1/admin/customers/bad-id', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    });
  });
});
