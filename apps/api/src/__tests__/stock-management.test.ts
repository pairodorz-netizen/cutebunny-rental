/**
 * Stock Management Tests
 * - Unit: atomic stock transaction (add stock updates stock_on_hand + creates log)
 * - Integration: delete-with-active-rental rejection
 * - E2E: Add Stock flow
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDb = vi.hoisted(() => {
  const models = [
    'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
    'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
    'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
    'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
    'auditLog', 'productStockLog', 'comboSet', 'comboSetItem', 'inventoryUnit',
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any> = {
    $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: vi.fn(),
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

const PRODUCT_ID = '00000000-0000-0000-0000-000000000001';

const MOCK_PRODUCT = {
  id: PRODUCT_ID,
  sku: 'WED-001',
  name: 'Crystal Wedding Dress',
  nameI18n: null,
  description: '',
  descriptionI18n: null,
  category: 'wedding',
  brandId: null,
  thumbnailUrl: null,
  size: ['M'],
  color: ['white'],
  rentalPrice1Day: 1500,
  rentalPrice3Day: 3500,
  rentalPrice5Day: 5000,
  retailPrice: 25000,
  variableCost: 500,
  deposit: 3000,
  stockQuantity: 2,
  stockOnHand: 5,
  lowStockThreshold: 1,
  deletedAt: null,
  rentalCount: 15,
  currency: 'THB',
  available: true,
  extraDayRate: 100,
  costPrice: 8000,
  sellingPrice: 0,
  productStatus: 'active',
  soldAt: null,
  tags: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

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

describe('Stock Management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Unit: Atomic stock transaction ──────────────────────────────
  describe('POST /api/v1/admin/products/:id/stock — Add Stock', () => {
    it('adds stock and creates log atomically', async () => {
      const token = await getAdminToken();
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);

      const updatedProduct = { ...MOCK_PRODUCT, stockOnHand: 10 };
      const stockLog = { id: 'log-1', productId: PRODUCT_ID, type: 'purchase', quantity: 5, unitCost: 500, totalCost: 2500, createdAt: new Date() };
      mockDb.$transaction.mockResolvedValue([updatedProduct, stockLog]);

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}/stock`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ quantity: 5, unit_cost: 500, note: 'New batch' }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.stock_on_hand).toBe(10);
      expect(body.data.quantity).toBe(5);
      expect(body.data.unit_cost).toBe(500);
      expect(body.data.total_cost).toBe(2500);
      expect(body.data.log_id).toBe('log-1');

      // Verify $transaction was called (atomic operation)
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
    });

    it('rejects adding stock to a deleted product', async () => {
      const token = await getAdminToken();
      mockDb.product.findUnique.mockResolvedValue({ ...MOCK_PRODUCT, deletedAt: new Date() });

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}/stock`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ quantity: 5, unit_cost: 500 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('PRODUCT_DELETED');
    });

    it('rejects invalid quantity (0 or negative)', async () => {
      const token = await getAdminToken();

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}/stock`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ quantity: 0, unit_cost: 500 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 404 for non-existent product', async () => {
      const token = await getAdminToken();
      mockDb.product.findUnique.mockResolvedValue(null);

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}/stock`, {
        method: 'POST',
        headers: authHeaders(token),
        body: JSON.stringify({ quantity: 5, unit_cost: 500 }),
      });

      expect(res.status).toBe(404);
    });
  });

  // ─── Integration: Delete with active rental rejection ────────────
  describe('DELETE /api/v1/admin/products/:id — Soft Delete', () => {
    it('rejects deletion when product has active rentals', async () => {
      const token = await getAdminToken();
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.orderItem.count.mockResolvedValue(2); // 2 active rentals

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe('ACTIVE_RENTALS');
      expect(body.error.message).toContain('2 active rental');

      // Verify product was NOT updated
      expect(mockDb.product.update).not.toHaveBeenCalled();
    });

    it('soft-deletes product when no active rentals', async () => {
      const token = await getAdminToken();
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.orderItem.count.mockResolvedValue(0); // no active rentals

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.deleted).toBe(true);

      // Verify product was updated with deletedAt and available=false
      expect(mockDb.product.update).toHaveBeenCalledWith({
        where: { id: PRODUCT_ID },
        data: expect.objectContaining({
          deletedAt: expect.any(Date),
          available: false,
        }),
      });
    });

    it('rejects deleting an already-deleted product', async () => {
      const token = await getAdminToken();
      mockDb.product.findUnique.mockResolvedValue({ ...MOCK_PRODUCT, deletedAt: new Date() });

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('ALREADY_DELETED');
    });
  });

  // ─── Stock Logs ──────────────────────────────────────────────────
  describe('GET /api/v1/admin/products/:id/stock-logs — Stock History', () => {
    it('returns paginated stock logs', async () => {
      const token = await getAdminToken();
      mockDb.product.findUnique.mockResolvedValue({ id: PRODUCT_ID });

      const mockLogs = [
        { id: 'log-1', type: 'purchase', quantity: 5, unitCost: 500, totalCost: 2500, note: 'Initial stock', createdBy: null, createdAt: new Date() },
        { id: 'log-2', type: 'adjust', quantity: -2, unitCost: 0, totalCost: 0, note: 'Damaged items', createdBy: null, createdAt: new Date() },
      ];
      mockDb.productStockLog.findMany.mockResolvedValue(mockLogs);
      mockDb.productStockLog.count.mockResolvedValue(2);

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}/stock-logs`, {
        headers: authHeaders(token),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].type).toBe('purchase');
      expect(body.data[0].quantity).toBe(5);
      expect(body.data[1].quantity).toBe(-2);
      expect(body.meta.total).toBe(2);
    });
  });

  // ─── Stock Adjust ────────────────────────────────────────────────
  describe('PATCH /api/v1/admin/products/:id/stock/adjust — Adjust Stock', () => {
    it('adjusts stock quantity and creates log', async () => {
      const token = await getAdminToken();
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);

      const updatedProduct = { ...MOCK_PRODUCT, stockOnHand: 3 };
      const stockLog = { id: 'log-adj-1' };
      mockDb.$transaction.mockResolvedValue([updatedProduct, stockLog]);

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}/stock/adjust`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ new_qty: 3, reason: 'Physical count correction' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.previous_qty).toBe(5);
      expect(body.data.new_qty).toBe(3);
      expect(body.data.adjustment).toBe(-2);
    });

    it('returns no-change when qty is same', async () => {
      const token = await getAdminToken();
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}/stock/adjust`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ new_qty: 5, reason: 'No change needed' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.message).toBe('No change');
    });

    it('rejects adjustment without reason', async () => {
      const token = await getAdminToken();

      const res = await app.request(`/api/v1/admin/products/${PRODUCT_ID}/stock/adjust`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ new_qty: 3 }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ─── Product List with includeDeleted flag ───────────────────────
  describe('GET /api/v1/admin/products — List with stock_on_hand', () => {
    it('excludes soft-deleted products by default', async () => {
      const token = await getAdminToken();
      const productWithRelations = {
        ...MOCK_PRODUCT,
        brand: { name: 'Thai Bridal' },
        images: [{ url: 'https://example.com/img1.jpg' }],
      };
      mockDb.product.findMany.mockResolvedValue([productWithRelations]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/admin/products', {
        headers: authHeaders(token),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data[0].stock_on_hand).toBe(5);
      expect(body.data[0].low_stock_threshold).toBe(1);

      // Verify the where clause includes deletedAt: null
      expect(mockDb.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ deletedAt: null }),
        }),
      );
    });

    it('includes soft-deleted products when includeDeleted=true', async () => {
      const token = await getAdminToken();
      mockDb.product.findMany.mockResolvedValue([]);
      mockDb.product.count.mockResolvedValue(0);

      await app.request('/api/v1/admin/products?includeDeleted=true', {
        headers: authHeaders(token),
      });

      // Verify the where clause does NOT include deletedAt filter
      const call = mockDb.product.findMany.mock.calls[0][0];
      expect(call.where.deletedAt).toBeUndefined();
    });
  });
});
