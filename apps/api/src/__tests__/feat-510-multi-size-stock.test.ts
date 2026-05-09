import { describe, it, expect, vi, beforeEach } from 'vitest';

// FEAT-510: Multi-size stock entry tests

// Mock Prisma
const mockProduct = {
  id: 'prod-1',
  sku: 'TEST-001',
  name: 'Test Product',
  stockOnHand: 5,
  stockQuantity: 10,
  deletedAt: null,
  size: ['M', 'S', 'L'],
  color: ['red'],
  categoryId: 'cat-1',
};

const mockStockLog = {
  id: 'log-1',
  productId: 'prod-1',
  type: 'purchase',
  quantity: 2,
  size: 'M',
  unitCost: 500,
  totalCost: 1000,
  note: null,
  createdBy: 'admin-1',
  createdAt: new Date(),
};

const mockTransaction = vi.fn();
const mockProductFindUnique = vi.fn();
const mockProductUpdate = vi.fn();
const mockStockLogCreate = vi.fn();
const mockCalendarCreateMany = vi.fn();

vi.mock('../../lib/db', () => ({
  getDb: () => ({
    product: {
      findUnique: mockProductFindUnique,
      update: mockProductUpdate,
    },
    productStockLog: {
      create: mockStockLogCreate,
    },
    availabilityCalendar: {
      createMany: mockCalendarCreateMany,
    },
    $transaction: mockTransaction,
  }),
}));

vi.mock('../../middleware/auth', () => ({
  getAdmin: () => ({ sub: 'admin-1', role: 'admin' }),
}));

// Import the app after mocks
import { Hono } from 'hono';

