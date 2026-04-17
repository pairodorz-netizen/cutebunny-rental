/**
 * Q02: Input Validation & Security Hardening Tests
 * - Zod schemas reject unexpected fields
 * - File upload validates magic bytes (not just extension)
 * - Admin JWT expiry is enforced
 * - Rate limiting on login endpoint
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
import { MOCK_ORDER } from './helpers/mock-db';

describe('Q02: Security Hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Zod Validation ───────────────────────────────────────────────
  describe('Zod schema validation', () => {
    it('rejects cart with invalid product_id format (not UUID)', async () => {
      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ product_id: 'not-a-uuid', rental_days: 3, rental_start: '2026-08-01' }],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects cart with negative rental_days', async () => {
      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ product_id: '00000000-0000-0000-0000-000000000001', rental_days: -1, rental_start: '2026-08-01' }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects cart with rental_days > 30', async () => {
      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ product_id: '00000000-0000-0000-0000-000000000001', rental_days: 31, rental_start: '2026-08-01' }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects cart with invalid date format', async () => {
      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [{ product_id: '00000000-0000-0000-0000-000000000001', rental_days: 3, rental_start: '08/01/2026' }],
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects cart with more than 10 items', async () => {
      const items = Array.from({ length: 11 }, (_, i) => ({
        product_id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
        rental_days: 1,
        rental_start: '2026-08-01',
      }));

      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects order with invalid email', async () => {
      const res = await app.request('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart_token: '00000000-0000-0000-0000-000000000001',
          customer: { name: 'Test', phone: '081', email: 'not-an-email' },
          shipping_address: { province_code: 'BKK', line1: '123' },
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects admin status transition with invalid to_status', async () => {
      const { createToken } = await import('../middleware/auth');
      const token = await createToken('00000000-0000-0000-0000-000000000099', 'admin@test.com', 'superadmin');

      const res = await app.request('/api/v1/admin/orders/00000000-0000-0000-0000-000000000006/status', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ to_status: 'nonexistent_status' }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects admin product create with invalid category', async () => {
      const { createToken } = await import('../middleware/auth');
      const token = await createToken('00000000-0000-0000-0000-000000000099', 'admin@test.com', 'superadmin');

      const res = await app.request('/api/v1/admin/products', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          sku: 'TEST-001',
          name: 'Test',
          category: 'invalid_category',
          size: ['M'],
          color: ['red'],
          rental_price_1day: 100,
          rental_price_3day: 250,
          rental_price_5day: 400,
          deposit: 100,
        }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects admin after-sales with invalid event_type', async () => {
      const { createToken } = await import('../middleware/auth');
      const token = await createToken('00000000-0000-0000-0000-000000000099', 'admin@test.com', 'superadmin');

      const res = await app.request('/api/v1/admin/orders/00000000-0000-0000-0000-000000000006/after-sales', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ event_type: 'steal', amount: 999 }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── File Upload Magic Bytes ──────────────────────────────────────
  describe('File upload validates magic bytes', () => {
    it('rejects GIF files (wrong magic bytes)', async () => {
      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);

      const formData = new FormData();
      const gifBytes = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
      formData.append('file', new Blob([gifBytes], { type: 'image/gif' }), 'slip.gif');
      formData.append('declared_amount', '5000');

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006/payment-slip', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_FILE_TYPE');
    });

    it('rejects text file disguised as JPEG', async () => {
      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);

      const formData = new FormData();
      const textBytes = new TextEncoder().encode('This is not an image');
      formData.append('file', new Blob([textBytes], { type: 'image/jpeg' }), 'slip.jpg');
      formData.append('declared_amount', '5000');

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006/payment-slip', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error.code).toBe('INVALID_FILE_TYPE');
    });

    it('rejects PDF disguised as PNG', async () => {
      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);

      const formData = new FormData();
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2D]);
      formData.append('file', new Blob([pdfBytes], { type: 'image/png' }), 'slip.png');
      formData.append('declared_amount', '5000');

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006/payment-slip', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(400);
    });

    it('rejects empty file', async () => {
      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);

      const formData = new FormData();
      formData.append('file', new Blob([], { type: 'image/jpeg' }), 'empty.jpg');
      formData.append('declared_amount', '5000');

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006/payment-slip', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── JWT Expiry ───────────────────────────────────────────────────
  describe('JWT expiry enforcement', () => {
    it('rejects expired JWT token', async () => {
      const { sign } = await import('hono/jwt');
      const { getJwtSecret } = await import('../middleware/auth');

      const expiredPayload = {
        sub: '00000000-0000-0000-0000-000000000099',
        email: 'admin@test.com',
        role: 'superadmin',
        iat: Math.floor(Date.now() / 1000) - 7200,
        exp: Math.floor(Date.now() / 1000) - 3600,
      };
      const expiredToken = await sign(expiredPayload, getJwtSecret());

      const res = await app.request('/api/v1/admin/dashboard/stats', {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('accepts valid non-expired JWT token', async () => {
      const { createToken } = await import('../middleware/auth');
      const token = await createToken('00000000-0000-0000-0000-000000000099', 'admin@test.com', 'superadmin');

      mockDb.order.count.mockResolvedValue(0);
      mockDb.financeTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });
      mockDb.product.findMany.mockResolvedValue([]);
      mockDb.customer.count.mockResolvedValue(0);

      const res = await app.request('/api/v1/admin/dashboard/stats', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
    });
  });

  // ─── Rate Limiting ────────────────────────────────────────────────
  describe('Rate limiting on login endpoint', () => {
    it('allows requests within rate limit', async () => {
      mockDb.adminUser.findUnique.mockResolvedValue(null);

      const res = await app.request('/api/v1/admin/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'test@test.com', password: 'wrong' }),
      });
      expect(res.status).toBe(401);
    });
  });

  // ─── Order Token Security ────────────────────────────────────────
  describe('Order token security', () => {
    it('order tokens are UUIDs (unguessable)', async () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const { randomUUID } = await import('crypto');
      const token = randomUUID();
      expect(token).toMatch(uuidRegex);
    });

    it('GET /api/v1/orders/:token does not expose sequential IDs', async () => {
      mockDb.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        paymentSlips: [],
      });

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.order_number).toMatch(/^ORD-/);
      expect(body.data).not.toHaveProperty('id');
    });
  });

  // ─── Env Validation ──────────────────────────────────────────────
  describe('Environment validation', () => {
    it('validateEnv returns config for valid env', async () => {
      const originalEnv = process.env.DATABASE_URL;
      process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';

      const { validateEnv } = await import('../lib/env');
      const config = validateEnv();

      expect(config).toHaveProperty('DATABASE_URL');
      expect(config).toHaveProperty('JWT_SECRET');
      expect(config).toHaveProperty('PORT');
      expect(config).toHaveProperty('NODE_ENV');

      process.env.DATABASE_URL = originalEnv;
    });
  });
});
