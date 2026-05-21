/**
 * BUG-549: P/L Consistency — shared helper unit tests
 *
 * Verifies that computeProductPL and computeProductROI produce
 * consistent results and handle edge cases correctly.
 */
import { describe, it, expect } from 'vitest';
import {
  computeProductPL,
  computeProductROI,
  PAID_ORDER_STATUSES,
  type ProductPLInput,
  type ProductROIInput,
} from '../lib/pl-calc';

// ─── Memo Doll Top baseline (from production verification) ───────────────
const MEMO_DOLL_TOP: ProductPLInput = {
  costPrice: 1000,
  sellingPrice: 0,
  variableCost: 100,
  orderItems: [
    { subtotal: 290, order: { status: 'paid_locked' } },
  ],
};

describe('computeProductPL', () => {
  it('calculates Memo Doll Top baseline correctly', () => {
    const result = computeProductPL(MEMO_DOLL_TOP);
    expect(result.buying_cost).toBe(1000);
    expect(result.total_rental_revenue).toBe(290);
    expect(result.rental_count).toBe(1);
    expect(result.variable_cost_per_rental).toBe(100);
    expect(result.total_variable_cost).toBe(100);
    expect(result.gross_profit).toBe(190); // 290 - 100
    expect(result.net_pl).toBe(-810); // 290 - 1000 - 100 + 0
  });

  it('returns 0 for product with no rentals (not NaN)', () => {
    const result = computeProductPL({
      costPrice: 500,
      sellingPrice: 0,
      variableCost: 50,
      orderItems: [],
    });
    expect(result.rental_count).toBe(0);
    expect(result.total_rental_revenue).toBe(0);
    expect(result.total_variable_cost).toBe(0);
    expect(result.gross_profit).toBe(0);
    expect(result.net_pl).toBe(-500); // 0 - 500 - 0 + 0
    expect(Number.isNaN(result.net_pl)).toBe(false);
  });

  it('excludes unpaid/cancelled orders', () => {
    const result = computeProductPL({
      costPrice: 1000,
      sellingPrice: 0,
      variableCost: 100,
      orderItems: [
        { subtotal: 290, order: { status: 'paid_locked' } },
        { subtotal: 300, order: { status: 'cancelled' } },
        { subtotal: 200, order: { status: 'unpaid' } },
        { subtotal: 350, order: { status: 'expired' } },
      ],
    });
    expect(result.rental_count).toBe(1);
    expect(result.total_rental_revenue).toBe(290);
    expect(result.total_variable_cost).toBe(100);
  });

  it('includes all paid statuses', () => {
    const items = PAID_ORDER_STATUSES.map((status, i) => ({
      subtotal: 100 * (i + 1),
      order: { status },
    }));
    const result = computeProductPL({
      costPrice: 1000,
      sellingPrice: 0,
      variableCost: 50,
      orderItems: items,
    });
    // 5 statuses: 100+200+300+400+500 = 1500
    expect(result.rental_count).toBe(5);
    expect(result.total_rental_revenue).toBe(1500);
    expect(result.total_variable_cost).toBe(250); // 50 × 5
    expect(result.gross_profit).toBe(1250); // 1500 - 250
    expect(result.net_pl).toBe(250); // 1500 - 1000 - 250 + 0
  });

  it('includes selling price in net_pl for sold products', () => {
    const result = computeProductPL({
      costPrice: 1000,
      sellingPrice: 500,
      variableCost: 100,
      orderItems: [
        { subtotal: 290, order: { status: 'paid_locked' } },
      ],
    });
    expect(result.net_pl).toBe(-310); // 290 - 1000 - 100 + 500
  });

  it('handles null variable cost as 0', () => {
    const result = computeProductPL({
      costPrice: 1000,
      sellingPrice: 0,
      variableCost: null,
      orderItems: [
        { subtotal: 290, order: { status: 'finished' } },
      ],
    });
    expect(result.variable_cost_per_rental).toBe(0);
    expect(result.total_variable_cost).toBe(0);
    expect(result.gross_profit).toBe(290);
    expect(result.net_pl).toBe(-710);
  });
});

