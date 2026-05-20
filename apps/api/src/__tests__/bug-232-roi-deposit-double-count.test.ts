import { describe, it, expect } from 'vitest';
import { computeProductROI, REVENUE_TX_TYPES, EXPENSE_TX_TYPES } from '../lib/pl-calc';

/**
 * BUG-232: ROI report double-counts deposits as revenue.
 *
 * Root cause: Payment confirmation recorded total amount (which includes
 * deposit + delivery fee) as 'rental_revenue'. This inflated revenue and
 * made ROI calculations incorrect.
 *
 * Fix: Use order.subtotal (rental only) for rental_revenue transaction.
 * Record deposit separately as deposit_received (liability, not revenue).
 *
 * Acceptance criteria:
 * - ROI calculation does NOT include deposit_received in numerator
 * - Test: rental_revenue=1000, deposit=200 → ROI uses 1000 not 1200
 * - Cross-check with BUG-220 (deposit_returned cap) — consistent
 * - deposit_forfeited IS revenue (customer forfeits = business income)
 */

describe('BUG-232: ROI deposit double-count fix', () => {
  describe('REVENUE_TX_TYPES classification', () => {
    it('does NOT include deposit_received', () => {
      expect((REVENUE_TX_TYPES as readonly string[]).includes('deposit_received')).toBe(false);
    });

    it('does NOT include deposit_returned', () => {
      expect((REVENUE_TX_TYPES as readonly string[]).includes('deposit_returned')).toBe(false);
    });

    it('DOES include deposit_forfeited (forfeited deposit is genuine revenue)', () => {
      expect((REVENUE_TX_TYPES as readonly string[]).includes('deposit_forfeited')).toBe(true);
    });

    it('includes rental_revenue, late_fee, damage_fee, force_buy', () => {
      expect((REVENUE_TX_TYPES as readonly string[]).includes('rental_revenue')).toBe(true);
      expect((REVENUE_TX_TYPES as readonly string[]).includes('late_fee')).toBe(true);
      expect((REVENUE_TX_TYPES as readonly string[]).includes('damage_fee')).toBe(true);
      expect((REVENUE_TX_TYPES as readonly string[]).includes('force_buy')).toBe(true);
    });
  });

  describe('EXPENSE_TX_TYPES classification', () => {
    it('does NOT include deposit_received or deposit_returned', () => {
      expect((EXPENSE_TX_TYPES as readonly string[]).includes('deposit_received')).toBe(false);
      expect((EXPENSE_TX_TYPES as readonly string[]).includes('deposit_returned')).toBe(false);
    });
  });

  describe('computeProductROI — deposit exclusion', () => {
    it('rental_revenue=1000, deposit_received=200 → uses only 1000 for revenue', () => {
      const result = computeProductROI({
        costPrice: 2000,
        variableCost: 50,
        orderItems: [
          { subtotal: 1000, order: { status: 'finished' } },
        ],
        financeTransactions: [
          { txType: 'rental_revenue', amount: 1000 },
          { txType: 'deposit_received', amount: 200 }, // should be IGNORED
        ],
      });

      expect(result.total_revenue).toBe(1000); // not 1200
      expect(result.purchase_cost).toBe(2000);
      // net_profit = 1000 - (50) - 2000 = -1050
      expect(result.net_profit).toBe(1000 - 50 - 2000);
    });

    it('deposit_returned is also excluded from revenue AND expenses', () => {
      const result = computeProductROI({
        costPrice: 1000,
        variableCost: 0,
        orderItems: [
          { subtotal: 500, order: { status: 'finished' } },
        ],
        financeTransactions: [
          { txType: 'rental_revenue', amount: 500 },
          { txType: 'deposit_received', amount: 200 },
          { txType: 'deposit_returned', amount: 200 }, // should be IGNORED
        ],
      });

      expect(result.total_revenue).toBe(500);
      expect(result.total_expenses).toBe(0); // deposit_returned not counted as expense
    });

    it('deposit_forfeited IS counted as revenue (customer forfeits)', () => {
      const result = computeProductROI({
        costPrice: 1000,
        variableCost: 0,
        orderItems: [
          { subtotal: 500, order: { status: 'finished' } },
        ],
        financeTransactions: [
          { txType: 'rental_revenue', amount: 500 },
          { txType: 'deposit_forfeited', amount: 200 }, // IS revenue
        ],
      });

      expect(result.total_revenue).toBe(700); // 500 + 200
    });

    it('zero-deposit edge case — no deposit_received tx present', () => {
      const result = computeProductROI({
        costPrice: 1000,
        variableCost: 100,
        orderItems: [
          { subtotal: 800, order: { status: 'finished' } },
        ],
        financeTransactions: [
          { txType: 'rental_revenue', amount: 800 },
          // No deposit transactions at all
        ],
      });

      expect(result.total_revenue).toBe(800);
      expect(result.total_expenses).toBe(100); // just variable cost
      expect(result.net_profit).toBe(800 - 100 - 1000); // -300
    });

    it('multiple rentals with mixed deposits — revenue correct', () => {
      const result = computeProductROI({
        costPrice: 3000,
        variableCost: 50,
        orderItems: [
          { subtotal: 1000, order: { status: 'finished' } },
          { subtotal: 1200, order: { status: 'shipped' } },
          { subtotal: 800, order: { status: 'returned' } },
        ],
        financeTransactions: [
          { txType: 'rental_revenue', amount: 1000 },
          { txType: 'deposit_received', amount: 200 },
          { txType: 'rental_revenue', amount: 1200 },
          { txType: 'deposit_received', amount: 300 },
          { txType: 'rental_revenue', amount: 800 },
          { txType: 'deposit_received', amount: 150 },
          { txType: 'deposit_returned', amount: 200 },
          { txType: 'deposit_returned', amount: 150 },
        ],
      });

      // Only rental_revenue counts: 1000 + 1200 + 800 = 3000
      expect(result.total_revenue).toBe(3000);
      // Deposits (200 + 300 + 150 received, 200 + 150 returned) are ALL ignored
      expect(result.total_rentals).toBe(3);
      // expenses = variable_cost × 3 rentals = 150
      expect(result.total_expenses).toBe(150);
    });

    it('BUG-232 specific repro: payment amount_total was 1200 but rental is 1000', () => {
      // Before fix: rental_revenue was recorded as 1200 (amount_total including deposit)
      // After fix: rental_revenue = 1000 (order.subtotal), deposit_received = 200

      // With the fix applied:
      const result = computeProductROI({
        costPrice: 5000,
        variableCost: 100,
        orderItems: [
          { subtotal: 1000, order: { status: 'paid_locked' } },
        ],
        financeTransactions: [
          { txType: 'rental_revenue', amount: 1000 }, // correct: order.subtotal
          { txType: 'deposit_received', amount: 200 }, // separate: not revenue
        ],
      });

      expect(result.total_revenue).toBe(1000);
      expect(result.roi).toBeLessThan(0); // still losing money on first rental
      expect(result.revenue_per_rental).toBe(1000);

      // Contrast: if bug was still present (old behavior with amount_total = 1200)
      const buggyResult = computeProductROI({
        costPrice: 5000,
        variableCost: 100,
        orderItems: [
          { subtotal: 1000, order: { status: 'paid_locked' } },
        ],
        financeTransactions: [
          { txType: 'rental_revenue', amount: 1200 }, // BUG: included deposit
        ],
      });

      // Buggy version over-reports revenue by 200
      expect(buggyResult.total_revenue).toBe(1200);
      expect(buggyResult.total_revenue).toBeGreaterThan(result.total_revenue);
    });
  });
});
