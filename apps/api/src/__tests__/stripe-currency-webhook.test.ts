/**
 * Currency conversion verification in Stripe webhook handlers.
 *
 * Stripe sends amounts in satang (smallest THB unit: 1 THB = 100 satang).
 * The DB stores amounts in whole THB.
 *
 * These tests verify that:
 * 1. checkout.session.completed stores rental_revenue from order.subtotal (BUG-232 fix)
 *    and deposit_received from order.deposit (not from session.amount_total)
 * 2. charge.refunded stores amount_refunded correctly (satang → THB)
 * 3. Full/partial refund comparison works with satang values
 * 4. Edge cases: small amounts, large amounts, round-trip values
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { processWebhookEvent, type StripeEvent } from '../lib/stripe-webhook';
import { createMockDb, MOCK_ORDER } from './helpers/mock-db';
import { thbToSatang, satangToThb } from '../lib/stripe-currency';

function makeEvent(overrides: Partial<StripeEvent>): StripeEvent {
  return {
    id: `evt_currency_${Date.now()}`,
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_cur',
        client_reference_id: MOCK_ORDER.id,
        payment_intent: 'pi_test_cur',
        amount_total: 660000,
        metadata: { order_id: MOCK_ORDER.id },
      },
    },
    ...overrides,
  };
}

describe('Stripe webhook currency conversion', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    // Default: event not seen, order is unpaid
    db.stripeWebhookEvent.findUnique.mockResolvedValue(null);
    db.stripeWebhookEvent.create.mockResolvedValue({ id: 'test', status: 'received' });
    db.stripeWebhookEvent.update.mockResolvedValue({ id: 'test' });
    db.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'unpaid', items: [] });
    db.$transaction.mockImplementation(async (ops: unknown[]) => {
      for (const op of ops) await op;
    });
    db.financeTransaction.create.mockResolvedValue({ id: 'ft_test' });
    db.order.update.mockResolvedValue({});
    db.orderStatusLog.create.mockResolvedValue({});
    db.stripeWebhookEvent.findMany.mockResolvedValue([]);
  });

  describe('checkout.session.completed — BUG-232: uses order.subtotal not amount_total', () => {
    const testCases = [
      { subtotal: 1000, deposit: 200, satang: 120000, label: 'subtotal=1000, deposit=200' },
      { subtotal: 3500, deposit: 3000, satang: 660000, label: 'mock order (subtotal=3500, deposit=3000)' },
      { subtotal: 290, deposit: 0, satang: 29000, label: 'zero-deposit rental' },
      { subtotal: 1500, deposit: 500, satang: 200000, label: 'subtotal=1500, deposit=500' },
      { subtotal: 6600, deposit: 2000, satang: 860000, label: 'subtotal=6600, deposit=2000' },
      { subtotal: 10000, deposit: 3000, satang: 1300000, label: 'large order' },
      { subtotal: 99999, deposit: 10000, satang: 10999900, label: 'max order' },
    ];

    for (const { subtotal, deposit, satang, label } of testCases) {
      it(`records rental_revenue=${subtotal} THB (not ${satang / 100} from amount_total) — ${label}`, async () => {
        db.stripeWebhookEvent.findUnique.mockResolvedValue(null);
        db.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'unpaid', items: [], subtotal, deposit });

        const event = makeEvent({
          id: `evt_checkout_${satang}`,
          data: {
            object: {
              id: `cs_${satang}`,
              client_reference_id: MOCK_ORDER.id,
              payment_intent: `pi_${satang}`,
              amount_total: satang,
              metadata: { order_id: MOCK_ORDER.id },
            },
          },
        });

        await processWebhookEvent(db as never, event);

        // BUG-232: rental_revenue uses order.subtotal (not satangToThb(amount_total))
        expect(db.financeTransaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              txType: 'rental_revenue',
              amount: subtotal,
            }),
          }),
        );

        // BUG-232: deposit_received recorded separately if deposit > 0
        if (deposit > 0) {
          expect(db.financeTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                txType: 'deposit_received',
                amount: deposit,
              }),
            }),
          );
        }
      });
    }
  });

  describe('charge.refunded — amount_refunded conversion', () => {
    const refundCases = [
      { thb: 100, satang: 10000, label: '100 THB partial refund' },
      { thb: 1500, satang: 150000, label: '1,500 THB partial refund' },
      { thb: 6600, satang: 660000, label: '6,600 THB full refund' },
    ];

    for (const { thb, satang, label } of refundCases) {
      it(`converts ${label}: -${satang} satang → -${thb} THB in ledger`, async () => {
        db.stripeWebhookEvent.findUnique.mockResolvedValue(null);
        db.stripeWebhookEvent.findFirst.mockResolvedValue({ orderId: MOCK_ORDER.id });
        db.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'paid_locked' });

        const event = makeEvent({
          id: `evt_refund_${satang}`,
          type: 'charge.refunded',
          data: {
            object: {
              id: `ch_${satang}`,
              payment_intent: 'pi_test_cur',
              amount: 660000, // original charge in satang
              amount_refunded: satang,
              metadata: {},
            },
          },
        });

        await processWebhookEvent(db as never, event);

        expect(db.financeTransaction.create).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              amount: -thb, // negative THB
              txType: 'rental_revenue',
            }),
          }),
        );
      });
    }
  });

  describe('full vs partial refund comparison (satang-level)', () => {
    it('detects full refund and cancels order', async () => {
      db.stripeWebhookEvent.findUnique.mockResolvedValue(null);
      db.stripeWebhookEvent.findFirst.mockResolvedValue({ orderId: MOCK_ORDER.id });
      db.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'paid_locked' });

      const event = makeEvent({
        id: 'evt_full_refund',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_full',
            payment_intent: 'pi_test_cur',
            amount: 660000, // 6600 THB
            amount_refunded: 660000, // full refund
            metadata: {},
          },
        },
      });

      await processWebhookEvent(db as never, event);

      // Should cancel the order via $transaction
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('does not cancel on partial refund', async () => {
      db.stripeWebhookEvent.findUnique.mockResolvedValue(null);
      db.stripeWebhookEvent.findFirst.mockResolvedValue({ orderId: MOCK_ORDER.id });
      db.order.findUnique.mockResolvedValue({ ...MOCK_ORDER, status: 'paid_locked' });

      const event = makeEvent({
        id: 'evt_partial_refund',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_partial',
            payment_intent: 'pi_test_cur',
            amount: 660000, // 6600 THB
            amount_refunded: 330000, // 3300 THB = partial
            metadata: {},
          },
        },
      });

      await processWebhookEvent(db as never, event);

      // Should NOT cancel (only financeTransaction created)
      expect(db.$transaction).not.toHaveBeenCalled();
      // But should still record the refund
      expect(db.financeTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            amount: -3300, // satangToThb(330000) = 3300 THB
          }),
        }),
      );
    });
  });

  describe('round-trip consistency', () => {
    it('thbToSatang → satangToThb preserves value for typical order amounts', () => {
      const amounts = [1, 50, 100, 290, 500, 1500, 3000, 6600, 10000, 50000, 99999];
      for (const thb of amounts) {
        expect(satangToThb(thbToSatang(thb))).toBe(thb);
      }
    });

    it('handles zero amount correctly', () => {
      expect(satangToThb(0)).toBe(0);
      expect(thbToSatang(0)).toBe(0);
    });
  });
});