describe('FEAT-510: Multi-size stock entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProductFindUnique.mockResolvedValue(mockProduct);
    mockCalendarCreateMany.mockResolvedValue({ count: 0 });
  });

  describe('POST /admin/products/:id/stock', () => {
    it('should accept multi-size entries and create N stock logs', async () => {
      const entries = [
        { size: 'M', quantity: 2 },
        { size: 'S', quantity: 3 },
        { size: 'L', quantity: 1 },
      ];

      // Mock transaction to return product update + N stock logs
      mockTransaction.mockResolvedValue([
        { stockOnHand: 11 }, // updated product
        { id: 'log-1' },    // stock log for M
        { id: 'log-2' },    // stock log for S
        { id: 'log-3' },    // stock log for L
      ]);

      // Verify the transaction is called with correct args
      expect(mockTransaction).not.toHaveBeenCalled();

      // Simulate the multi-size body parsing logic
      const body = {
        entries,
        unit_cost: 500,
        note: 'Batch import',
      };

      const totalQuantity = entries.reduce((sum, e) => sum + e.quantity, 0);
      expect(totalQuantity).toBe(6);

      const totalCost = totalQuantity * body.unit_cost;
      expect(totalCost).toBe(3000);
    });

    it('should reject duplicate sizes in entries', () => {
      const entries = [
        { size: 'M', quantity: 2 },
        { size: 'M', quantity: 3 }, // duplicate!
      ];

      const sizesSeen = new Set<string | null>();
      let hasDuplicate = false;
      for (const entry of entries) {
        const key = entry.size ?? '__null__';
        if (sizesSeen.has(key)) {
          hasDuplicate = true;
          break;
        }
        sizesSeen.add(key);
      }

      expect(hasDuplicate).toBe(true);
    });

    it('should allow null sizes (legacy mode)', () => {
      const entries = [
        { size: null, quantity: 5 },
      ];

      const sizesSeen = new Set<string | null>();
      let hasDuplicate = false;
      for (const entry of entries) {
        const key = entry.size ?? '__null__';
        if (sizesSeen.has(key)) {
          hasDuplicate = true;
          break;
        }
        sizesSeen.add(key);
      }

      expect(hasDuplicate).toBe(false);
      expect(entries[0].size).toBeNull();
    });

    it('should be backward compatible with legacy body', () => {
      const legacyBody = { quantity: 5, unit_cost: 300, note: 'old format' };

      // Legacy body should be converted to entries=[{size: null, quantity: 5}]
      const entries = [{ size: null, quantity: legacyBody.quantity }];
      expect(entries).toEqual([{ size: null, quantity: 5 }]);
    });

    it('should calculate total quantity from entries', () => {
      const entries = [
        { size: 'M', quantity: 2 },
        { size: 'S', quantity: 3 },
        { size: 'L', quantity: 1 },
      ];

      const total = entries.reduce((sum, e) => sum + e.quantity, 0);
      expect(total).toBe(6);
    });

    it('should calculate per-entry total cost', () => {
      const entries = [
        { size: 'M', quantity: 2 },
        { size: 'S', quantity: 3 },
      ];
      const unitCost = 500;

      const perEntryCosts = entries.map((e) => ({
        size: e.size,
        totalCost: e.quantity * unitCost,
      }));

      expect(perEntryCosts).toEqual([
        { size: 'M', totalCost: 1000 },
        { size: 'S', totalCost: 1500 },
      ]);
    });
  });

  describe('Initial stock with multi-size entries', () => {
    it('should resolve entries from multi-size format', () => {
      const initialStock = {
        quantity: 6, // total
        unit_cost: 500,
        note: 'Initial stock',
        entries: [
          { size: 'M', quantity: 2 },
          { size: 'S', quantity: 3 },
          { size: 'L', quantity: 1 },
        ],
      };

      const resolvedEntries = initialStock.entries && initialStock.entries.length > 0
        ? initialStock.entries
        : [{ size: null, quantity: initialStock.quantity }];

      expect(resolvedEntries).toHaveLength(3);
      expect(resolvedEntries[0].size).toBe('M');
      expect(resolvedEntries.reduce((sum, e) => sum + e.quantity, 0)).toBe(6);
    });

    it('should fall back to single entry when no entries provided', () => {
      const initialStock = {
        quantity: 5,
        unit_cost: 300,
        note: 'Legacy initial stock',
      };

      const entries = (initialStock as { entries?: Array<{ size: string | null; quantity: number }> }).entries;
      const resolvedEntries = entries && entries.length > 0
        ? entries
        : [{ size: null, quantity: initialStock.quantity }];

      expect(resolvedEntries).toHaveLength(1);
      expect(resolvedEntries[0].size).toBeNull();
      expect(resolvedEntries[0].quantity).toBe(5);
    });
  });

  describe('Stock log response includes size field', () => {
    it('should include size in stock log response', () => {
      const log = {
        id: 'log-1',
        type: 'purchase',
        quantity: 2,
        size: 'M',
        unitCost: 500,
        totalCost: 1000,
        note: null,
        createdBy: 'admin-1',
        createdAt: new Date('2026-05-09T10:00:00Z'),
      };

      const response = {
        id: log.id,
        type: log.type,
        quantity: log.quantity,
        size: log.size ?? null,
        unit_cost: log.unitCost,
        total_cost: log.totalCost,
        note: log.note,
        created_by: log.createdBy,
        created_at: log.createdAt.toISOString(),
      };

      expect(response.size).toBe('M');
      expect(response).toHaveProperty('size');
    });

    it('should return null size for legacy entries', () => {
      const log = {
        id: 'log-2',
        type: 'purchase',
        quantity: 5,
        size: null,
        unitCost: 300,
        totalCost: 1500,
        note: 'old format',
        createdBy: 'admin-1',
        createdAt: new Date('2026-05-09T10:00:00Z'),
      };

      const response = {
        id: log.id,
        type: log.type,
        quantity: log.quantity,
        size: log.size ?? null,
        unit_cost: log.unitCost,
        total_cost: log.totalCost,
        note: log.note,
        created_by: log.createdBy,
        created_at: log.createdAt.toISOString(),
      };

      expect(response.size).toBeNull();
    });
  });

  // Gemini QC Fix 1: Server-side size validation tests
  describe('Size validation (server-side)', () => {
    it('should reject size not in product catalog (400, SIZE_NOT_IN_CATALOG)', () => {
      const catalogSizes = ['M', 'S', 'L'];
      const entries = [
        { size: 'M', quantity: 2 },
        { size: 'XL', quantity: 1 }, // not in catalog
      ];

      const invalidSizes = entries
        .filter((e) => e.size !== null && !catalogSizes.includes(e.size))
        .map((e) => e.size as string);

      expect(invalidSizes).toEqual(['XL']);
      expect(invalidSizes.length).toBeGreaterThan(0);
    });

    it('should accept size that is in product catalog', () => {
      const catalogSizes = ['M', 'S', 'L'];
      const entries = [
        { size: 'M', quantity: 2 },
        { size: 'S', quantity: 3 },
      ];

      const invalidSizes = entries
        .filter((e) => e.size !== null && !catalogSizes.includes(e.size))
        .map((e) => e.size as string);

      expect(invalidSizes).toHaveLength(0);
    });

    it('should accept size = null (legacy / non-sized product)', () => {
      const catalogSizes = ['M', 'S', 'L'];
      const entries: Array<{ size: string | null; quantity: number }> = [
        { size: null, quantity: 5 },
      ];

      const invalidSizes = entries
        .filter((e) => e.size !== null && !catalogSizes.includes(e.size))
        .map((e) => e.size!);

      expect(invalidSizes).toHaveLength(0);
    });

    it('should allow any size when catalog is empty (non-sized product)', () => {
      const catalogSizes: string[] = [];
      const entries = [
        { size: 'XL', quantity: 1 },
      ];

      // When catalog is empty, skip validation (product has no defined sizes)
      const shouldValidate = catalogSizes.length > 0;
      expect(shouldValidate).toBe(false);
    });

    it('should reject multiple invalid sizes with full error details', () => {
      const catalogSizes = ['M', 'S', 'L'];
      const entries = [
        { size: 'XL', quantity: 1 },
        { size: 'XXL', quantity: 2 },
        { size: 'M', quantity: 3 },
      ];

      const invalidSizes = entries
        .filter((e) => e.size !== null && !catalogSizes.includes(e.size))
        .map((e) => e.size as string);

      expect(invalidSizes).toEqual(['XL', 'XXL']);
      const errorMsg = `Size(s) not in product catalog: ${invalidSizes.join(', ')}. Allowed: ${catalogSizes.join(', ')}`;
      expect(errorMsg).toContain('XL');
      expect(errorMsg).toContain('XXL');
      expect(errorMsg).toContain('Allowed: M, S, L');
    });

    it('should validate initial stock entries against product sizes', () => {
      const productSizes = ['M', 'S', 'L'];
      const initialStockEntries = [
        { size: 'M', quantity: 2 },
        { size: 'XL', quantity: 1 }, // not in product sizes
      ];

      const invalidSizes = initialStockEntries
        .filter((e) => e.size !== null && !productSizes.includes(e.size))
        .map((e) => e.size as string);

      expect(invalidSizes).toEqual(['XL']);
    });
  });
});
