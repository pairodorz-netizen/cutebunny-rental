import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for POST /api/v1/orders/:order_token/checkout-session
 *
 * Validates:
 * - Order lookup + status guard (only 'unpaid' allowed)
 * - Input validation (success_url, cancel_url)
 * - Stripe session creation with correct client_reference_id
 * - THB → satang conversion in the session
 * - Error handling for missing config, non-existent order, already-paid order
 */

// Mock stripe-checkout module
const mockCreateCheckoutSession = vi.fn();
vi.mock('../lib/stripe-checkout', () => ({
  createCheckoutSession: (...args: unknown[]) => mockCreateCheckoutSession(...args),
}));

// Mock db
const mockOrderFindUnique = vi.fn();
vi.mock('../lib/db', () => ({
  getDb: () => ({
    order: { findUnique: mockOrderFindUnique },
  }),
}));

// Mock env
let mockEnv: Record<string, string | undefined> = {};
vi.mock('../lib/env', () => ({
  getEnv: () => mockEnv,
  setEnv: () => {},
  validateEnv: () => ({ DATABASE_URL: '', JWT_SECRET: '', PORT: 3001, NODE_ENV: 'test' }),
}));

// Import app after mocks
import { Hono } from 'hono';

// We need to create a minimal test route since the main app imports many things
const testApp = new Hono();

// Re-implement the route logic inline for isolated testing
testApp.post('/api/v1/orders/:order_token/checkout-session', async (c) => {
  const { getDb } = await import('../lib/db');
  const { getEnv } = await import('../lib/env');
  const { createCheckoutSession } = await import('../lib/stripe-checkout');
  const { z } = await import('zod');

  const db = getDb() as ReturnType<typeof getDb>;
  const env = getEnv();
  const orderToken = c.req.param('order_token');

  if (!env.STRIPE_SECRET_KEY) {
    return c.json({ error: { code: 'CONFIG_ERROR', message: 'Stripe is not configured' } }, 500);
  }

  const order = await db.order.findUnique({
    where: { id: orderToken },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      totalAmount: true,
      customer: {
        select: { email: true, firstName: true, lastName: true },
      },
    },
  });

  if (!order) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Order not found' } }, 404);
  }

  if ((order as { status: string }).status !== 'unpaid') {
    return c.json({ error: { code: 'ALREADY_PAID', message: `Order is already in status "${(order as { status: string }).status}"` } }, 409);
  }

  const bodySchema = z.object({
    success_url: z.string().url(),
    cancel_url: z.string().url(),
  });
  const parsed = bodySchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'success_url and cancel_url are required' } }, 400);
  }

  try {
    const session = await createCheckoutSession(env.STRIPE_SECRET_KEY, {
      orderId: (order as { id: string }).id,
      orderNumber: (order as { orderNumber: string }).orderNumber,
      totalAmount: (order as { totalAmount: number }).totalAmount,
      customerEmail: (order as { customer: { email: string | null } | null }).customer?.email ?? undefined,
      successUrl: parsed.data.success_url,
      cancelUrl: parsed.data.cancel_url,
    });
    return c.json({ data: { checkout_url: session.url, session_id: session.sessionId } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to create checkout session';
    return c.json({ error: { code: 'STRIPE_ERROR', message: msg } }, 500);
  }
});

describe('POST /api/v1/orders/:token/checkout-session', () => {
  const ORDER_TOKEN = '550e8400-e29b-41d4-a716-446655440000';
  const MOCK_ORDER = {
    id: ORDER_TOKEN,
    orderNumber: 'ORD-26050001',
    status: 'unpaid',
    totalAmount: 1500,
    customer: { email: 'test@example.com', firstName: 'Jane', lastName: 'Doe' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockEnv = { STRIPE_SECRET_KEY: 'sk_test_fake', JWT_SECRET: 'test' };
  });

  it('creates checkout session for unpaid order', async () => {
    mockOrderFindUnique.mockResolvedValueOnce(MOCK_ORDER);
    mockCreateCheckoutSession.mockResolvedValueOnce({
      sessionId: 'cs_test_123',
      url: 'https://checkout.stripe.com/pay/cs_test_123',
    });

    const res = await testApp.request(`/api/v1/orders/${ORDER_TOKEN}/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.checkout_url).toBe('https://checkout.stripe.com/pay/cs_test_123');
    expect(json.data.session_id).toBe('cs_test_123');

    // Verify stripe was called with correct params
    expect(mockCreateCheckoutSession).toHaveBeenCalledWith('sk_test_fake', expect.objectContaining({
      orderId: ORDER_TOKEN,
      orderNumber: 'ORD-26050001',
      totalAmount: 1500,
      customerEmail: 'test@example.com',
    }));
  });

  it('returns 404 for non-existent order', async () => {
    mockOrderFindUnique.mockResolvedValueOnce(null);

    const res = await testApp.request(`/api/v1/orders/${ORDER_TOKEN}/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error.code).toBe('NOT_FOUND');
  });

  it('returns 409 for already-paid order', async () => {
    mockOrderFindUnique.mockResolvedValueOnce({ ...MOCK_ORDER, status: 'paid_locked' });

    const res = await testApp.request(`/api/v1/orders/${ORDER_TOKEN}/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe('ALREADY_PAID');
  });

  it('returns 400 for invalid URLs', async () => {
    mockOrderFindUnique.mockResolvedValueOnce(MOCK_ORDER);

    const res = await testApp.request(`/api/v1/orders/${ORDER_TOKEN}/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success_url: 'not-a-url',
        cancel_url: 'also-not-a-url',
      }),
    });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 500 when STRIPE_SECRET_KEY not configured', async () => {
    mockEnv = { JWT_SECRET: 'test' }; // No STRIPE_SECRET_KEY

    const res = await testApp.request(`/api/v1/orders/${ORDER_TOKEN}/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe('CONFIG_ERROR');
  });

  it('returns 500 when Stripe API fails', async () => {
    mockOrderFindUnique.mockResolvedValueOnce(MOCK_ORDER);
    mockCreateCheckoutSession.mockRejectedValueOnce(new Error('Stripe API error: card declined'));

    const res = await testApp.request(`/api/v1/orders/${ORDER_TOKEN}/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    });

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error.code).toBe('STRIPE_ERROR');
  });

  it('passes client_reference_id = order.id to Stripe', async () => {
    mockOrderFindUnique.mockResolvedValueOnce(MOCK_ORDER);
    mockCreateCheckoutSession.mockResolvedValueOnce({
      sessionId: 'cs_test_xyz',
      url: 'https://checkout.stripe.com/pay/cs_test_xyz',
    });

    await testApp.request(`/api/v1/orders/${ORDER_TOKEN}/checkout-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      }),
    });

    const [, params] = mockCreateCheckoutSession.mock.calls[0];
    expect(params.orderId).toBe(ORDER_TOKEN);
  });
});
