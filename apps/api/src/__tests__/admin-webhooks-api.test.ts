/**
 * Admin webhook endpoint tests.
 *
 * Covers:
 * - GET /failures — failure state query
 * - POST /failures/reset — reset counters
 * - GET /events — list webhook events with filters
 * - GET /events/:id — single event with payload
 * - POST /events/:id/retry — reprocess a failed event
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import adminWebhooks from '../routes/admin/webhooks';
import { _resetMemoryState } from '../lib/webhook-alert';

// ─── Mock DB ───────────────────────────────────────────────────────────

const mockEvents = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    stripeEventId: 'evt_test_1',
    eventType: 'checkout.session.completed',
    status: 'processed',
    orderId: '22222222-2222-2222-2222-222222222222',
    paymentIntentId: 'pi_test_1',
    errorMessage: null,
    processedAt: new Date('2026-05-13T10:00:00Z'),
    retryCount: 0,
    createdAt: new Date('2026-05-13T09:59:00Z'),
    payload: { id: 'evt_test_1', type: 'checkout.session.completed' },
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    stripeEventId: 'evt_test_2',
    eventType: 'charge.refunded',
    status: 'failed',
    orderId: null,
    paymentIntentId: 'pi_test_2',
    errorMessage: 'Order not found',
    processedAt: null,
    retryCount: 2,
    createdAt: new Date('2026-05-13T10:05:00Z'),
    payload: { id: 'evt_test_2', type: 'charge.refunded' },
  },
];

vi.mock('../lib/db', () => ({
  getDb: () => ({
    stripeWebhookEvent: {
      findMany: vi.fn().mockResolvedValue(mockEvents),
      count: vi.fn().mockResolvedValue(mockEvents.length),
      findUnique: vi.fn().mockImplementation(({ where }: { where: { id: string } }) => {
        return Promise.resolve(mockEvents.find((e) => e.id === where.id) ?? null);
      }),
      update: vi.fn().mockResolvedValue({ retryCount: 3 }),
    },
  }),
}));

vi.mock('../lib/stripe-webhook', () => ({
  processWebhookEvent: vi.fn().mockResolvedValue({
    success: true,
    eventId: 'evt_test_2',
    type: 'charge.refunded',
    outcome: 'processed',
    durationMs: 50,
  }),
}));

// ─── App Setup ─────────────────────────────────────────────────────────

function createApp() {
  const app = new Hono();
  app.route('/webhooks', adminWebhooks);
  return app;
}

// ─── Tests ─────────────────────────────────────────────────────────────

describe('admin webhooks API', () => {
  beforeEach(() => {
    _resetMemoryState();
  });

  describe('GET /webhooks/failures', () => {
    it('returns failure state with in-memory backend', async () => {
      const app = createApp();
      const res = await app.request('/webhooks/failures');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.backend).toBe('memory');
      expect(body.data.consecutiveFailures).toBe(0);
      expect(body.data.hourlyFailures).toBe(0);
      expect(body.data.lastFailure).toBeNull();
    });
  });

  describe('POST /webhooks/failures/reset', () => {
    it('resets failure state', async () => {
      const app = createApp();
      const res = await app.request('/webhooks/failures/reset', {
        method: 'POST',
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.reset).toBe(true);
    });
  });

  describe('GET /webhooks/events', () => {
    it('returns paginated webhook events', async () => {
      const app = createApp();
      const res = await app.request('/webhooks/events');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.pagination.total).toBe(2);
      expect(body.pagination.limit).toBe(50);
      expect(body.pagination.offset).toBe(0);
    });

    it('respects limit and offset params', async () => {
      const app = createApp();
      const res = await app.request('/webhooks/events?limit=10&offset=5');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.pagination.limit).toBe(10);
      expect(body.pagination.offset).toBe(5);
    });

    it('caps limit at 200', async () => {
      const app = createApp();
      const res = await app.request('/webhooks/events?limit=999');
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.pagination.limit).toBe(200);
    });
  });

  describe('GET /webhooks/events/:id', () => {
    it('returns single event with full payload', async () => {
      const app = createApp();
      const res = await app.request(
        `/webhooks/events/${mockEvents[0].id}`,
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.stripeEventId).toBe('evt_test_1');
      expect(body.data.payload).toBeDefined();
    });

    it('returns 404 for non-existent event', async () => {
      const app = createApp();
      const res = await app.request(
        '/webhooks/events/99999999-9999-9999-9999-999999999999',
      );
      expect(res.status).toBe(404);
    });
  });

  describe('POST /webhooks/events/:id/retry', () => {
    it('retries a failed event and returns new status', async () => {
      const app = createApp();
      const res = await app.request(
        `/webhooks/events/${mockEvents[1].id}/retry`,
        { method: 'POST' },
      );
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.eventId).toBe('evt_test_2');
      expect(body.data.previousStatus).toBe('failed');
      expect(body.data.newStatus).toBe('processed');
      expect(body.data.outcome).toBe('processed');
      expect(body.data.retryCount).toBe(3);
    });

    it('rejects retry on already-processed event', async () => {
      const app = createApp();
      const res = await app.request(
        `/webhooks/events/${mockEvents[0].id}/retry`,
        { method: 'POST' },
      );
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.error).toContain('already processed');
    });

    it('returns 404 for non-existent event', async () => {
      const app = createApp();
      const res = await app.request(
        '/webhooks/events/99999999-9999-9999-9999-999999999999/retry',
        { method: 'POST' },
      );
      expect(res.status).toBe(404);
    });
  });
});
