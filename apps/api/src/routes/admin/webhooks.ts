/**
 * Admin webhook failure monitoring endpoints.
 *
 * GET  /api/v1/admin/webhooks/failures — current failure state (KV/memory)
 * POST /api/v1/admin/webhooks/failures/reset — reset failure counters
 * GET  /api/v1/admin/webhooks/events — list webhook events from DB
 * GET  /api/v1/admin/webhooks/events/:id — single event with full payload
 * POST /api/v1/admin/webhooks/events/:id/retry — reprocess a failed event
 */

import { Hono } from 'hono';
import { getDb } from '../../lib/db';
import { processWebhookEvent, type StripeEvent } from '../../lib/stripe-webhook';
import {
  getFailureState,
  resetFailureState,
  type WebhookAlertKV,
} from '../../lib/webhook-alert';

const adminWebhooks = new Hono();

// GET /failures — current alert state from KV (or in-memory fallback)
adminWebhooks.get('/failures', async (c) => {
  const kv = (c.env as { WEBHOOK_ALERT_KV?: WebhookAlertKV } | undefined)
    ?.WEBHOOK_ALERT_KV;

  const state = await getFailureState(kv);

  return c.json({
    data: {
      consecutiveFailures: state.consecutiveFailures,
      hourlyFailures: state.hourlyFailures.length,
      lastFailure: state.lastFailure,
      lastAlertSentAt: state.lastAlertSentAt,
      backend: kv ? 'kv' : 'memory',
      hourlyDetails: state.hourlyFailures,
    },
  });
});

// POST /failures/reset — clear failure counters
adminWebhooks.post('/failures/reset', async (c) => {
  const kv = (c.env as { WEBHOOK_ALERT_KV?: WebhookAlertKV } | undefined)
    ?.WEBHOOK_ALERT_KV;

  await resetFailureState(kv);

  return c.json({ data: { reset: true } });
});

// GET /events — list webhook events from DB with filters
adminWebhooks.get('/events', async (c) => {
  const db = getDb();
  const status = c.req.query('status'); // filter by status
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  const where: Record<string, unknown> = {};
  if (status) {
    where.status = status;
  }

  const [events, total] = await Promise.all([
    db.stripeWebhookEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
      select: {
        id: true,
        stripeEventId: true,
        eventType: true,
        status: true,
        orderId: true,
        paymentIntentId: true,
        errorMessage: true,
        processedAt: true,
        retryCount: true,
        createdAt: true,
      },
    }),
    db.stripeWebhookEvent.count({ where }),
  ]);

  return c.json({
    data: events,
    pagination: { total, limit, offset },
  });
});

// GET /events/:id — single event with full payload
adminWebhooks.get('/events/:id', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const event = await db.stripeWebhookEvent.findUnique({
    where: { id },
  });

  if (!event) {
    return c.json({ error: 'Event not found' }, 404);
  }

  return c.json({ data: event });
});

// POST /events/:id/retry — reprocess a failed webhook event
adminWebhooks.post('/events/:id/retry', async (c) => {
  const db = getDb();
  const id = c.req.param('id');

  const event = await db.stripeWebhookEvent.findUnique({
    where: { id },
  });

  if (!event) {
    return c.json({ error: 'Event not found' }, 404);
  }

  if (event.status === 'processed') {
    return c.json({ error: 'Event already processed successfully' }, 400);
  }

  if (event.status === 'processing') {
    return c.json({ error: 'Event is currently being processed' }, 400);
  }

  // Reset status to 'received' so processWebhookEvent can pick it up
  await db.stripeWebhookEvent.update({
    where: { id },
    data: {
      status: 'received',
      errorMessage: null,
      retryCount: { increment: 1 },
    },
  });

  // Re-process the event using the stored payload
  const stripeEvent = event.payload as unknown as StripeEvent;
  const result = await processWebhookEvent(db, stripeEvent);

  return c.json({
    data: {
      eventId: event.stripeEventId,
      previousStatus: event.status,
      newStatus: result.outcome === 'processed' ? 'processed' : 'failed',
      outcome: result.outcome,
      error: result.error ?? null,
      retryCount: event.retryCount + 1,
    },
  });
});

export default adminWebhooks;
