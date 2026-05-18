/**
 * Stripe Checkout Session creation via REST API.
 *
 * Uses fetch() directly (no Stripe SDK) for Cloudflare Workers compatibility.
 * Creates a Checkout Session linked to an existing order via client_reference_id.
 */

import { thbToSatang, STRIPE_CURRENCY } from './stripe-currency';

const STRIPE_API_BASE = 'https://api.stripe.com/v1';

export interface CheckoutSessionParams {
  orderId: string;
  orderNumber: string;
  totalAmount: number; // THB (database unit)
  customerEmail?: string;
  customerName?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSessionResult {
  sessionId: string;
  url: string;
}

/**
 * Create a Stripe Checkout Session for an existing order.
 *
 * The session uses `client_reference_id` = order.id so the webhook
 * handler can link checkout.session.completed → order without extra lookup.
 */
export async function createCheckoutSession(
  stripeSecretKey: string,
  params: CheckoutSessionParams,
): Promise<CheckoutSessionResult> {
  const amountInSatang = thbToSatang(params.totalAmount);

  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('client_reference_id', params.orderId);
  body.set('success_url', params.successUrl);
  body.set('cancel_url', params.cancelUrl);
  body.set('currency', STRIPE_CURRENCY);
  body.set('line_items[0][price_data][currency]', STRIPE_CURRENCY);
  body.set('line_items[0][price_data][unit_amount]', String(amountInSatang));
  body.set('line_items[0][price_data][product_data][name]', `Order ${params.orderNumber}`);
  body.set('line_items[0][quantity]', '1');
  body.set('metadata[order_id]', params.orderId);
  body.set('metadata[order_number]', params.orderNumber);
  body.set('payment_intent_data[metadata][order_id]', params.orderId);
  body.set('payment_intent_data[metadata][order_number]', params.orderNumber);

  if (params.customerEmail) {
    body.set('customer_email', params.customerEmail);
  }

  const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${btoa(stripeSecretKey + ':')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const data = await response.json() as Record<string, unknown>;

  if (!response.ok) {
    const errMsg = (data.error as Record<string, unknown>)?.message ?? 'Unknown Stripe error';
    throw new Error(`Stripe API error: ${errMsg}`);
  }

  return {
    sessionId: data.id as string,
    url: data.url as string,
  };
}
