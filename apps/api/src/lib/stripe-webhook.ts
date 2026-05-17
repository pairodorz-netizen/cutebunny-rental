/**
 * BUG-550: Stripe webhook processing logic.
 *
 * Single source of truth for webhook event handling:
 * - Signature verification (HMAC SHA-256)
 * - Idempotency (stripe_webhook_events table)
 * - Out-of-order buffering (PENDING_ORDER status)
 * - State machine transitions
 * - Finance ledger updates
 * - Observability logging
 */

import type { PrismaClient, OrderStatus } from '@prisma/client';
import { isValidTransition } from './state-machine';

// ─── Types ─────────────────────────────────────────────────────────────

export interface StripeEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: Record<string, unknown>;
  };
}

export interface WebhookResult {
  success: boolean;
  eventId: string;
  type: string;
  orderId?: string;
  outcome: 'processed' | 'duplicate' | 'buffered' | 'skipped' | 'failed';
  durationMs: number;
  error?: string;
}

// ─── Signature Verification ────────────────────────────────────────────

/**
 * Verify Stripe webhook signature using HMAC SHA-256.
 * MUST receive raw body (not JSON-parsed) to match Stripe's signing.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
): Promise<{ valid: boolean; event?: StripeEvent; error?: string }> {
  if (!signatureHeader || !webhookSecret) {
    return { valid: false, error: 'Missing signature or webhook secret' };
  }

  const parts = signatureHeader.split(',');
  const timestampPart = parts.find((p) => p.startsWith('t='));
  const signaturePart = parts.find((p) => p.startsWith('v1='));

  if (!timestampPart || !signaturePart) {
    return { valid: false, error: 'Invalid signature header format' };
  }

  const timestamp = timestampPart.slice(2);
  const expectedSignature = signaturePart.slice(3);

  // Reject events older than 5 minutes (tolerance for clock skew)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
    return { valid: false, error: 'Webhook timestamp too old (>5 minutes)' };
  }

  const signedPayload = `${timestamp}.${rawBody}`;

  // Use Web Crypto API (available in Cloudflare Workers)
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computedSignature = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  if (!timingSafeEqual(computedSignature, expectedSignature)) {
    return { valid: false, error: 'Signature mismatch' };
  }

  try {
    const event = JSON.parse(rawBody) as StripeEvent;
    return { valid: true, event };
  } catch {
    return { valid: false, error: 'Invalid JSON body' };
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// ─── Idempotency ───────────────────────────────────────────────────────

/**
 * Check if an event has already been processed. Returns the existing
 * record if found (idempotent), or null if this is a new event.
 */
export async function checkIdempotency(
  db: PrismaClient,
  stripeEventId: string,
): Promise<{ duplicate: boolean; existingStatus?: string }> {
  const existing = await db.stripeWebhookEvent.findUnique({
    where: { stripeEventId },
    select: { status: true },
  });

  if (!existing) return { duplicate: false };

  // Already processed or currently processing — skip
  if (existing.status === 'processed' || existing.status === 'processing') {
    return { duplicate: true, existingStatus: existing.status };
  }

  // Failed events can be retried
  if (existing.status === 'failed') {
    return { duplicate: false, existingStatus: existing.status };
  }

  return { duplicate: true, existingStatus: existing.status };
}

// ─── Event Handlers ────────────────────────────────────────────────────

const HANDLED_EVENT_TYPES = [
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'charge.refunded',
] as const;

type HandledEventType = (typeof HANDLED_EVENT_TYPES)[number];