describe('computeProductROI', () => {
  it('uses finance transactions when available', () => {
    const result = computeProductROI({
      costPrice: 1000,
      variableCost: 100,
      orderItems: [
        { subtotal: 290, order: { status: 'paid_locked' } },
      ],
      financeTransactions: [
        { txType: 'rental_revenue', amount: 290 },
      ],
    });
    expect(result.total_revenue).toBe(290);
    expect(result.total_expenses).toBe(100); // VC only
    expect(result.net_profit).toBe(-810); // 290 - 100 - 1000
  });

  it('falls back to order subtotals when no finance transactions', () => {
    const result = computeProductROI({
      costPrice: 1000,
      variableCost: 100,
      orderItems: [
        { subtotal: 290, order: { status: 'paid_locked' } },
      ],
      financeTransactions: [],
    });
    expect(result.total_revenue).toBe(290);
    expect(result.net_profit).toBe(-810);
  });

  it('returns 0 ROI for zero cost price (not Infinity)', () => {
    const result = computeProductROI({
      costPrice: 0,
      variableCost: 0,
      orderItems: [
        { subtotal: 500, order: { status: 'finished' } },
      ],
      financeTransactions: [],
    });
    expect(result.roi).toBe(0);
    expect(Number.isFinite(result.roi)).toBe(true);
  });

  it('returns 0 revenue_per_rental for no rentals (not NaN)', () => {
    const result = computeProductROI({
      costPrice: 1000,
      variableCost: 100,
      orderItems: [],
      financeTransactions: [],
    });
    expect(result.total_rentals).toBe(0);
    expect(result.revenue_per_rental).toBe(0);
    expect(result.break_even_rentals).toBe(0);
    expect(Number.isNaN(result.revenue_per_rental)).toBe(false);
  });

  it('includes expense-type transactions in total_expenses', () => {
    const result = computeProductROI({
      costPrice: 1000,
      variableCost: 50,
      orderItems: [
        { subtotal: 500, order: { status: 'finished' } },
      ],
      financeTransactions: [
        { txType: 'rental_revenue', amount: 500 },
        { txType: 'repair', amount: -30 },
        { txType: 'shipping', amount: -20 },
      ],
    });
    // expenses = |repair| + |shipping| + VC = 30 + 20 + 50 = 100
    expect(result.total_expenses).toBe(100);
    expect(result.net_profit).toBe(-600); // 500 - 100 - 1000
  });
});

describe('P/L consistency between computeProductPL and computeProductROI', () => {
  it('net_pl and net_profit agree for products without finance transactions', () => {
    const input = {
      costPrice: 1000,
      sellingPrice: 0,
      variableCost: 100,
      orderItems: [
        { subtotal: 290, order: { status: 'paid_locked' as const } },
      ],
    };

    const plResult = computeProductPL(input);
    const roiResult = computeProductROI({
      ...input,
      financeTransactions: [],
    });

    // When sellingPrice=0 and no extra expense transactions,
    // both formulas should yield the same net value
    expect(plResult.net_pl).toBe(roiResult.net_profit);
  });

  it('both handle empty orderItems consistently', () => {
    const plResult = computeProductPL({
      costPrice: 500,
      sellingPrice: 0,
      variableCost: 100,
      orderItems: [],
    });

    const roiResult = computeProductROI({
      costPrice: 500,
      variableCost: 100,
      orderItems: [],
      financeTransactions: [],
    });

    expect(plResult.rental_count).toBe(0);
    expect(roiResult.total_rentals).toBe(0);
    expect(plResult.gross_profit).toBe(0);
    expect(roiResult.total_revenue).toBe(0);
  });
});
