/**
 * T01: API Contract Tests
 * - All public endpoints return correct response shapes (envelope format)
 * - All admin endpoints require auth (401 without token)
 * - State machine rejects invalid transitions (422)
 * - Availability conflict returns 409
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
import { MOCK_PRODUCT, MOCK_ORDER, MOCK_SHIPPING_PROVINCE } from './helpers/mock-db';

describe('T01: API Contract Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock defaults
    mockDb.product.findMany.mockResolvedValue([]);
    mockDb.product.count.mockResolvedValue(0);
    mockDb.product.findUnique.mockResolvedValue(null);
    mockDb.order.findMany.mockResolvedValue([]);
    mockDb.order.count.mockResolvedValue(0);
    mockDb.order.findUnique.mockResolvedValue(null);
    mockDb.customer.findMany.mockResolvedValue([]);
    mockDb.customer.count.mockResolvedValue(0);
  });

  // ─── Root + Health ──────────────────────────────────────────────────
  describe('Root endpoints', () => {
    it('GET / returns API info', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('name', 'CuteBunny Rental API');
      expect(body).toHaveProperty('version');
      expect(body).toHaveProperty('status', 'ok');
    });

    it('GET /health returns health status', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('status');
      expect(body).toHaveProperty('timestamp');
      expect(body).toHaveProperty('database');
    });
  });

  // ─── Public Endpoints: Response Shape (Envelope) ──────────────────
  describe('Public endpoints return envelope format', () => {
    it('GET /api/v1/products returns { data, meta }', async () => {
      const res = await app.request('/api/v1/products');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body).toHaveProperty('meta');
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.meta).toHaveProperty('page');
      expect(body.meta).toHaveProperty('per_page');
      expect(body.meta).toHaveProperty('total');
      expect(body.meta).toHaveProperty('total_pages');
    });

    it('GET /api/v1/products returns product with correct shape', async () => {
      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      const product = body.data[0];
      expect(product).toHaveProperty('id');
      expect(product).toHaveProperty('sku');
      expect(product).toHaveProperty('name');
      expect(product).toHaveProperty('category');
      expect(product).toHaveProperty('rental_prices');
      expect(product.rental_prices).toHaveProperty('1day');
      expect(product.rental_prices).toHaveProperty('3day');
      expect(product.rental_prices).toHaveProperty('5day');
      expect(product).toHaveProperty('deposit');
      expect(product).toHaveProperty('rental_count');
    });

    it('GET /api/v1/products/:id returns 404 envelope for missing product', async () => {
      const res = await app.request('/api/v1/products/nonexistent-uuid');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error).toHaveProperty('code', 'NOT_FOUND');
      expect(body.error).toHaveProperty('message');
    });

    it('GET /api/v1/products/:id returns product detail shape', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.product.findMany.mockResolvedValue([]); // related products

      const res = await app.request('/api/v1/products/00000000-0000-0000-0000-000000000001');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('name');
      expect(body.data).toHaveProperty('description');
      expect(body.data).toHaveProperty('images');
      expect(body.data).toHaveProperty('rental_prices');
      expect(body.data).toHaveProperty('ref_price');
      expect(body.data).toHaveProperty('related_skus');
    });

    it('GET /api/v1/shipping/calculate returns 400 without province_code', async () => {
      const res = await app.request('/api/v1/shipping/calculate');
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('GET /api/v1/shipping/calculate returns fee shape', async () => {
      mockDb.shippingProvinceConfig.findFirst.mockResolvedValue(MOCK_SHIPPING_PROVINCE);

      const res = await app.request('/api/v1/shipping/calculate?province_code=BKK');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('data');
      expect(body.data).toHaveProperty('province_code', 'BKK');
      expect(body.data).toHaveProperty('zone');
      expect(body.data).toHaveProperty('base_fee');
      expect(body.data).toHaveProperty('addon_fee');
      expect(body.data).toHaveProperty('total_fee');
      expect(body.data).toHaveProperty('currency', 'THB');
    });

    it('GET /api/v1/orders/:token returns 404 for invalid token', async () => {
      const res = await app.request('/api/v1/orders/invalid-uuid');
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    });
  });

  // ─── Cart Validation ──────────────────────────────────────────────
  describe('Cart validation', () => {
    it('POST /api/v1/cart returns 400 for invalid body', async () => {
      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/cart returns 400 for empty items array', async () => {
      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/v1/cart returns 404 for non-existent product', async () => {
      mockDb.product.findUnique.mockResolvedValue(null);

      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ product_id: '00000000-0000-0000-0000-000000000001', rental_days: 3, rental_start: '2026-08-01' }],
        }),
      });
      expect(res.status).toBe(404);
    });

    it('POST /api/v1/cart returns 409 for availability conflict', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.availabilityCalendar.findMany.mockResolvedValue([
        {
          id: 'cal-001',
          productId: '00000000-0000-0000-0000-000000000001',
          calendarDate: new Date('2026-08-01'),
          slotStatus: 'booked',
          orderId: 'other-order',
        },
      ]);

      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ product_id: '00000000-0000-0000-0000-000000000001', rental_days: 3, rental_start: '2026-08-01' }],
        }),
      });
      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('AVAILABILITY_CONFLICT');
      expect(body.error).toHaveProperty('details');
    });
  });

  // ─── Admin Endpoints: Auth Required (401) ─────────────────────────
  describe('Admin endpoints require auth (401 without token)', () => {
    const protectedEndpoints = [
      { method: 'GET' as const, path: '/api/v1/admin/dashboard/stats' },
      { method: 'GET' as const, path: '/api/v1/admin/orders/' },
      { method: 'GET' as const, path: '/api/v1/admin/products/' },
      { method: 'GET' as const, path: '/api/v1/admin/calendar/' },
      { method: 'GET' as const, path: '/api/v1/admin/customers/' },
      { method: 'GET' as const, path: '/api/v1/admin/shipping/zones' },
      { method: 'GET' as const, path: '/api/v1/admin/finance/report' },
    ];

    for (const endpoint of protectedEndpoints) {
      it(`${endpoint.method} ${endpoint.path} returns 401 without auth`, async () => {
        const res = await app.request(endpoint.path, { method: endpoint.method });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body).toHaveProperty('error');
        expect(body.error.code).toBe('UNAUTHORIZED');
      });
    }

    it('returns 401 with invalid Bearer token', async () => {
      const res = await app.request('/api/v1/admin/dashboard/stats', {
        headers: { Authorization: 'Bearer invalid-token-value' },
      });
      expect(res.status).toBe(401);
    });

    it('returns 401 with missing Bearer prefix', async () => {
      const res = await app.request('/api/v1/admin/dashboard/stats', {
        headers: { Authorization: 'some-token' },
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── State Machine: Invalid Transitions (422) ─────────────────────
  describe('State machine rejects invalid transitions (422)', () => {
    it('rejects unpaid → shipped (must go through paid_locked)', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'unpaid' });

      const { createToken } = await import('../middleware/auth');
      const token = await createToken('00000000-0000-0000-0000-000000000099', 'admin@test.com', 'superadmin');

      const res = await app.request('/api/v1/admin/orders/00000000-0000-0000-0000-000000000006/status', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to_status: 'shipped' }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_TRANSITION');
      expect(body.error.details).toHaveProperty('allowed_transitions');
      expect(body.error.details.allowed_transitions).toContain('paid_locked');
    });

    it('rejects shipped → ready (must go through returned/cleaning)', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'shipped' });

      const { createToken } = await import('../middleware/auth');
      const token = await createToken('00000000-0000-0000-0000-000000000099', 'admin@test.com', 'superadmin');

      const res = await app.request('/api/v1/admin/orders/00000000-0000-0000-0000-000000000006/status', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to_status: 'finished' }),
      });
      expect(res.status).toBe(422);
    });

    it('rejects backward transition ready → unpaid', async () => {
      mockDb.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'finished' });

      const { createToken } = await import('../middleware/auth');
      const token = await createToken('00000000-0000-0000-0000-000000000099', 'admin@test.com', 'superadmin');

      const res = await app.request('/api/v1/admin/orders/00000000-0000-0000-0000-000000000006/status', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to_status: 'unpaid' }),
      });
      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error.message).toContain('terminal state');
    });
  });

  // ─── Order Validation ─────────────────────────────────────────────
  describe('Order creation validation', () => {
    it('POST /api/v1/orders returns 400 for invalid body', async () => {
      const res = await app.request('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/v1/orders returns 400 for missing customer data', async () => {
      const res = await app.request('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart_token: '00000000-0000-0000-0000-000000000001',
          shipping_address: { province_code: 'BKK', line1: '123 Test' },
        }),
      });
      expect(res.status).toBe(400);
    });
  });
});