export function isHandledEventType(type: string): type is HandledEventType {
  return (HANDLED_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Main webhook event processor. Handles idempotency, routing to
 * specific handlers, and structured logging.
 */
export async function processWebhookEvent(
  db: PrismaClient,
  event: StripeEvent,
): Promise<WebhookResult> {
  const startTime = Date.now();
  const baseResult = { eventId: event.id, type: event.type };

  // 1. Idempotency check
  const { duplicate, existingStatus } = await checkIdempotency(db, event.id);
  if (duplicate) {
    return {
      ...baseResult,
      success: true,
      outcome: 'duplicate',
      durationMs: Date.now() - startTime,
    };
  }

  // 2. Skip unhandled event types
  if (!isHandledEventType(event.type)) {
    return {
      ...baseResult,
      success: true,
      outcome: 'skipped',
      durationMs: Date.now() - startTime,
    };
  }

  // 3. Upsert event record (handles retry of failed events)
  const webhookEvent = await db.stripeWebhookEvent.upsert({
    where: { stripeEventId: event.id },
    create: {
      stripeEventId: event.id,
      eventType: event.type,
      payload: JSON.parse(JSON.stringify(event.data.object)),
      status: 'processing',
      paymentIntentId: extractPaymentIntentId(event),
    },
    update: {
      status: 'processing',
      retryCount: existingStatus === 'failed' ? { increment: 1 } : undefined,
    },
  });

  // 4. Route to specific handler
  try {
    const result = await routeEvent(db, event, webhookEvent.id);

    await db.stripeWebhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: result.outcome === 'buffered' ? 'pending_order' : 'processed',
        orderId: result.orderId ?? null,
        processedAt: new Date(),
      },
    });

    return {
      ...baseResult,
      ...result,
      durationMs: Date.now() - startTime,
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    await db.stripeWebhookEvent.update({
      where: { id: webhookEvent.id },
      data: {
        status: 'failed',
        errorMessage,
        processedAt: new Date(),
      },
    });

    return {
      ...baseResult,
      success: false,
      outcome: 'failed',
      error: errorMessage,
      durationMs: Date.now() - startTime,
    };
  }
}

function extractPaymentIntentId(event: StripeEvent): string | undefined {
  const obj = event.data.object;
  if (event.type.startsWith('payment_intent.')) {
    return obj.id as string;
  }
  if (event.type.startsWith('checkout.session.')) {
    return (obj.payment_intent as string) ?? undefined;
  }
  if (event.type === 'charge.refunded') {
    return (obj.payment_intent as string) ?? undefined;
  }
  return undefined;
}

async function routeEvent(
  db: PrismaClient,
  event: StripeEvent,
  webhookEventId: string,
): Promise<Omit<WebhookResult, 'eventId' | 'type' | 'durationMs'>> {
  switch (event.type as HandledEventType) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(db, event);
    case 'checkout.session.expired':
      return handleCheckoutExpired(db, event);
    case 'payment_intent.succeeded':
      return handlePaymentIntentSucceeded(db, event, webhookEventId);
    case 'payment_intent.payment_failed':
      return handlePaymentIntentFailed(db, event);
    case 'charge.refunded':
      return handleChargeRefunded(db, event);
  }
}

// ─── checkout.session.completed ────────────────────────────────────────

async function handleCheckoutCompleted(
  db: PrismaClient,
  event: StripeEvent,
): Promise<Omit<WebhookResult, 'eventId' | 'type' | 'durationMs'>> {
  const session = event.data.object;
  const orderId = (session.client_reference_id as string) ??
    (session.metadata as Record<string, string>)?.order_id;

  if (!orderId) {
    return { success: false, outcome: 'failed', error: 'No order_id in session metadata' };
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, orderNumber: true, customerId: true },
  });

  if (!order) {
    return { success: false, outcome: 'failed', error: `Order ${orderId} not found` };
  }

  // Only transition from unpaid → paid_locked
  if (order.status !== 'unpaid') {
    return { success: true, outcome: 'processed', orderId: order.id };
  }

  if (!isValidTransition('unpaid', 'paid_locked')) {
    return { success: false, outcome: 'failed', error: 'Invalid status transition' };
  }

  await db.$transaction([
    db.order.update({
      where: { id: order.id },
      data: { status: 'paid_locked' },
    }),
    db.orderStatusLog.create({
      data: {
        orderId: order.id,
        fromStatus: 'unpaid',
        toStatus: 'paid_locked',
        note: `Stripe checkout.session.completed (${event.id})`,
      },
    }),
    // Create finance transaction for rental revenue
    db.financeTransaction.create({
      data: {
        orderId: order.id,
        txType: 'rental_revenue',
        amount: (session.amount_total as number) ?? 0,
        note: `Stripe payment ${event.id}`,
      },
    }),
  ]);

  // Process any buffered payment_intent.succeeded events for this payment intent
  const paymentIntentId = (session.payment_intent as string) ?? undefined;
  if (paymentIntentId) {
    await processBufferedEvents(db, paymentIntentId);
  }

  return { success: true, outcome: 'processed', orderId: order.id };
}

