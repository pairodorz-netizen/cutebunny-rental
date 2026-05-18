import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCheckoutSession } from '../lib/stripe-checkout';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('createCheckoutSession', () => {
  const MOCK_KEY = 'sk_test_fake_key';
  const DEFAULT_PARAMS = {
    orderId: '550e8400-e29b-41d4-a716-446655440000',
    orderNumber: 'ORD-26050001',
    totalAmount: 1500, // THB
    successUrl: 'https://example.com/success',
    cancelUrl: 'https://example.com/cancel',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a checkout session with correct parameters', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 'cs_test_abc123',
        url: 'https://checkout.stripe.com/pay/cs_test_abc123',
      }),
    });

    const result = await createCheckoutSession(MOCK_KEY, DEFAULT_PARAMS);

    expect(result).toEqual({
      sessionId: 'cs_test_abc123',
      url: 'https://checkout.stripe.com/pay/cs_test_abc123',
    });

    // Verify fetch was called with correct params
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(options.method).toBe('POST');
    expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');

    // Verify body params
    const body = new URLSearchParams(options.body);
    expect(body.get('mode')).toBe('payment');
    expect(body.get('client_reference_id')).toBe(DEFAULT_PARAMS.orderId);
    expect(body.get('currency')).toBe('thb');
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('150000'); // 1500 THB × 100
    expect(body.get('line_items[0][price_data][product_data][name]')).toBe('Order ORD-26050001');
    expect(body.get('metadata[order_id]')).toBe(DEFAULT_PARAMS.orderId);
    expect(body.get('metadata[order_number]')).toBe('ORD-26050001');
    expect(body.get('payment_intent_data[metadata][order_id]')).toBe(DEFAULT_PARAMS.orderId);
    expect(body.get('success_url')).toBe(DEFAULT_PARAMS.successUrl);
    expect(body.get('cancel_url')).toBe(DEFAULT_PARAMS.cancelUrl);
  });

  it('converts THB to satang correctly', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/x' }),
    });

    await createCheckoutSession(MOCK_KEY, { ...DEFAULT_PARAMS, totalAmount: 290 });

    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('29000'); // 290 × 100
  });

  it('includes customer_email when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/x' }),
    });

    await createCheckoutSession(MOCK_KEY, {
      ...DEFAULT_PARAMS,
      customerEmail: 'test@example.com',
    });

    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
    expect(body.get('customer_email')).toBe('test@example.com');
  });

  it('omits customer_email when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/x' }),
    });

    await createCheckoutSession(MOCK_KEY, DEFAULT_PARAMS);

    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
    expect(body.has('customer_email')).toBe(false);
  });

  it('throws on Stripe API error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { message: 'Invalid API key provided' },
      }),
    });

    await expect(
      createCheckoutSession(MOCK_KEY, DEFAULT_PARAMS),
    ).rejects.toThrow('Stripe API error: Invalid API key provided');
  });

  it('handles edge case amounts', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/x' }),
    });

    // Minimum realistic order: 1 THB
    await createCheckoutSession(MOCK_KEY, { ...DEFAULT_PARAMS, totalAmount: 1 });
    const body = new URLSearchParams(mockFetch.mock.calls[0][1].body);
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('100');
  });

  it('uses Basic auth with Stripe secret key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'cs_test_abc', url: 'https://checkout.stripe.com/x' }),
    });

    await createCheckoutSession(MOCK_KEY, DEFAULT_PARAMS);

    const authHeader = mockFetch.mock.calls[0][1].headers.Authorization;
    expect(authHeader).toBe(`Basic ${btoa(MOCK_KEY + ':')}`);
  });
});
