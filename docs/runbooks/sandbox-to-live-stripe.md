# Runbook: Stripe Sandbox → Live Migration

> **Last updated**: 2026-05-14 (BUG-550 closeout)
> **Owner**: Engineering Team
> **Estimated time**: 30–60 minutes
> **Risk level**: Medium (payment system change)

---

## Prerequisites

Before starting the migration:

- [ ] BUG-550 sandbox E2E tests all passed (6/6) — see `docs/test-report-bug550-e2e.md`
- [ ] `stripe_webhook_events` table exists in production Supabase
- [ ] Stripe sandbox webhook endpoint active and healthy (0 errors)
- [ ] Frontend Stripe Checkout integration complete (P1 tech debt — `client_reference_id` = order ID)
- [ ] Currency unit handling verified (Stripe cents → THB conversion if needed)

---

## Step 1: Generate Stripe Live API Keys

1. Go to [Stripe Dashboard](https://dashboard.stripe.com/)
2. Toggle from **Test mode** to **Live mode** (top-right switch)
3. Navigate to **Developers → API keys**
4. Note the **Publishable key** (`pk_live_...`) and **Secret key** (`sk_live_...`)
5. Store both keys securely (password manager)

**Security**: Never commit live keys to source code. Never share via chat/email.

---

## Step 2: Create Live Webhook Endpoint

1. Stripe Dashboard (Live mode) → **Developers → Webhooks → Add endpoint**
2. Configure:
   - **Endpoint URL**: `https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/webhooks/stripe`
   - **Events to send** (select exactly these 5):
     - `checkout.session.completed`
     - `checkout.session.expired`
     - `payment_intent.succeeded`
     - `payment_intent.payment_failed`
     - `charge.refunded`
3. Click **Add endpoint**
4. Copy the **Signing secret** (`whsec_...`) — note last 4 chars for verification

---

## Step 3: Update Cloudflare Worker Secrets

```bash
cd apps/api

# Replace sandbox key with live key
npx wrangler secret put STRIPE_SECRET_KEY
# Paste: sk_live_... (from Step 1)

# Replace sandbox signing secret with live signing secret
npx wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste: whsec_... (from Step 2)
```

**Verification**: After setting secrets, the Worker will automatically pick them up on next request (no redeploy needed for secrets-only changes).

---

## Step 4: Update ENVIRONMENT Variable

Option A: Via `wrangler.toml` (requires deploy):
```toml
[vars]
ENVIRONMENT = "production"
```

Option B: Via Cloudflare Dashboard → Workers → `cutebunny-api` → Settings → Variables → Edit `ENVIRONMENT` → `production`

---

## Step 5: Database Verification

If production uses a **separate** Supabase project from sandbox:

```sql
-- Run the idempotent migration SQL (safe to re-run)
-- See docs/handover-sprint-bug550.md → "Migration SQL Package"

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'stripe_webhook_events'
ORDER BY ordinal_position;
-- Expected: 11 columns
```

If production and sandbox share the **same** Supabase project: table already exists from sandbox migration — skip this step.

---

## Step 6: Smoke Test (Live)

### 6a. Endpoint Health Check

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/webhooks/stripe \
  -H "Content-Type: application/json" -d '{"test":true}'
# Expected: 400 (signature verification active)
```

### 6b. Stripe Test Event (Live Mode)

1. Stripe Dashboard (Live mode) → Webhooks → endpoint → **Send test event**
2. Select `checkout.session.completed` → **Send**
3. Verify response: `200 OK`

### 6c. Database Verification

```sql
SELECT stripe_event_id, event_type, status, created_at
FROM stripe_webhook_events
ORDER BY created_at DESC LIMIT 5;
-- Should see the test event with status = 'processed' or 'failed' (no real order = expected)
```

### 6d. Cloudflare Worker Logs

Dashboard → Workers & Pages → `cutebunny-api` → Logs:
- ✅ `type: "stripe_webhook"` present
- ✅ No `type: "stripe_webhook_signature_failed"` (signing secret correct)
- ✅ No `type: "stripe_webhook_config_error"` (secrets set)

---

## Step 7: Real Payment Test

1. Create a real order on the customer site
2. Complete Stripe Checkout (use a real card or Stripe test card if live mode allows)
3. Verify:

```sql
-- Order status updated
SELECT id, status, order_number FROM orders
WHERE status = 'paid_locked'
ORDER BY created_at DESC LIMIT 1;

-- Webhook event recorded
SELECT stripe_event_id, event_type, status, order_id
FROM stripe_webhook_events
WHERE event_type = 'checkout.session.completed'
ORDER BY created_at DESC LIMIT 1;

-- Finance ledger entry
SELECT * FROM finance_transactions
WHERE tx_type = 'rental_revenue'
ORDER BY created_at DESC LIMIT 1;
```

---

## Step 8: Disable Sandbox Endpoint

After live is confirmed working:

1. Stripe Dashboard → Switch to **Test mode**
2. Webhooks → select sandbox endpoint → **Delete** (or disable)

This prevents sandbox test events from polluting the production `stripe_webhook_events` table.

---

## Rollback Procedure

If issues are discovered after going live:

### Immediate (< 5 min)

```bash
cd apps/api

# Revert to sandbox keys
npx wrangler secret put STRIPE_SECRET_KEY
# Paste: sk_test_... (sandbox key)

npx wrangler secret put STRIPE_WEBHOOK_SECRET
# Paste: whsec_... (sandbox signing secret)
```

### If webhook events were processed incorrectly

```sql
-- Find events processed after cutover
SELECT * FROM stripe_webhook_events
WHERE created_at > '2026-MM-DD HH:MM:SS'  -- cutover timestamp
ORDER BY created_at;

-- Revert order status changes if needed
-- (Manually review each affected order)
UPDATE orders SET status = 'unpaid'
WHERE id IN (
  SELECT order_id FROM stripe_webhook_events
  WHERE created_at > '2026-MM-DD HH:MM:SS'
  AND event_type = 'checkout.session.completed'
  AND status = 'processed'
  AND order_id IS NOT NULL
);

-- Remove incorrect finance entries
DELETE FROM finance_transactions
WHERE note LIKE 'Stripe payment evt_%'
AND created_at > '2026-MM-DD HH:MM:SS';
```

### If Stripe Dashboard endpoint needs to be recreated

1. Delete the live endpoint
2. Re-create with the same URL and events
3. Update `STRIPE_WEBHOOK_SECRET` with the new signing secret

---

## RTO / RPO

| Metric | Target | Notes |
|--------|--------|-------|
| **RTO** (Recovery Time Objective) | **< 5 minutes** | Secret rotation is instant (no redeploy needed). Rollback = paste sandbox keys back. |
| **RPO** (Recovery Point Objective) | **0 data loss** | Webhook events are idempotent. Stripe retries failed deliveries for up to 72 hours. Any events missed during downtime can be resent from Stripe Dashboard. |
| **Detection time** | **< 15 minutes** | CF Worker structured logs + manual monitoring. Future: automated alerting via log drain. |

### Recovery scenarios

| Scenario | RTO | RPO | Action |
|----------|-----|-----|--------|
| Wrong signing secret | < 2 min | 0 | Re-copy `whsec_` from Stripe Dashboard → `wrangler secret put` |
| Wrong API key | < 2 min | 0 | Re-copy `sk_live_` → `wrangler secret put` |
| DB connection failure | Depends on Supabase | 0 | Stripe auto-retries for 72h. Reset failed events after recovery. |
| Worker down (1101) | < 5 min | 0 | Redeploy via GitHub Actions "Deploy API" |
| Need full rollback to sandbox | < 5 min | Manual review | Paste sandbox keys back + disable live endpoint |

---

## Post-Migration Checklist

- [ ] Live endpoint returning 200 for test events
- [ ] Signing secret last 4 chars match between Stripe Dashboard and CF Worker
- [ ] Real payment test completed successfully
- [ ] Order status transition verified (unpaid → paid_locked)
- [ ] Finance ledger entry created
- [ ] CF Worker logs clean (no signature errors)
- [ ] Sandbox endpoint disabled/deleted
- [ ] Team notified of live status
- [ ] Monitoring active for first 24 hours

---

*Related documents:*
- [Handover: BUG-550](../handover-sprint-bug550.md)
- [E2E Test Report](../test-report-bug550-e2e.md)
- [Stripe Webhook Incident Runbook](./stripe-webhook-incident.md)
- [ENV Verification Checklist](./env-verification-checklist.md)