// ─── checkout.session.expired ──────────────────────────────────────────

async function handleCheckoutExpired(
  db: PrismaClient,
  event: StripeEvent,
): Promise<Omit<WebhookResult, 'eventId' | 'type' | 'durationMs'>> {
  const session = event.data.object;
  const orderId = (session.client_reference_id as string) ??
    (session.metadata as Record<string, string>)?.order_id;

  if (!orderId) {
    return { success: true, outcome: 'processed' };
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { productId: true } },
    },
  });

  if (!order || order.status !== 'unpaid') {
    return { success: true, outcome: 'processed', orderId: order?.id };
  }

  // Release tentative holds and cancel the order
  await releaseOrderHolds(db, order);

  await db.$transaction([
    db.order.update({
      where: { id: order.id },
      data: { status: 'cancelled' },
    }),
    db.orderStatusLog.create({
      data: {
        orderId: order.id,
        fromStatus: 'unpaid',
        toStatus: 'cancelled',
        note: `Stripe checkout.session.expired (${event.id})`,
      },
    }),
  ]);

  return { success: true, outcome: 'processed', orderId: order.id };
}

// ─── payment_intent.succeeded ──────────────────────────────────────────

async function handlePaymentIntentSucceeded(
  db: PrismaClient,
  event: StripeEvent,
  webhookEventId: string,
): Promise<Omit<WebhookResult, 'eventId' | 'type' | 'durationMs'>> {
  const paymentIntent = event.data.object;
  const paymentIntentId = paymentIntent.id as string;
  const orderId = (paymentIntent.metadata as Record<string, string>)?.order_id;

  // If we can find the order directly from metadata, confirm it
  if (orderId) {
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });

    if (order && order.status === 'unpaid') {
      await db.$transaction([
        db.order.update({
          where: { id: order.id },
          data: { status: 'paid_locked' },
        }),
        db.orderStatusLog.create({
          data: {
            orderId: order.id,
            fromStatus: 'unpaid',
            toStatus: 'paid_locked',
            note: `Stripe payment_intent.succeeded (${event.id}) — backup confirmation`,
          },
        }),
      ]);
      return { success: true, outcome: 'processed', orderId: order.id };
    }

    // Order already paid or not found — no-op
    return { success: true, outcome: 'processed', orderId: order?.id };
  }

  // Out-of-order: no order_id yet — buffer for later processing
  // when checkout.session.completed arrives with the payment_intent_id
  await db.stripeWebhookEvent.update({
    where: { id: webhookEventId },
    data: {
      status: 'pending_order',
      paymentIntentId,
    },
  });

  return { success: true, outcome: 'buffered' };
}

// ─── payment_intent.payment_failed ─────────────────────────────────────

async function handlePaymentIntentFailed(
  db: PrismaClient,
  event: StripeEvent,
): Promise<Omit<WebhookResult, 'eventId' | 'type' | 'durationMs'>> {
  const paymentIntent = event.data.object;
  const orderId = (paymentIntent.metadata as Record<string, string>)?.order_id;

  if (!orderId) {
    return { success: true, outcome: 'processed' };
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { select: { productId: true } },
    },
  });

  if (!order || order.status !== 'unpaid') {
    return { success: true, outcome: 'processed', orderId: order?.id };
  }

  // Release tentative holds
  await releaseOrderHolds(db, order);

  await db.$transaction([
    db.order.update({
      where: { id: order.id },
      data: { status: 'cancelled' },
    }),
    db.orderStatusLog.create({
      data: {
        orderId: order.id,
        fromStatus: 'unpaid',
        toStatus: 'cancelled',
        note: `Stripe payment_intent.payment_failed (${event.id}) — ${(paymentIntent.last_payment_error as Record<string, string>)?.message ?? 'unknown error'}`,
      },
    }),
  ]);

  return { success: true, outcome: 'processed', orderId: order.id };
}

// ─── charge.refunded ───────────────────────────────────────────────────

