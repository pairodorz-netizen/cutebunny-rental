# Stripe Webhook Incident Runbook

**Owner**: Engineering Team
**Last updated**: 2026-05-13 (BUG-550 sprint)

---

## Overview

This runbook covers debugging and recovery when Stripe webhooks fail to process correctly. The webhook handler lives at `POST /api/v1/webhooks/stripe` on the Cloudflare Worker API.

## Architecture

```
Stripe → POST /api/v1/webhooks/stripe → Cloudflare Worker
  1. Signature verification (HMAC SHA-256)
  2. Idempotency check (stripe_webhook_events table)
  3. Event routing → handler per event type
  4. DB transaction (order status + finance ledger)
  5. Return 200 (always, to prevent Stripe retry storms)
```

### Handled Event Types

| Event | Action |
|-------|--------|
| `checkout.session.completed` | Confirm order (unpaid → paid_locked), record revenue |
| `checkout.session.expired` | Cancel order, release inventory holds |
| `payment_intent.succeeded` | Backup confirmation (if checkout event missed) |
| `payment_intent.payment_failed` | Cancel order, release holds, notify customer |
| `charge.refunded` | Record negative revenue, cancel if fully refunded |

---

## Triage Checklist

### 1. Check Stripe Dashboard

1. Go to [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks)
2. Find the failing endpoint
3. Check **Event delivery** tab:
   - `200` responses = webhook received OK
   - `400` = signature verification failed
   - `500` = server error (check Worker logs)
4. Note the event ID(s) that failed

### 2. Check Cloudflare Worker Logs

```bash
# Via Cloudflare dashboard:
# Workers & Pages → cutebunny-api → Logs → Real-time

# Look for structured log entries:
# type: "stripe_webhook" — normal processing
# type: "stripe_webhook_signature_failed" — sig verification issue
# type: "stripe_webhook_config_error" — STRIPE_WEBHOOK_SECRET missing
# type: "stripe_webhook_alert" — 3+ consecutive failures
```

### 3. Check Idempotency Table

```sql
-- Recent webhook events
SELECT stripe_event_id, event_type, status, error_message, processed_at, retry_count
FROM stripe_webhook_events
ORDER BY created_at DESC
LIMIT 20;

-- Failed events (need investigation)
SELECT * FROM stripe_webhook_events
WHERE status = 'failed'
ORDER BY created_at DESC;

-- Buffered out-of-order events (should be rare)
SELECT * FROM stripe_webhook_events
WHERE status = 'pending_order'
AND created_at < NOW() - INTERVAL '1 hour';
```

---

## Common Scenarios

### Scenario A: Signature Verification Fails (400)

**Symptoms**: All webhooks return 400, logs show `stripe_webhook_signature_failed`

**Cause**: `STRIPE_WEBHOOK_SECRET` is wrong or missing

**Fix**:
1. Go to Stripe Dashboard → Webhooks → select endpoint → Signing secret
2. Copy the `whsec_...` value
3. Update Cloudflare Worker secret:
   ```bash
   cd apps/api
   npx wrangler secret put STRIPE_WEBHOOK_SECRET
   # Paste the signing secret
   ```
4. Redeploy: trigger via GitHub Actions "Deploy API"

### Scenario B: Order Not Found (processed with error)

**Symptoms**: `stripe_webhook_events.error_message` = "Order xxx not found"

**Cause**: Checkout session's `client_reference_id` or `metadata.order_id` doesn't match any order in DB

**Fix**:
1. Check Stripe event payload for the order reference
2. Search orders table by partial match
3. If order exists with different ID, manually update:
   ```sql
   UPDATE stripe_webhook_events
   SET status = 'failed', error_message = 'Manual: order_id corrected'
   WHERE stripe_event_id = 'evt_xxx';
   ```
4. Manually transition the order if needed (admin panel → Orders → status update)

### Scenario C: Out-of-Order Events (pending_order)

**Symptoms**: `stripe_webhook_events` has entries with `status = 'pending_order'` older than 1 hour

**Cause**: `payment_intent.succeeded` arrived before `checkout.session.completed`

**Fix**:
1. Check if the checkout session was eventually completed:
   ```sql
   SELECT * FROM stripe_webhook_events
   WHERE payment_intent_id = 'pi_xxx'
   ORDER BY created_at;
   ```
