/**
 * T04: i18n Tests
 * - Test that /products?locale=th returns Thai product names
 * - Test that /products?locale=zh returns Chinese product names
 * - Test that /products?locale=en returns English (default)
 * - Verify all API responses respect locale param
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Create mock DB with vi.hoisted (runs before vi.mock factory)
const mockDb = vi.hoisted(() => {
  const models = [
    'product', 'brand', 'productImage', 'order', 'orderItem', 'orderStatusLog',
    'paymentSlip', 'customer', 'customerDocument', 'availabilityCalendar',
    'inventoryStatusLog', 'shippingZone', 'shippingProvinceConfig',
    'financeTransaction', 'afterSalesEvent', 'i18nString', 'adminUser',
    'auditLog', 'inventoryUnit', 'comboSet', 'comboSetItem', 'productStockLog',
    'financeCategory', 'systemConfig', 'notificationLog',
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
import { MOCK_PRODUCT } from './helpers/mock-db';

describe('T04: i18n Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── Product List i18n ────────────────────────────────────────────
  describe('Product list respects locale param', () => {
    it('returns English names by default (no locale param)', async () => {
      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0].name).toBe('Crystal Wedding Dress');
    });

    it('returns English names with locale=en', async () => {
      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products?locale=en');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0].name).toBe('Crystal Wedding Dress');
    });

    it('returns Thai names with locale=th', async () => {
      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products?locale=th');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0].name).toBe('ชุดเจ้าสาวคริสตัล');
    });

    it('returns Chinese names with locale=zh', async () => {
      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products?locale=zh');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0].name).toBe('水晶婚纱');
    });

    it('falls back to English for unsupported locale', async () => {
      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products?locale=fr');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0].name).toBe('Crystal Wedding Dress');
    });

    it('localizes brand name with locale=th', async () => {
      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products?locale=th');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0].brand).toBe('ไทย ไบรดัล');
    });
  });

  // ─── Product Detail i18n ──────────────────────────────────────────
  describe('Product detail respects locale param', () => {
    it('returns Thai name and description with locale=th', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.product.findMany.mockResolvedValue([]); // related

      const res = await app.request('/api/v1/products/00000000-0000-0000-0000-000000000001?locale=th');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.name).toBe('ชุดเจ้าสาวคริสตัล');
      expect(body.data.description).toBe('ชุดเจ้าสาวคริสตัลสวยงาม');
    });

    it('returns Chinese name and description with locale=zh', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.product.findMany.mockResolvedValue([]);

      const res = await app.request('/api/v1/products/00000000-0000-0000-0000-000000000001?locale=zh');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.name).toBe('水晶婚纱');
      expect(body.data.description).toBe('美丽的水晶婚纱');
    });

    it('returns English name and description with locale=en', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.product.findMany.mockResolvedValue([]);

      const res = await app.request('/api/v1/products/00000000-0000-0000-0000-000000000001?locale=en');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.name).toBe('Crystal Wedding Dress');
      expect(body.data.description).toBe('Beautiful crystal wedding dress');
    });

    it('localizes brand in detail with locale=zh', async () => {
      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.product.findMany.mockResolvedValue([]);

      const res = await app.request('/api/v1/products/00000000-0000-0000-0000-000000000001?locale=zh');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.brand).toBe('泰国新娘');
    });

    it('localizes related product names', async () => {
      const relatedProduct = {
        id: 'prod-uuid-002',
        sku: 'EVE-001',
        name: 'Evening Gown',
        nameI18n: { en: 'Evening Gown', th: 'ชุดราตรี', zh: '晚礼服' },
        thumbnailUrl: null,
        rentalPrice1Day: 1000,
      };

      mockDb.product.findUnique.mockResolvedValue(MOCK_PRODUCT);
      mockDb.product.findMany.mockResolvedValue([relatedProduct]);

      const res = await app.request('/api/v1/products/00000000-0000-0000-0000-000000000001?locale=th');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.related_skus).toHaveLength(1);
      expect(body.data.related_skus[0].name).toBe('ชุดราตรี');
    });
  });

  // ─── Admin Product List i18n ──────────────────────────────────────
  describe('Admin product list respects locale param', () => {
    it('returns localized names in admin list', async () => {
      const { createToken } = await import('../middleware/auth');
      const token = await createToken('00000000-0000-0000-0000-000000000099', 'admin@test.com', 'superadmin');

      mockDb.product.findMany.mockResolvedValue([MOCK_PRODUCT]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/admin/products?locale=zh', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0].name).toBe('水晶婚纱');
    });
  });

  // ─── Fallback Behavior ────────────────────────────────────────────
  describe('i18n fallback behavior', () => {
    it('falls back to base name when i18n field is null', async () => {
      const productNoI18n = {
        ...MOCK_PRODUCT,
        nameI18n: null,
        descriptionI18n: null,
        brand: { ...MOCK_PRODUCT.brand, nameI18n: null },
      };
      mockDb.product.findMany.mockResolvedValue([productNoI18n]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products?locale=th');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0].name).toBe('Crystal Wedding Dress');
    });

    it('falls back to English when locale key is missing from i18n object', async () => {
      const productPartialI18n = {
        ...MOCK_PRODUCT,
        nameI18n: { en: 'English Only Dress' },
      };
      mockDb.product.findMany.mockResolvedValue([productPartialI18n]);
      mockDb.product.count.mockResolvedValue(1);

      const res = await app.request('/api/v1/products?locale=th');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0].name).toBe('English Only Dress');
    });
  });

  // ─── Pure i18n Logic Tests ────────────────────────────────────────
  describe('i18n helper functions', () => {
    it('parseLocale returns correct locale for valid inputs', async () => {
      const { parseLocale } = await import('../lib/i18n');
      expect(parseLocale('en')).toBe('en');
      expect(parseLocale('th')).toBe('th');
      expect(parseLocale('zh')).toBe('zh');
    });

    it('parseLocale returns en for invalid locale', async () => {
      const { parseLocale } = await import('../lib/i18n');
      expect(parseLocale('fr')).toBe('en');
      expect(parseLocale('')).toBe('en');
      expect(parseLocale(null)).toBe('en');
      expect(parseLocale(undefined)).toBe('en');
    });

    it('localizeField returns correct locale value', async () => {
      const { localizeField } = await import('../lib/i18n');
      const i18n = { en: 'Hello', th: 'สวัสดี', zh: '你好' };
      expect(localizeField(i18n, 'fallback', 'en')).toBe('Hello');
      expect(localizeField(i18n, 'fallback', 'th')).toBe('สวัสดี');
      expect(localizeField(i18n, 'fallback', 'zh')).toBe('你好');
    });

    it('localizeField returns fallback for null i18n', async () => {
      const { localizeField } = await import('../lib/i18n');
      expect(localizeField(null, 'Fallback Name', 'th')).toBe('Fallback Name');
      expect(localizeField(undefined, 'Fallback Name', 'zh')).toBe('Fallback Name');
    });

    it('localizeField returns en when requested locale missing', async () => {
      const { localizeField } = await import('../lib/i18n');
      const i18n = { en: 'English Only' };
      expect(localizeField(i18n, 'fallback', 'th')).toBe('English Only');
    });
  });
});