async function handleChargeRefunded(
  db: PrismaClient,
  event: StripeEvent,
): Promise<Omit<WebhookResult, 'eventId' | 'type' | 'durationMs'>> {
  const charge = event.data.object;
  const paymentIntentId = (charge.payment_intent as string) ?? undefined;

  // Find order via payment_intent_id stored in a previous webhook event
  let orderId: string | undefined;
  if (paymentIntentId) {
    const linkedEvent = await db.stripeWebhookEvent.findFirst({
      where: {
        paymentIntentId,
        orderId: { not: null },
        status: 'processed',
      },
      select: { orderId: true },
    });
    orderId = linkedEvent?.orderId ?? undefined;
  }

  // Fall back to charge metadata
  if (!orderId) {
    orderId = (charge.metadata as Record<string, string>)?.order_id;
  }

  if (!orderId) {
    return { success: true, outcome: 'processed' };
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, orderNumber: true },
  });

  if (!order) {
    return { success: false, outcome: 'failed', error: `Order ${orderId} not found for refund` };
  }

  const refundAmount = (charge.amount_refunded as number) ?? 0;

  // Record refund in finance ledger (negative revenue)
  await db.financeTransaction.create({
    data: {
      orderId: order.id,
      txType: 'rental_revenue',
      amount: -refundAmount,
      note: `Stripe charge.refunded (${event.id})`,
    },
  });

  // If fully refunded and order is paid, cancel it
  const chargeAmount = (charge.amount as number) ?? 0;
  if (refundAmount >= chargeAmount && order.status === 'paid_locked') {
    await db.$transaction([
      db.order.update({
        where: { id: order.id },
        data: { status: 'cancelled' },
      }),
      db.orderStatusLog.create({
        data: {
          orderId: order.id,
          fromStatus: order.status as OrderStatus,
          toStatus: 'cancelled',
          note: `Full refund via Stripe (${event.id})`,
        },
      }),
    ]);
  }

  return { success: true, outcome: 'processed', orderId: order.id };
}

// ─── Out-of-order buffer processing ────────────────────────────────────

/**
 * After checkout.session.completed arrives, check for buffered
 * payment_intent.succeeded events that we couldn't process before.
 */
async function processBufferedEvents(
  db: PrismaClient,
  paymentIntentId: string,
): Promise<void> {
  const bufferedEvents = await db.stripeWebhookEvent.findMany({
    where: {
      paymentIntentId,
      status: 'pending_order',
    },
  });

  for (const buffered of bufferedEvents) {
    await db.stripeWebhookEvent.update({
      where: { id: buffered.id },
      data: { status: 'processed', processedAt: new Date() },
    });
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────

async function releaseOrderHolds(
  db: PrismaClient,
  order: { id: string; items: Array<{ productId: string }> },
): Promise<void> {
  // Release all tentative/booked holds for this order
  await db.availabilityCalendar.deleteMany({
    where: {
      orderId: order.id,
      slotStatus: { in: ['tentative', 'booked'] },
    },
  });
}

// ─── Observability ─────────────────────────────────────────────────────

export function logWebhookEvent(result: WebhookResult): void {
  console.log(JSON.stringify({
    type: 'stripe_webhook',
    eventId: result.eventId,
    eventType: result.type,
    orderId: result.orderId ?? null,
    outcome: result.outcome,
    success: result.success,
    durationMs: result.durationMs,
    ...(result.error ? { error: result.error } : {}),
  }));
}

/** Track consecutive failures for alerting. */
let consecutiveFailures = 0;
const FAILURE_ALERT_THRESHOLD = 3;

export function trackFailureRate(result: WebhookResult): void {
  if (!result.success) {
    consecutiveFailures++;
    if (consecutiveFailures >= FAILURE_ALERT_THRESHOLD) {
      console.error(JSON.stringify({
        type: 'stripe_webhook_alert',
        alert: 'consecutive_failures',
        count: consecutiveFailures,
        lastEventId: result.eventId,
        lastError: result.error,
        message: `${consecutiveFailures} consecutive webhook failures in this isolate — investigate immediately`,
      }));
    }
  } else {
    consecutiveFailures = 0;
  }
}

export function resetFailureCounter(): void {
  consecutiveFailures = 0;
}

export function getConsecutiveFailures(): number {
  return consecutiveFailures;
}
