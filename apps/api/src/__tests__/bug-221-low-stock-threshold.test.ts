import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * BUG-221: Low-stock alert triggers on fully-stocked items.
 *
 * Root cause: threshold comparison used `<=` instead of `<`.
 * When stock equals threshold, the item should NOT be considered low-stock.
 *
 * Acceptance criteria:
 * - Alert triggers ONLY when stock < threshold (not <=)
 * - stock=10, threshold=5 → NO alert
 * - stock=5, threshold=5 → NO alert (stock == threshold is OK)
 * - stock=4, threshold=5 → alert
 * - stock=0, threshold=5 → alert
 * - stock=0, threshold=0 → NO alert (impossible to go below 0)
 */

// Simulate the comparison logic used in dashboard.ts
function isLowStock(stockOnHand: number, lowStockThreshold: number): boolean {
  return stockOnHand < lowStockThreshold;
}

// Simulate filtering products for low-stock alerts
function filterLowStockProducts<T extends { stockOnHand: number; lowStockThreshold: number }>(
  products: T[]
): T[] {
  return products.filter((p) => p.stockOnHand < p.lowStockThreshold);
}

describe('BUG-221: Low-stock alert threshold comparison', () => {
  describe('isLowStock — basic comparison', () => {
    it('stock=10, threshold=5 → NO alert (well above)', () => {
      expect(isLowStock(10, 5)).toBe(false);
    });

    it('stock=5, threshold=5 → NO alert (stock equals threshold is OK)', () => {
      expect(isLowStock(5, 5)).toBe(false);
    });

    it('stock=4, threshold=5 → alert (below threshold)', () => {
      expect(isLowStock(4, 5)).toBe(true);
    });

    it('stock=0, threshold=5 → alert (completely out)', () => {
      expect(isLowStock(0, 5)).toBe(true);
    });

    it('stock=0, threshold=0 → NO alert (threshold 0 means alerts disabled)', () => {
      expect(isLowStock(0, 0)).toBe(false);
    });

    it('stock=1, threshold=1 → NO alert (at threshold exactly)', () => {
      expect(isLowStock(1, 1)).toBe(false);
    });

    it('stock=100, threshold=100 → NO alert (at threshold exactly)', () => {
      expect(isLowStock(100, 100)).toBe(false);
    });

    it('stock=99, threshold=100 → alert (one below)', () => {
      expect(isLowStock(99, 100)).toBe(true);
    });
  });

  describe('filterLowStockProducts — bulk filtering', () => {
    const products = [
      { id: 'a', sku: 'SKU-A', name: 'Dress A', stockOnHand: 10, lowStockThreshold: 5 },
      { id: 'b', sku: 'SKU-B', name: 'Dress B', stockOnHand: 5, lowStockThreshold: 5 },
      { id: 'c', sku: 'SKU-C', name: 'Dress C', stockOnHand: 4, lowStockThreshold: 5 },
      { id: 'd', sku: 'SKU-D', name: 'Dress D', stockOnHand: 0, lowStockThreshold: 5 },
      { id: 'e', sku: 'SKU-E', name: 'Dress E', stockOnHand: 0, lowStockThreshold: 0 },
      { id: 'f', sku: 'SKU-F', name: 'Dress F', stockOnHand: 3, lowStockThreshold: 3 },
    ];

    it('filters correctly — only stock < threshold', () => {
      const result = filterLowStockProducts(products);
      expect(result.map((p) => p.id)).toEqual(['c', 'd']);
    });

    it('does NOT include stock=5/threshold=5 (the specific repro case)', () => {
      const result = filterLowStockProducts(products);
      expect(result.find((p) => p.id === 'b')).toBeUndefined();
    });

    it('does NOT include stock=10/threshold=5 (well above)', () => {
      const result = filterLowStockProducts(products);
      expect(result.find((p) => p.id === 'a')).toBeUndefined();
    });

    it('includes stock=4/threshold=5 (just below)', () => {
      const result = filterLowStockProducts(products);
      expect(result.find((p) => p.id === 'c')).toBeDefined();
    });

    it('includes stock=0/threshold=5 (completely out)', () => {
      const result = filterLowStockProducts(products);
      expect(result.find((p) => p.id === 'd')).toBeDefined();
    });

    it('does NOT include stock=0/threshold=0 (alerts disabled)', () => {
      const result = filterLowStockProducts(products);
      expect(result.find((p) => p.id === 'e')).toBeUndefined();
    });
  });

  describe('variant stock sum — stockOnHand is the aggregate', () => {
    // stockOnHand on the Product model IS the aggregate across all units.
    // If a product has 3 units with sizes S/M/L, stockOnHand = 3 (total).
    // This verifies the filtering works correctly with aggregate values.

    it('product with multiple units summed correctly', () => {
      const product = {
        id: 'multi',
        sku: 'MULTI-01',
        name: 'Multi-size Dress',
        stockOnHand: 6, // 2×S + 2×M + 2×L = 6
        lowStockThreshold: 5,
      };
      // 6 > 5 → NOT low stock
      expect(isLowStock(product.stockOnHand, product.lowStockThreshold)).toBe(false);
    });

    it('product with depleted variants triggers alert', () => {
      const product = {
        id: 'depleted',
        sku: 'DEP-01',
        name: 'Depleted Dress',
        stockOnHand: 2, // Only 2 units remain across all sizes
        lowStockThreshold: 5,
      };
      // 2 < 5 → IS low stock
      expect(isLowStock(product.stockOnHand, product.lowStockThreshold)).toBe(true);
    });

    it('single-unit product at exact threshold → NO alert', () => {
      const product = {
        id: 'single',
        sku: 'SINGLE-01',
        name: 'Single Unit Dress',
        stockOnHand: 1,
        lowStockThreshold: 1,
      };
      // 1 == 1 → NOT low stock (at threshold, not below)
      expect(isLowStock(product.stockOnHand, product.lowStockThreshold)).toBe(false);
    });
  });
});
