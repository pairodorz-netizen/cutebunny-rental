/**
 * BUG-550: Stripe Webhook Hardening — unit + integration tests
 *
 * Covers:
 * - Signature verification (HMAC SHA-256, timing, format)
 * - Idempotency layer (duplicate detection, retry of failed events)
 * - Out-of-order event buffering
 * - All 5 event type handlers (checkout.session.completed/expired,
 *   payment_intent.succeeded/failed, charge.refunded)
 * - State machine transitions (unpaid → paid_locked, unpaid → cancelled)
 * - Finance ledger entries
 * - Observability (structured logging, failure tracking)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  verifyStripeSignature,
  checkIdempotency,
  processWebhookEvent,
  isHandledEventType,
  logWebhookEvent,
  trackFailureRate,
  resetFailureCounter,
  getConsecutiveFailures,
  type StripeEvent,
  type WebhookResult,
} from '../lib/stripe-webhook';
import { createMockDb, MOCK_ORDER } from './helpers/mock-db';

// ─── Helpers ───────────────────────────────────────────────────────────

function makeStripeEvent(overrides: Partial<StripeEvent> = {}): StripeEvent {
  return {
    id: 'evt_test_123',
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_123',
        client_reference_id: MOCK_ORDER.id,
        payment_intent: 'pi_test_456',
        amount_total: 660000, // 6600 THB in satang
        metadata: { order_id: MOCK_ORDER.id },
      },
    },
    ...overrides,
  };
}

async function createValidSignature(
  body: string,
  secret: string,
  timestamp?: number,
): Promise<string> {
  const ts = timestamp ?? Math.floor(Date.now() / 1000);
  const signedPayload = `${ts}.${body}`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${ts},v1=${hex}`;
}

// ─── Signature Verification ────────────────────────────────────────────

describe('verifyStripeSignature', () => {
  const secret = 'whsec_test_secret_123';

  it('accepts valid signature', async () => {
    const body = JSON.stringify(makeStripeEvent());
    const sig = await createValidSignature(body, secret);
    const result = await verifyStripeSignature(body, sig, secret);
    expect(result.valid).toBe(true);
    expect(result.event).toBeDefined();
    expect(result.event!.id).toBe('evt_test_123');
  });

  it('rejects missing signature header', async () => {
    const result = await verifyStripeSignature('{}', '', secret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing signature');
  });

  it('rejects missing webhook secret', async () => {
    const result = await verifyStripeSignature('{}', 't=123,v1=abc', '');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Missing signature');
  });

  it('rejects invalid signature header format', async () => {
    const result = await verifyStripeSignature('{}', 'invalid-format', secret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid signature header format');
  });

  it('rejects tampered body', async () => {
    const body = JSON.stringify(makeStripeEvent());
    const sig = await createValidSignature(body, secret);
    const result = await verifyStripeSignature(body + 'tampered', sig, secret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Signature mismatch');
  });

  it('rejects wrong secret', async () => {
    const body = JSON.stringify(makeStripeEvent());
    const sig = await createValidSignature(body, 'wrong_secret');
    const result = await verifyStripeSignature(body, sig, secret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Signature mismatch');
  });

  it('rejects timestamps older than 5 minutes', async () => {
    const body = JSON.stringify(makeStripeEvent());
    const oldTimestamp = Math.floor(Date.now() / 1000) - 400;
    const sig = await createValidSignature(body, secret, oldTimestamp);
    const result = await verifyStripeSignature(body, sig, secret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('too old');
  });

  it('accepts timestamps within 5-minute window', async () => {
    const body = JSON.stringify(makeStripeEvent());
    const recentTimestamp = Math.floor(Date.now() / 1000) - 60;
    const sig = await createValidSignature(body, secret, recentTimestamp);
    const result = await verifyStripeSignature(body, sig, secret);
    expect(result.valid).toBe(true);
  });

  it('rejects invalid JSON body even with valid signature', async () => {
    const body = 'not-json{{{';
    const sig = await createValidSignature(body, secret);
    const result = await verifyStripeSignature(body, sig, secret);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid JSON');
  });
});

// ─── Idempotency ───────────────────────────────────────────────────────

describe('checkIdempotency', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
  });

  it('returns duplicate=false for new event', async () => {
    db.stripeWebhookEvent.findUnique.mockResolvedValue(null);
    const result = await checkIdempotency(db as never, 'evt_new');
    expect(result.duplicate).toBe(false);
  });

  it('returns duplicate=true for processed event', async () => {
    db.stripeWebhookEvent.findUnique.mockResolvedValue({ status: 'processed' });
    const result = await checkIdempotency(db as never, 'evt_done');
    expect(result.duplicate).toBe(true);
    expect(result.existingStatus).toBe('processed');
  });

  it('returns duplicate=true for processing event', async () => {
    db.stripeWebhookEvent.findUnique.mockResolvedValue({ status: 'processing' });
    const result = await checkIdempotency(db as never, 'evt_in_progress');
    expect(result.duplicate).toBe(true);
  });

  it('allows retry of failed events', async () => {
    db.stripeWebhookEvent.findUnique.mockResolvedValue({ status: 'failed' });
    const result = await checkIdempotency(db as never, 'evt_failed');
    expect(result.duplicate).toBe(false);
    expect(result.existingStatus).toBe('failed');
  });

  it('returns duplicate=true for pending_order events', async () => {
    db.stripeWebhookEvent.findUnique.mockResolvedValue({ status: 'pending_order' });
    const result = await checkIdempotency(db as never, 'evt_buffered');
    expect(result.duplicate).toBe(true);
  });
});

// ─── Event Type Detection ──────────────────────────────────────────────

describe('isHandledEventType', () => {
  it.each([
    'checkout.session.completed',
    'checkout.session.expired',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.refunded',
  ])('recognizes %s', (type) => {
    expect(isHandledEventType(type)).toBe(true);
  });

  it.each([
    'customer.created',
    'invoice.paid',
    'charge.succeeded',
    'random.event',
  ])('rejects %s', (type) => {
    expect(isHandledEventType(type)).toBe(false);
  });
});

// ─── Integration: processWebhookEvent ──────────────────────────────────

describe('processWebhookEvent', () => {
  let db: ReturnType<typeof createMockDb>;

  beforeEach(() => {
    db = createMockDb();
    // Default: no existing event (not duplicate)
    db.stripeWebhookEvent.findUnique.mockResolvedValue(null);
    db.stripeWebhookEvent.upsert.mockResolvedValue({
      id: 'whe-1',
      stripeEventId: 'evt_test_123',
      status: 'processing',
    });
  });

  describe('checkout.session.completed', () => {
    it('transitions unpaid order to paid_locked', async () => {
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'unpaid',
      });
      db.stripeWebhookEvent.findMany.mockResolvedValue([]); // no buffered events

      const event = makeStripeEvent();
      const result = await processWebhookEvent(db as never, event);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('processed');
      expect(result.orderId).toBe(MOCK_ORDER.id);
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('skips already-paid order (idempotent)', async () => {
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'paid_locked',
      });

      const event = makeStripeEvent();
      const result = await processWebhookEvent(db as never, event);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('processed');
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('fails if order not found', async () => {
      db.order.findUnique.mockResolvedValue(null);

      const event = makeStripeEvent();
      const result = await processWebhookEvent(db as never, event);

      expect(result.success).toBe(false);
      expect(result.outcome).toBe('failed');
      expect(result.error).toContain('not found');
    });

    it('fails if no order_id in session', async () => {
      const event = makeStripeEvent({
        data: {
          object: {
            id: 'cs_test_123',
            client_reference_id: null,
            metadata: {},
          },
        },
      });

      const result = await processWebhookEvent(db as never, event);
      expect(result.success).toBe(false);
      expect(result.error).toContain('No order_id');
    });

    it('processes buffered events after checkout completes', async () => {
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'unpaid',
      });
      const bufferedEvent = { id: 'buffered-1', status: 'pending_order' };
      db.stripeWebhookEvent.findMany.mockResolvedValue([bufferedEvent]);

      const event = makeStripeEvent();
      await processWebhookEvent(db as never, event);

      // Should update the buffered event to processed
      expect(db.stripeWebhookEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'buffered-1' },
          data: expect.objectContaining({ status: 'processed' }),
        }),
      );
    });
  });

  describe('checkout.session.expired', () => {
    it('cancels unpaid order and releases holds', async () => {
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'unpaid',
        items: [{ productId: 'prod-1' }],
      });

      const event = makeStripeEvent({
        id: 'evt_expired_1',
        type: 'checkout.session.expired',
      });
      const result = await processWebhookEvent(db as never, event);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('processed');
      expect(db.availabilityCalendar.deleteMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            orderId: MOCK_ORDER.id,
            slotStatus: { in: ['tentative', 'booked'] },
          }),
        }),
      );
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('skips already-paid order', async () => {
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'paid_locked',
        items: [],
      });

      const event = makeStripeEvent({
        id: 'evt_expired_2',
        type: 'checkout.session.expired',
      });
      const result = await processWebhookEvent(db as never, event);

      expect(result.success).toBe(true);
      expect(db.availabilityCalendar.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('payment_intent.succeeded', () => {
    it('confirms order when metadata has order_id', async () => {
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'unpaid',
      });

      const event = makeStripeEvent({
        id: 'evt_pi_success_1',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_456',
            metadata: { order_id: MOCK_ORDER.id },
          },
        },
      });
      const result = await processWebhookEvent(db as never, event);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('processed');
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('buffers event when no order_id available (out-of-order)', async () => {
      const event = makeStripeEvent({
        id: 'evt_pi_ooo',
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_test_999',
            metadata: {},
          },
        },
      });
      const result = await processWebhookEvent(db as never, event);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('buffered');
    });
  });

  describe('payment_intent.payment_failed', () => {
    it('cancels unpaid order and releases holds', async () => {
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'unpaid',
        items: [{ productId: 'prod-1' }],
      });

      const event = makeStripeEvent({
        id: 'evt_pi_fail_1',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_fail',
            metadata: { order_id: MOCK_ORDER.id },
            last_payment_error: { message: 'Card declined' },
          },
        },
      });
      const result = await processWebhookEvent(db as never, event);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('processed');
      expect(db.availabilityCalendar.deleteMany).toHaveBeenCalled();
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('no-op when no order_id', async () => {
      const event = makeStripeEvent({
        id: 'evt_pi_fail_2',
        type: 'payment_intent.payment_failed',
        data: {
          object: {
            id: 'pi_test_orphan',
            metadata: {},
          },
        },
      });
      const result = await processWebhookEvent(db as never, event);
      expect(result.success).toBe(true);
      expect(result.outcome).toBe('processed');
    });
  });

  describe('charge.refunded', () => {
    it('creates negative finance transaction for refund', async () => {
      // Link via previous processed event
      db.stripeWebhookEvent.findFirst.mockResolvedValue({
        orderId: MOCK_ORDER.id,
      });
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'paid_locked',
      });

      const event = makeStripeEvent({
        id: 'evt_refund_1',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_refund',
            payment_intent: 'pi_test_456',
            amount: 660000, // 6600 THB in satang
            amount_refunded: 660000, // 6600 THB in satang
            metadata: {},
          },
        },
      });
      const result = await processWebhookEvent(db as never, event);

      expect(result.success).toBe(true);
      expect(result.outcome).toBe('processed');
      // Negative amount in finance ledger (converted from satang to THB)
      expect(db.financeTransaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orderId: MOCK_ORDER.id,
            txType: 'rental_revenue',
            amount: -6600, // satangToThb(660000) = 6600 THB
          }),
        }),
      );
    });

    it('cancels fully-refunded paid_locked order', async () => {
      db.stripeWebhookEvent.findFirst.mockResolvedValue({
        orderId: MOCK_ORDER.id,
      });
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'paid_locked',
      });

      const event = makeStripeEvent({
        id: 'evt_refund_full',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_refund',
            payment_intent: 'pi_test_456',
            amount: 660000, // 6600 THB in satang
            amount_refunded: 660000, // 6600 THB in satang (full refund)
            metadata: {},
          },
        },
      });
      await processWebhookEvent(db as never, event);
      expect(db.$transaction).toHaveBeenCalled();
    });

    it('does not cancel partially-refunded order', async () => {
      db.stripeWebhookEvent.findFirst.mockResolvedValue({
        orderId: MOCK_ORDER.id,
      });
      db.order.findUnique.mockResolvedValue({
        ...MOCK_ORDER,
        status: 'paid_locked',
      });

      const event = makeStripeEvent({
        id: 'evt_refund_partial',
        type: 'charge.refunded',
        data: {
          object: {
            id: 'ch_test_refund_p',
            payment_intent: 'pi_test_456',
            amount: 660000, // 6600 THB in satang
            amount_refunded: 100000, // 1000 THB in satang (partial refund)
            metadata: {},
          },
        },
      });
      await processWebhookEvent(db as never, event);
      // $transaction should only be called for full refund
      expect(db.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('duplicate event detection', () => {
    it('returns duplicate for already-processed event', async () => {
      db.stripeWebhookEvent.findUnique.mockResolvedValue({ status: 'processed' });

      const event = makeStripeEvent({ id: 'evt_duplicate' });
      const result = await processWebhookEvent(db as never, event);

      expect(result.outcome).toBe('duplicate');
      expect(result.success).toBe(true);
    });
  });

  describe('unhandled event types', () => {
    it('skips unrecognized event types', async () => {
      const event = makeStripeEvent({
        id: 'evt_unknown',
        type: 'customer.created',
      });
      const result = await processWebhookEvent(db as never, event);

      expect(result.outcome).toBe('skipped');
      expect(result.success).toBe(true);
      expect(db.stripeWebhookEvent.upsert).not.toHaveBeenCalled();
    });
  });
});

// ─── Observability ─────────────────────────────────────────────────────

describe('Observability', () => {
  beforeEach(() => {
    resetFailureCounter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('logWebhookEvent', () => {
    it('logs structured JSON', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result: WebhookResult = {
        success: true,
        eventId: 'evt_1',
        type: 'checkout.session.completed',
        orderId: 'order-1',
        outcome: 'processed',
        durationMs: 42,
      };
      logWebhookEvent(result);
      expect(consoleSpy).toHaveBeenCalledOnce();
      const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logged.type).toBe('stripe_webhook');
      expect(logged.eventId).toBe('evt_1');
      expect(logged.outcome).toBe('processed');
      expect(logged.durationMs).toBe(42);
    });
  });

  describe('trackFailureRate', () => {
    it('resets counter on success', () => {
      trackFailureRate({ success: false, eventId: 'e1', type: 't', outcome: 'failed', durationMs: 1 });
      trackFailureRate({ success: true, eventId: 'e2', type: 't', outcome: 'processed', durationMs: 1 });
      expect(getConsecutiveFailures()).toBe(0);
    });

    it('alerts after 3 consecutive failures', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const fail: WebhookResult = { success: false, eventId: 'e', type: 't', outcome: 'failed', durationMs: 1, error: 'boom' };

      trackFailureRate(fail);
      trackFailureRate(fail);
      expect(consoleSpy).not.toHaveBeenCalled();

      trackFailureRate(fail);
      expect(consoleSpy).toHaveBeenCalled();
      const logged = JSON.parse(consoleSpy.mock.calls[0][0]);
      expect(logged.type).toBe('stripe_webhook_alert');
      expect(logged.count).toBe(3);
    });
  });
});