2. If checkout.session.completed exists and is processed, manually mark the pending event:
   ```sql
   UPDATE stripe_webhook_events
   SET status = 'processed', processed_at = NOW()
   WHERE id = 'xxx' AND status = 'pending_order';
   ```
3. If no checkout event exists, the session may have expired — verify in Stripe Dashboard

### Scenario D: Duplicate Processing

**Symptoms**: Order charged twice, double finance transactions

**Cause**: Idempotency layer bypassed (should not happen with current implementation)

**Investigation**:
```sql
-- Check for duplicate events with same stripe_event_id
SELECT stripe_event_id, COUNT(*)
FROM stripe_webhook_events
GROUP BY stripe_event_id
HAVING COUNT(*) > 1;

-- Check for duplicate finance transactions per order
SELECT order_id, tx_type, COUNT(*), SUM(amount)
FROM finance_transactions
WHERE tx_type = 'rental_revenue'
GROUP BY order_id, tx_type
HAVING COUNT(*) > 1;
```

### Scenario E: Cloudflare Worker Down (Error 1101)

**Symptoms**: All API requests fail, not just webhooks

**Fix**: Redeploy via GitHub Actions "Deploy API" workflow

---

## Manual Reconciliation

When automated webhook processing fails and manual intervention is needed:

### Confirm a Payment Manually

```sql
BEGIN;

-- 1. Update order status
UPDATE orders SET status = 'paid_locked', updated_at = NOW()
WHERE id = '<order_id>' AND status = 'unpaid';

-- 2. Create status log
INSERT INTO order_status_logs (order_id, from_status, to_status, note, created_at)
VALUES ('<order_id>', 'unpaid', 'paid_locked', 'Manual: webhook failed, confirmed via Stripe dashboard', NOW());

-- 3. Create finance transaction
INSERT INTO finance_transactions (order_id, tx_type, amount, note, created_at)
VALUES ('<order_id>', 'rental_revenue', <amount>, 'Manual: Stripe payment confirmed', NOW());

COMMIT;
```

### Retry a Failed Webhook

In Stripe Dashboard:
1. Go to Webhooks → Failed events
2. Click on the event
3. Click "Resend" (the idempotency layer will handle it correctly)

Or reset the event for retry:
```sql
UPDATE stripe_webhook_events
SET status = 'received', error_message = NULL, retry_count = retry_count + 1
WHERE stripe_event_id = 'evt_xxx' AND status = 'failed';
```
Then trigger a resend from Stripe Dashboard.

---

## Monitoring

### Structured Log Queries (Cloudflare)

```
# All webhook events in the last hour
type:stripe_webhook

# Failures only
type:stripe_webhook AND success:false

# Alert threshold breached
type:stripe_webhook_alert
```

### Key Metrics to Watch

| Metric | Healthy | Warning | Critical |
|--------|---------|---------|----------|
| Webhook success rate | >99% | 95-99% | <95% |
| Avg processing time | <500ms | 500ms-2s | >2s |
| Pending order events (>1h old) | 0 | 1-2 | 3+ |
| Failed events (last 24h) | 0 | 1-3 | 4+ |

### Alert Infrastructure (Follow-up)

> **Note**: As of BUG-550, alerting is implemented via structured console.error logs
> in the Cloudflare Worker. A follow-up issue should set up:
> - Cloudflare Workers → Notifications → Log alert rules
> - Or external log drain (e.g., Datadog, Grafana) for `type:stripe_webhook_alert`
> - Slack/email notification when consecutive failures >= 3

---

## Environment Variables

| Variable | Description | Where to set |
|----------|-------------|--------------|
| `STRIPE_SECRET_KEY` | Stripe API secret key | Cloudflare Worker secrets |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`) | Cloudflare Worker secrets |

Set via:
```bash
cd apps/api
npx wrangler secret put STRIPE_SECRET_KEY
npx wrangler secret put STRIPE_WEBHOOK_SECRET
```

---

## Related Files

| File | Purpose |
|------|---------|
| `apps/api/src/lib/stripe-webhook.ts` | Core webhook processing logic |
| `apps/api/src/routes/webhooks/stripe.ts` | Hono route handler |
| `apps/api/src/__tests__/bug-550-stripe-webhook.test.ts` | Unit + integration tests |
| `packages/shared/prisma/schema.prisma` | `StripeWebhookEvent` model |
| `tests/e2e/admin-smoke.spec.ts` | E2E webhook endpoint test |
