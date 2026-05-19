/**
 * BUG-550: Stripe webhook endpoint.
 *
 * POST /api/v1/webhooks/stripe
 *
 * Receives raw body for signature verification.
 * Public endpoint — no auth middleware (Stripe signs the request).
 */

import { Hono } from 'hono';
import { getDb } from '../../lib/db';
import { getEnv } from '../../lib/env';
import {
  verifyStripeSignature,
  processWebhookEvent,
  logWebhookEvent,
  trackFailureRate,
} from '../../lib/stripe-webhook';
import {
  trackWebhookFailure,
  type WebhookAlertKV,
} from '../../lib/webhook-alert';

const stripeWebhooks = new Hono();

stripeWebhooks.post('/', async (c) => {
  const startTime = Date.now();
  const env = getEnv();

  // 1. Validate Stripe configuration
  if (!env.STRIPE_WEBHOOK_SECRET) {
    console.error(JSON.stringify({
      type: 'stripe_webhook_config_error',
      error: 'STRIPE_WEBHOOK_SECRET not configured',
    }));
    return c.json({ error: 'Webhook not configured' }, 500);
  }

  // 2. Get raw body for signature verification
  const rawBody = await c.req.text();
  const signatureHeader = c.req.header('stripe-signature') ?? '';

  // 3. Verify signature
  const { valid, event, error: verifyError } = await verifyStripeSignature(
    rawBody,
    signatureHeader,
    env.STRIPE_WEBHOOK_SECRET,
  );

  if (!valid || !event) {
    console.error(JSON.stringify({
      type: 'stripe_webhook_signature_failed',
      error: verifyError,
      durationMs: Date.now() - startTime,
    }));
    return c.json({ error: verifyError ?? 'Invalid signature' }, 400);
  }

  // 4. Process the event
  const db = getDb();
  const result = await processWebhookEvent(db, event);

  // 5. Log and track
  logWebhookEvent(result);
  trackFailureRate(result);

  // 6. Persistent failure tracking + alert dispatch (KV-backed)
  const alertKv = (c.env as { WEBHOOK_ALERT_KV?: WebhookAlertKV } | undefined)
    ?.WEBHOOK_ALERT_KV;
  await trackWebhookFailure(alertKv, result, env.WEBHOOK_ALERT_URL);

  // 7. Always return 200 to Stripe (even for processing failures)
  // to prevent Stripe from retrying the same broken event endlessly.
  // Failed events are tracked in stripe_webhook_events for manual retry.
  return c.json({
    received: true,
    eventId: result.eventId,
    outcome: result.outcome,
  });
});

export default stripeWebhooks;
