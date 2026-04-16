/**
 * T02: Customer Happy Path E2E
 * Browse catalog → view product → check calendar → add to cart → checkout →
 * upload slip → check order status
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
import { MOCK_PRODUCT, MOCK_ORDER, MOCK_PAYMENT_SLIP } from './helpers/mock-db';

describe('T02: Customer Happy Path E2E', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Step 1: Browse catalog ───────────────────────────────────────
  describe('Step 1: Browse catalog', () => {
    it('lists products with pagination', async () => {
      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products?page=1&per_page=10');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.meta.page).toBe(1);
      expect(body.meta.total).toBe(1);

      const product = body.data[0];
      expect(product.sku).toBe('WED-001');
      expect(product.name).toBe('Crystal Wedding Dress');
      expect(product.rental_prices['1day']).toBe(1500);
      expect(product.deposit).toBe(3000);
    });

    it('filters products by color', async () => {
      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products?color=white');
      expect(res.status).toBe(200);
      expect(mockDb.product.findMany).toHaveBeenCalled();
    });

    it('filters products by size', async () => {
      mockDb.product.findMany.mockResolvedValue([]);
      mockDb.product.count.mockResolvedValue(0);

      const res = await app.request('/api/v1/products?size=XL');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(0);
    });

    it('returns empty list for no matches', async () => {
      mockDb.product.findMany.mockResolvedValue([]);
      mockDb.product.count.mockResolvedValue(0);

      const res = await app.request('/api/v1/products?color=rainbow');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual([]);
      expect(body.meta.total).toBe(0);
    });
  });

  // ─── Step 2: View product detail ──────────────────────────────────
  describe('Step 2: View product detail', () => {
    it('returns full product with images and related', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.product.findMany.mockResolvedValue([]); // related

      const res = await app.request('/api/v1/products/00000000-0000-0000-0000-000000000001');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.id).toBe('00000000-0000-0000-0000-000000000001');
      expect(body.data.images).toHaveLength(2);
      expect(body.data.rental_prices['3day']).toBe(3500);
      expect(body.data.ref_price).toBe(25000);
      expect(body.data.related_skus).toEqual([]);
    });

    it('returns 404 for non-existent product', async () => {
      mockDb.product.findUnique.mockResolvedValue(null);

      const res = await app.request('/api/v1/products/missing-id');
      expect(res.status).toBe(404);
    });
  });

  // ─── Step 3: Check calendar ───────────────────────────────────────
  describe('Step 3: Check availability calendar', () => {
    it('returns month availability for product', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.availabilityCalendar.findMany.mockResolvedValue([
        {
          id: 'cal-1',
          productId: '00000000-0000-0000-0000-000000000001',
          calendarDate: new Date('2026-07-05'),
          slotStatus: 'booked',
          orderId: 'order-1',
        },
      ]);

      const res = await app.request('/api/v1/products/00000000-0000-0000-0000-000000000001/calendar?year=2026&month=7');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveProperty('product_id', '00000000-0000-0000-0000-000000000001');
      expect(body.data).toHaveProperty('year', 2026);
      expect(body.data).toHaveProperty('month', 7);
      expect(body.data.days).toHaveLength(31); // July has 31 days

      // Check that day 5 is booked
      const day5 = body.data.days.find((d: { date: string }) => d.date === '2026-07-05');
      expect(day5).toBeDefined();
      expect(day5.status).toBe('booked');

      // Other days should be available
      const day1 = body.data.days.find((d: { date: string }) => d.date === '2026-07-01');
      expect(day1.status).toBe('available');
    });

    it('returns 400 for invalid year/month', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);

      const res = await app.request('/api/v1/products/00000000-0000-0000-0000-000000000001/calendar?year=abc&month=13');
      expect(res.status).toBe(400);
    });
  });

  // ─── Step 4: Add to cart ──────────────────────────────────────────
  describe('Step 4: Add to cart', () => {
    it('creates cart with valid items', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.availabilityCalendar.findMany.mockResolvedValue([]); // no conflicts
      mockDb.availabilityCalendar.upsert.mockResolvedValue({ id: 'cal-new' });

      const res = await app.request('/api/v1/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { product_id: '00000000-0000-0000-0000-000000000001', rental_days: 3, rental_start: '2026-08-15' },
          ],
        }),
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveProperty('cart_token');
      expect(body.data).toHaveProperty('items');
      expect(body.data.items).toHaveLength(1);
      expect(body.data).toHaveProperty('summary');
      expect(body.data.summary).toHaveProperty('item_count', 1);
      expect(body.data.summary).toHaveProperty('subtotal');
      expect(body.data.summary).toHaveProperty('deposit');
      expect(body.data.summary).toHaveProperty('estimated_total');
      expect(body.data).toHaveProperty('expires_at');

      // Verify cart item shape
      const item = body.data.items[0];
      expect(item).toHaveProperty('product_id', '00000000-0000-0000-0000-000000000001');
      expect(item).toHaveProperty('product_name', 'Crystal Wedding Dress');
      expect(item).toHaveProperty('rental_days', 3);
      expect(item).toHaveProperty('price_per_day');
      expect(item).toHaveProperty('subtotal');
      expect(item).toHaveProperty('deposit');
    });
  });

  // ─── Step 5: Checkout ─────────────────────────────────────────────
  describe('Step 5: Checkout (place order)', () => {
    it('returns 404 for expired/invalid cart', async () => {
      const res = await app.request('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart_token: '00000000-0000-0000-0000-000000000099',
          customer: { name: 'Test User', phone: '0812345678', email: 'test@test.com' },
          shipping_address: { province_code: 'BKK', line1: '123 Test Road' },
        }),
      });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('CART_NOT_FOUND');
    });

    it('validates required customer fields', async () => {
      const res = await app.request('/api/v1/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cart_token: '00000000-0000-0000-0000-000000000001',
          customer: { name: 'Test' }, // missing phone and email
          shipping_address: { province_code: 'BKK', line1: '123' },
        }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Step 6: Upload payment slip ──────────────────────────────────
  describe('Step 6: Payment slip upload', () => {
    it('rejects upload for non-existent order', async () => {
      mockDb.order.findUnique.mockResolvedValue(null);

      const formData = new FormData();
      const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]);
      formData.append('file', new Blob([jpegBytes], { type: 'image/jpeg' }), 'slip.jpg');
      formData.append('declared_amount', '6600');
      formData.append('bank_name', 'KBank');

      const res = await app.request('/api/v1/orders/invalid-token/payment-slip', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(404);
    });

    it('rejects non-image file types', async () => {
      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);

      const formData = new FormData();
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
      formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'slip.pdf');
      formData.append('declared_amount', '6600');

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006/payment-slip', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_FILE_TYPE');
    });

    it('accepts valid JPEG slip', async () => {
      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);
      mockDb.paymentSlip.create.mockResolvedValue({
        ...MOCK_PAYMENT_SLIP,
        id: 'slip-new-001',
      });

      const formData = new FormData();
      const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]);
      formData.append('file', new Blob([jpegBytes], { type: 'image/jpeg' }), 'slip.jpg');
      formData.append('declared_amount', '6600');
      formData.append('bank_name', 'KBank');

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006/payment-slip', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(201);

      const body = await res.json();
      expect(body.data).toHaveProperty('id');
      expect(body.data).toHaveProperty('storage_key');
      expect(body.data).toHaveProperty('verification_status', 'pending');
    });

    it('accepts valid PNG slip', async () => {
      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);
      mockDb.paymentSlip.create.mockResolvedValue({
        ...MOCK_PAYMENT_SLIP,
        id: 'slip-new-002',
      });

      const formData = new FormData();
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
      formData.append('file', new Blob([pngBytes], { type: 'image/png' }), 'slip.png');
      formData.append('declared_amount', '5000');

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006/payment-slip', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(201);
    });

    it('rejects missing declared_amount', async () => {
      mockDb.order.findUnique.mockResolvedValue(MOCK_ORDER);

      const formData = new FormData();
      const jpegBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);
      formData.append('file', new Blob([jpegBytes], { type: 'image/jpeg' }), 'slip.jpg');

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006/payment-slip', {
        method: 'POST',
        body: formData,
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── Step 7: Check order status ───────────────────────────────────
  describe('Step 7: Check order status', () => {
    it('returns full order detail by token', async () => {
      mockDb.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        paymentSlips: [MOCK_PAYMENT_SLIP],
      });

      const res = await app.request('/api/v1/orders/00000000-0000-0000-0000-000000000006');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveProperty('order_number', 'ORD-240601');
      expect(body.data).toHaveProperty('status', 'unpaid');
      expect(body.data).toHaveProperty('rental_period');
      expect(body.data.rental_period).toHaveProperty('start');
      expect(body.data.rental_period).toHaveProperty('end');
      expect(body.data.rental_period).toHaveProperty('days');
      expect(body.data).toHaveProperty('items');
      expect(body.data.items).toHaveLength(1);
      expect(body.data).toHaveProperty('summary');
      expect(body.data.summary).toHaveProperty('subtotal');
      expect(body.data.summary).toHaveProperty('deposit');
      expect(body.data.summary).toHaveProperty('delivery_fee');
      expect(body.data.summary).toHaveProperty('total');
      expect(body.data).toHaveProperty('payment_slips');
      expect(body.data.payment_slips).toHaveLength(1);
      expect(body.data).toHaveProperty('shipping');
      expect(body.data).toHaveProperty('created_at');
    });

    it('returns 404 for non-existent order token', async () => {
      mockDb.order.findUnique.mockResolvedValue(null);

      const res = await app.request('/api/v1/orders/bad-token');
      expect(res.status).toBe(404);
    });
  });
});
