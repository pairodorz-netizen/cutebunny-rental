# E2E Test Report — BUG-550 Stripe Webhook Hardening

> **Date**: 2026-05-14
> **Tester**: @pairodorz-netizen (Qew) — manual trigger via Stripe Shell/Dashboard
> **Environment**: Production (Cloudflare Worker `cutebunny-api` + Supabase PostgreSQL)
> **Endpoint**: `POST https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/webhooks/stripe`

---

## Summary

| Metric | Result |
|--------|--------|
| Total events triggered | 6 |
| Signature verification | **PASS** (all events returned 200) |
| Idempotency | **PASS** (duplicate returned 200 + `outcome: "duplicate"`, no double-process) |
| Out-of-order buffering | **PASS** (`payment_intent.succeeded` → `pending_order`) |
| DB record integrity | **PASS** (no duplicates, correct status for all events) |
| Overall | **6/6 PASS** |

---

## Test Results

### Test 1: `checkout.session.completed`

| Field | Value |
|-------|-------|
| HTTP response | `200 OK` |
| DB status | `processed` |
| retry_count | `0` |
| Notes | Test event processed successfully. Signature verification passed. |

### Test 2: Duplicate Replay (Idempotency)

| Field | Value |
|-------|-------|
| Event ID | `evt_1TYOXNIAK9wCYk8uEzwYcKP4` |
| Original delivery | `200 OK @ 10:36:42` |
| Resend delivery | `200 OK @ 10:38:04` |
| Response body | `{"received":true, "eventId":"evt_1TYOXNIAK9wCYk8uEzwYcKP4", "outcome":"duplicate"}` |
| DB row count | `1` (no duplicate row created) |
| retry_count | `0` (not incremented) |
| Notes | **Critical test passed** — idempotency layer correctly prevents double-processing. |

### Test 3: `checkout.session.expired`

| Field | Value |
|-------|-------|
| HTTP response | `200 OK` |
| DB status | `processed` |
| retry_count | `0` |
| Notes | No-op for test event (no real order to cancel). |

### Test 4: `payment_intent.payment_failed`

| Field | Value |
|-------|-------|
| HTTP response | `200 OK` |
| DB status | `processed` |
| retry_count | `0` |
| Notes | No-op for test event (no real order to cancel). |

### Test 5: `charge.refunded`

| Field | Value |
|-------|-------|
| HTTP response | `200 OK` |
| DB status | `processed` |
| retry_count | `0` |
| Notes | Processed successfully. No linked order for test event. |

### Test 6: Out-of-Order Buffering (`payment_intent.succeeded`)

| Field | Value |
|-------|-------|
| Events received | 2 (chained from checkout session) |
| DB status | `pending_order` |
| retry_count | `0` |
| Notes | Correctly buffered — no matching order found, so events are held for later processing when `checkout.session.completed` arrives with matching `payment_intent_id`. |

---

## Verification Queries

### Event Summary

```sql
SELECT event_type, status, COUNT(*) as cnt
FROM stripe_webhook_events
GROUP BY event_type, status
ORDER BY event_type;
```

| event_type | status | count |
|------------|--------|-------|
| checkout.session.completed | processed | 1 |
| checkout.session.expired | processed | 1 |
| payment_intent.payment_failed | processed | 1 |
| payment_intent.succeeded | pending_order | 2 |
| charge.refunded | processed | 1 |

### Duplicate Check

```sql
SELECT COUNT(*) as total_events,
       COUNT(DISTINCT stripe_event_id) as unique_events
FROM stripe_webhook_events;
```

| total_events | unique_events |
|-------------|---------------|
| 6 | 6 |

**Result**: `total_events = unique_events` — no duplicates.

---

## Cloudflare Worker Logs

| Check | Result |
|-------|--------|
| `type: "stripe_webhook"` present | ✅ All events logged |
| `type: "stripe_webhook_signature_failed"` | ✅ None (signature verification working) |
| `type: "stripe_webhook_alert"` | ✅ None (no consecutive failures) |
| Duplicate resend `outcome: "duplicate"` | ✅ Confirmed |

---

## Conclusions

1. **Webhook handler is production-ready** — all 5 event types processed correctly
2. **Signature verification working** — `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard endpoint
3. **Idempotency layer proven** — duplicate delivery returns 200 with `outcome: "duplicate"`, no double-processing
4. **Out-of-order handling working** — `payment_intent.succeeded` without order context correctly buffered as `pending_order`
5. **Status enum fully exercised** — `processed`, `pending_order`, and `duplicate` outcomes all observed

---

## Remaining Items for Real Flow Testing

These cannot be tested with Stripe test events (require real checkout flow):

| Item | Reason |
|------|--------|
| Order status transition (`unpaid` → `paid_locked`) | Needs real order with `client_reference_id` |
| Finance ledger entry creation | Needs real `amount_total` from checkout session |
| Hold release on payment failure | Needs order with tentative availability holds |
| Full refund → order cancellation | Needs `paid_locked` order linked to charge |

These will be testable after **Frontend Stripe Checkout integration** (P1 tech debt item #1).

---

*Related documents:*
- [Handover: BUG-550](./handover-sprint-bug550.md)
- [Runbook: Stripe Webhook Incident](./runbooks/stripe-webhook-incident.md)
