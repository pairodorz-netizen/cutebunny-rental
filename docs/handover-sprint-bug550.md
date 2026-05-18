# Handover Document — BUG-550: Stripe Webhook Hardening

> **Sprint period**: 2026-05-17 – 2026-05-17
> **Engineer**: Devin (AI)
> **Reviewer**: @pairodorz-netizen (Qew)
> **Status**: PR merged, pending production infra setup (migration + secrets)

---

## Table of Contents

1. [Task Summary](#task-summary)
2. [PR Registry](#pr-registry)
3. [Architecture](#architecture)
4. [Implementation Details](#implementation-details)
5. [Event Handlers](#event-handlers)
6. [Database Schema](#database-schema)
7. [Test Coverage](#test-coverage)
8. [Post-Merge Checklist](#post-merge-checklist)
9. [Runbook](#runbook)
10. [Open Risks & Follow-ups](#open-risks--follow-ups)
11. [Files Changed](#files-changed)

---

## Task Summary

Built a production-ready Stripe webhook handler for the CuteBunny Rental payment flow. Previously the system only supported bank transfer + manual payment slip verification. This implementation adds automated payment confirmation via Stripe webhooks with:

- **Signature verification**: HMAC SHA-256 using Web Crypto API (Cloudflare Workers compatible)
- **Idempotency**: Deduplication via `stripe_webhook_events` table with unique `stripe_event_id`
- **Out-of-order handling**: Buffers `payment_intent.succeeded` as `PENDING_ORDER` when it arrives before `checkout.session.completed`
- **5 event types**: checkout.session.completed/expired, payment_intent.succeeded/failed, charge.refunded
- **Observability**: Structured JSON logging + consecutive failure alerting (threshold=3)
- **Incident runbook**: `docs/runbooks/stripe-webhook-incident.md`

---

## PR Registry

| # | PR | Bug | Title | Merge Commit | CI |
|---|---|---|---|---|---|
| 1 | [#209](https://github.com/pairodorz-netizen/cutebunny-rental/pull/209) | BUG-550 | Stripe webhook hardening with idempotency, out-of-order handling, and observability | `cd726d5` | 13/13 |

---

## Architecture

```
                    ┌──────────────┐
                    │   Stripe     │
                    │  Dashboard   │
                    └──────┬───────┘
                           │ POST /api/v1/webhooks/stripe
                           │ (with stripe-signature header)
                           ▼
              ┌─────────────────────────────┐
              │  Cloudflare Worker (Hono)    │
              │                             │
              │  1. Verify HMAC SHA-256 sig  │
              │  2. Check idempotency table  │
              │  3. Route to event handler   │
              │  4. DB transaction           │
              │  5. Log structured event     │
              │  6. Return 200 always        │
              └──────────┬──────────────────┘
                         │
                         ▼
              ┌──────────────────────┐
              │  Supabase PostgreSQL  │
              │                      │
              │  stripe_webhook_events│ ← idempotency
              │  orders              │ ← status transitions
              │  order_status_logs   │ ← audit trail
              │  finance_transactions│ ← revenue/refund ledger
              │  availability_calendar│ ← hold release
              └──────────────────────┘
```

**Key design decisions:**
- Endpoint is **public** (no auth middleware) — security via Stripe signature verification
- Always returns **200** to Stripe (even for processing failures) to prevent retry storms
- Failed events are tracked in `stripe_webhook_events` for manual retry
- Uses **Web Crypto API** (not Node.js `crypto`) for Cloudflare Workers compatibility

---

## Implementation Details

### Signature Verification
- Parses `stripe-signature` header for `t=` (timestamp) and `v1=` (signature)
- Rejects timestamps older than 5 minutes (clock skew tolerance)
- HMAC SHA-256 computed over `{timestamp}.{rawBody}` using `crypto.subtle`
- Constant-time string comparison to prevent timing attacks
- **Raw body** is used (not JSON-parsed) to match Stripe's signing

### Idempotency Layer
- Every webhook event is checked against `stripe_webhook_events.stripe_event_id` (unique index)
- States: `received` → `processing` → `processed` / `failed` / `pending_order`
- Duplicate events (already `processed` or `processing`) return 200 immediately
- Failed events can be retried (state reset to `processing`)

### Out-of-Order Handling
- Race condition: `payment_intent.succeeded` may arrive before `checkout.session.completed`
- When `payment_intent.succeeded` has no `order_id` in metadata, it's buffered as `PENDING_ORDER`
- When `checkout.session.completed` arrives later, it processes the order AND marks buffered events as `processed`
- Join key: `payment_intent_id` (indexed)

---

## Event Handlers

| Event | Trigger | Action | Order Transition |
|-------|---------|--------|------------------|
| `checkout.session.completed` | Customer completes Stripe Checkout | Confirm order, record revenue, process buffered events | `unpaid` → `paid_locked` |
| `checkout.session.expired` | Checkout session times out (30 min default) | Release inventory holds, cancel order | `unpaid` → `cancelled` |
| `payment_intent.succeeded` | Payment captured (backup) | Confirm order if found, otherwise buffer | `unpaid` → `paid_locked` or `PENDING_ORDER` |
| `payment_intent.payment_failed` | Card declined / payment error | Release holds, cancel order | `unpaid` → `cancelled` |
| `charge.refunded` | Refund issued via Stripe | Record negative revenue; cancel if fully refunded | `paid_locked` → `cancelled` (full refund) |

### State Machine Integration

Uses existing `state-machine.ts` `isValidTransition()` to validate all status changes:
- `unpaid` → `paid_locked` ✓ (payment confirmed)
- `unpaid` → `cancelled` ✓ (payment failed/expired)
- `paid_locked` → `cancelled` ✓ (full refund)

---

## Database Schema

### New Model: `StripeWebhookEvent`

```prisma
model StripeWebhookEvent {
  id              String   @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  stripeEventId   String   @unique @map("stripe_event_id")
  eventType       String   @map("event_type")
  payload         Json     @db.JsonB
  status          StripeWebhookEventStatus @default(received)
  orderId         String?  @map("order_id") @db.Uuid
  paymentIntentId String?  @map("payment_intent_id")
  errorMessage    String?  @map("error_message")
  processedAt     DateTime? @map("processed_at")
  retryCount      Int      @default(0) @map("retry_count")
  createdAt       DateTime @default(now()) @map("created_at")
}

enum StripeWebhookEventStatus {
  received | processing | processed | failed | pending_order
}
```

**Indexes**: `stripe_event_id` (unique), `payment_intent_id`, `status`, `created_at`

**Migration**: `20260513_200_stripe_webhook_events/migration.sql` — includes RLS enable

---

## Test Coverage

### Unit Tests (42 tests)

| Category | Tests | Coverage |
|----------|-------|----------|
| Signature verification | 8 | Valid/invalid sig, tampered body, wrong secret, expired timestamp, invalid JSON |
| Idempotency | 5 | New event, processed duplicate, processing duplicate, failed retry, pending_order |
| Event type detection | 9 | 5 handled types + 4 unhandled types |
| checkout.session.completed | 5 | Confirm order, skip paid, order not found, no order_id, process buffered |
| checkout.session.expired | 2 | Cancel unpaid, skip paid |
| payment_intent.succeeded | 2 | Confirm with metadata, buffer without metadata |
| payment_intent.payment_failed | 2 | Cancel with order_id, no-op without |
| charge.refunded | 3 | Negative finance entry, cancel full refund, skip partial refund |
| Duplicate detection | 1 | Already-processed event returns duplicate |
| Unhandled events | 1 | Skip unrecognized types |
| Observability | 3 | Structured logging, failure counter reset, alert threshold |

### E2E Tests (2 tests × 2 browsers)

| Test | Assertion |
|------|-----------|
| Webhook POST without signature | Returns 400/404/500 (not 200) |
| Webhook GET method | Returns 400+ (not allowed) |

### Full Test Suite

- **1142 tests passed** (86 test files), 0 failures
- TypeScript: 0 errors
- Lint: 0 warnings
- Schema drift guard: passed

---

## Post-Merge Checklist

> **Status: PENDING** — User chose to defer infra setup

| Step | Command | Status |
|------|---------|--------|
| 1. Run migration | `DATABASE_URL="..." npx prisma migrate deploy` | ⏳ Pending |
| 2. Set Stripe secret key | `npx wrangler secret put STRIPE_SECRET_KEY` | ⏳ Pending |
| 3. Set webhook signing secret | `npx wrangler secret put STRIPE_WEBHOOK_SECRET` | ⏳ Pending |
| 4. Configure Stripe Dashboard | Add endpoint URL + select 5 event types | ⏳ Pending |
| 5. Send test webhook | Stripe Dashboard → Send test event | ⏳ Pending |
| 6. Monitor Cloudflare logs | Watch for 15 min, check for consecutive failures | ⏳ Pending |

**Stripe Dashboard endpoint URL**: `https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/webhooks/stripe`

**Event types to enable**:
- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

---

## Runbook

Full incident response runbook at `docs/runbooks/stripe-webhook-incident.md` covers:

- Triage checklist (Stripe Dashboard → Cloudflare Logs → DB queries)
- Scenario A: Signature verification fails (wrong/missing secret)
- Scenario B: Order not found (metadata mismatch)
- Scenario C: Out-of-order events stuck (pending_order >1h)
- Scenario D: Duplicate processing (idempotency bypass)
- Scenario E: Cloudflare Worker down (Error 1101 → redeploy)
- Manual reconciliation SQL commands
- Monitoring thresholds (success rate, latency, failure counts)

---

## Open Risks & Follow-ups

### P1 — Required before going live

| Risk | Mitigation | Owner |
|------|-----------|-------|
| Migration not deployed | `stripe_webhook_events` table doesn't exist yet in production | @pairodorz-netizen |
| Stripe secrets not set | Webhook will return 500 (not configured) | @pairodorz-netizen |
| Stripe endpoint not registered | No events will be sent | @pairodorz-netizen |

### P2 — Recommended follow-ups

| Item | Description |
|------|-------------|
| External alerting | Set up Cloudflare log drain → Slack/email for `stripe_webhook_alert` events |
| Checkout session creation | Frontend integration to create Stripe Checkout sessions with `client_reference_id` = order ID |
| Customer email notifications | Send payment confirmation/failure emails (currently only logged to `notification_logs`) |
| Stripe Connect | If multiple sellers needed in the future |
| Webhook replay testing | Use Stripe CLI `stripe trigger` in CI for integration testing against real Stripe fixtures |
| Admin webhook dashboard | UI to view/retry failed webhook events from `stripe_webhook_events` table |

### P3 — Tech debt

| Item | Description |
|------|-------------|
| Alert infrastructure | In-isolate counter resets on Worker restart; need persistent failure tracking |
| Raw SQL in availability release | `releaseOrderHolds` uses simple `deleteMany` — may need multi-unit support |
| Finance ledger amount units | Stripe amounts are in cents; current code passes through as-is — verify currency handling |

---

## Files Changed

| File | Purpose |
|------|---------|
| `apps/api/src/lib/stripe-webhook.ts` | Core webhook processing logic (signature, idempotency, handlers, observability) |
| `apps/api/src/routes/webhooks/stripe.ts` | Hono route handler for `POST /api/v1/webhooks/stripe` |
| `apps/api/src/index.ts` | Route wiring (public, no auth) |
| `apps/api/src/lib/env.ts` | Added `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` to Env interface |
| `packages/shared/prisma/schema.prisma` | `StripeWebhookEvent` model + `StripeWebhookEventStatus` enum |
| `packages/shared/prisma/migrations/20260513_200_stripe_webhook_events/migration.sql` | Table creation + indexes + RLS |
| `apps/api/src/__tests__/bug-550-stripe-webhook.test.ts` | 42 unit + integration tests |
| `apps/api/src/__tests__/helpers/mock-db.ts` | Added `stripeWebhookEvent` model + `$transaction` + `deleteMany` to mock |
| `tests/e2e/admin-smoke.spec.ts` | 2 webhook endpoint smoke tests |
| `docs/runbooks/stripe-webhook-incident.md` | Incident response runbook |

---

*Previous sprint handover: [`docs/handover-sprint-bug543-549-final.md`](./handover-sprint-bug543-549-final.md)*
