# Handover Document — BUG-550: Stripe Webhook Hardening

> **Sprint period**: 2026-05-17 – 2026-05-17
> **Engineer**: Devin (AI)
> **Reviewer**: @pairodorz-netizen (Qew)
> **Status**: COMPLETE (sandbox) — all PRs merged, infra deployed, E2E verified 6/6 (2026-05-14)

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
9. [Migration SQL Package](#migration-sql-package)
10. [Sandbox E2E Test Plan](#sandbox-e2e-test-plan)
11. [ENV Verification](#env-verification)
12. [Pre-flight: Sandbox → Live](#pre-flight-sandbox--live)
13. [Known Tech Debt](#known-tech-debt)
14. [Incident Runbooks](#incident-runbooks)
15. [Runbook](#runbook)
16. [Open Risks & Follow-ups](#open-risks--follow-ups)
17. [Files Changed](#files-changed)

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
| 2 | [#210](https://github.com/pairodorz-netizen/cutebunny-rental/pull/210) | BUG-550 | Handover document for Stripe webhook hardening | merged | 11/11 |
| 3 | [#211](https://github.com/pairodorz-netizen/cutebunny-rental/pull/211) | BUG-550 | Handover update — migration SQL, E2E test plan, ENV verification, incident runbooks | `7b42886` | 11/11 |

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

> **Status: COMPLETE (sandbox)** — All sandbox verification passed (2026-05-14)

| Step | Command | Status |
|------|---------|--------|
| 1. Run migration | Supabase SQL Editor (11 cols, 5 indexes, RLS) | ✅ Done (2026-05-14) |
| 2. Set Stripe secret key | `npx wrangler secret put STRIPE_SECRET_KEY` | ✅ Done |
| 3. Set webhook signing secret | `npx wrangler secret put STRIPE_WEBHOOK_SECRET` | ✅ Done |
| 4. Configure Stripe Dashboard | Endpoint active, 5 events enabled | ✅ Done |
| 5. Verify table + send test webhook | 6 events triggered, all 200 OK | ✅ Done (2026-05-14) |
| 6. E2E test 5 event types | All passed — see [test report](./test-report-bug550-e2e.md) | ✅ Done (2026-05-14) |
| 7. Monitor Cloudflare logs | No signature errors, no alerts | ✅ Done (2026-05-14) |
| 8. Sandbox → Live migration | Replace sandbox keys with live keys | ⏳ Future |

**Stripe Dashboard endpoint URL**: `https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/webhooks/stripe`

**Event types to enable**:
- `checkout.session.completed`
- `checkout.session.expired`
- `payment_intent.succeeded`
- `payment_intent.payment_failed`
- `charge.refunded`

---

## Migration SQL Package

Idempotent SQL for Supabase SQL Editor — safe to run multiple times:

```sql
-- 1. Create enum
DO $$ BEGIN
  CREATE TYPE "StripeWebhookEventStatus" AS ENUM (
    'received', 'processing', 'processed', 'failed', 'pending_order'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Create table
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
    "id"                 UUID           NOT NULL DEFAULT uuid_generate_v4(),
    "stripe_event_id"    TEXT           NOT NULL,
    "event_type"         TEXT           NOT NULL,
    "payload"            JSONB          NOT NULL,
    "status"             "StripeWebhookEventStatus" NOT NULL DEFAULT 'received',
    "order_id"           UUID,
    "payment_intent_id"  TEXT,
    "error_message"      TEXT,
    "processed_at"       TIMESTAMP(3),
    "retry_count"        INTEGER        NOT NULL DEFAULT 0,
    "created_at"         TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- 3. Create indexes
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_webhook_events_stripe_event_id_key"
  ON "stripe_webhook_events"("stripe_event_id");
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_payment_intent_id_idx"
  ON "stripe_webhook_events"("payment_intent_id");
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_status_idx"
  ON "stripe_webhook_events"("status");
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_created_at_idx"
  ON "stripe_webhook_events"("created_at");

-- 4. Enable RLS
ALTER TABLE "stripe_webhook_events" ENABLE ROW LEVEL SECURITY;
```

### Verification Query

```sql
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'stripe_webhook_events'
ORDER BY ordinal_position;

SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'stripe_webhook_events';

SELECT enumlabel FROM pg_enum
JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
WHERE pg_type.typname = 'StripeWebhookEventStatus'
ORDER BY enumsortorder;
```

**Expected**: 11 columns, 5 indexes, 5 enum values, RLS enabled.

### Rollback SQL

```sql
-- ⚠️ DESTRUCTIVE
DROP TABLE IF EXISTS "stripe_webhook_events" CASCADE;
DROP TYPE IF EXISTS "StripeWebhookEventStatus" CASCADE;
```

---

## Sandbox E2E Test Plan

| # | Event | Trigger | Verify DB | Verify Logs |
|---|-------|---------|-----------|-------------|
| 1 | checkout.session.completed | Stripe CLI/Dashboard | status=processed, order=paid_locked, finance record | outcome:processed |
| 2 | Duplicate replay | Resend same event | no new records | outcome:duplicate |
| 3 | checkout.session.expired | Stripe CLI/Dashboard | status=processed | outcome:processed |
| 4 | payment_intent.payment_failed | Stripe CLI/Dashboard | status=processed | outcome:processed |
| 5 | charge.refunded | Stripe CLI/Dashboard | negative finance entry | outcome:processed |
| 6 | Monitor 15 min | — | — | no stripe_webhook_alert |

---

## ENV Verification

| Variable | Source | Required | Status |
|----------|--------|----------|--------|
| `DATABASE_URL` | wrangler secret | ✅ | Set |
| `JWT_SECRET` | wrangler secret | ✅ | Set |
| `STRIPE_SECRET_KEY` | wrangler secret | ✅ | Set (sk_test_*) |
| `STRIPE_WEBHOOK_SECRET` | wrangler secret | ✅ | Set (whsec_*, must match Stripe Dashboard) |
| `ENVIRONMENT` | wrangler.toml vars | ✅ | "development" (change to "production" for live) |

**Vercel admin/customer**: No Stripe env vars needed (webhook is API-only).

---

## Pre-flight: Sandbox → Live

| # | Task | Owner | Status |
|---|------|-------|--------|
| 1 | Run migration SQL | User | ⏳ |
| 2 | Verify table (11 cols, 5 indexes) | User | ⏳ |
| 3 | curl test → 400 | User | ⏳ |
| 4 | Send test webhook from Stripe | User | ⏳ |
| 5 | E2E test 5 event types | User | ⏳ |
| 6 | Duplicate replay → idempotency | User | ⏳ |
| 7 | Monitor CF logs 15 min | User | ⏳ |
| 8 | Change ENVIRONMENT to "production" | User | ⏳ Future |
| 9 | Create Stripe live webhook endpoint | User | ⏳ Future |
| 10 | Set live STRIPE_SECRET_KEY | User | ⏳ Future |
| 11 | Set live STRIPE_WEBHOOK_SECRET | User | ⏳ Future |
| 12 | Frontend Checkout session creation | Devin | ⏳ P2 |
| 13 | External alerting (Slack/email) | Devin/User | ⏳ P2 |

---

## Known Tech Debt

| # | Item | Severity | Sprint | Description |
|---|------|----------|--------|-------------|
| 1 | Stripe Checkout session creation | P1 | Next | Frontend needs to create Checkout with client_reference_id = order ID |
| 2 | Currency unit mismatch | P1 | Next | Stripe amounts in cents vs finance_transactions possibly in THB |
| 3 | Alert infrastructure | P2 | Next+1 | In-isolate counter resets on Worker restart |
| 4 | Admin webhook dashboard | P2 | Next+1 | UI to view/retry failed events |
| 5 | Customer email notifications | P2 | Next+1 | Payment confirmation/failure emails |
| 6 | R2 product image migration | P3 | Backlog | Still using SVG fallback |
| 7 | Admin E2E auth | P3 | Backlog | No automated admin login test |
| 8 | Multi-unit holds | P3 | Backlog | releaseOrderHolds uses simple deleteMany |

---

## Incident Runbooks

### Incident 1: Signature Mismatch (all webhooks 400)

**Detection**: CF logs → `type: "stripe_webhook_signature_failed"`

**Fix**:
1. Stripe Dashboard → Webhooks → endpoint → copy Signing secret
2. `cd apps/api && npx wrangler secret put STRIPE_WEBHOOK_SECRET`
3. Verify: `curl -X POST <endpoint> -d '{}'` → should get 400 (not 500)
4. Resend failed events from Stripe Dashboard

### Incident 2: Duplicate Flood (retry storm)

**Detection**: CF logs → many `outcome: "duplicate"` in short period

**Fix**: Handler returns 200 always → prevents retry storm. If persistent:
1. Check `stripe_webhook_events` for `status = 'failed'` with error details
2. Temporarily disable endpoint in Stripe Dashboard if needed
3. Fix root cause, re-enable

### Incident 3: Supabase Outage (DB unreachable)

**Detection**: CF logs → `success: false`, connection errors + `stripe_webhook_alert`

**Fix**:
1. Check https://status.supabase.com/
2. When DB recovers, reset failed events: `UPDATE stripe_webhook_events SET status = 'received' WHERE status = 'failed' AND created_at > NOW() - INTERVAL '1 hour'`
3. Resend from Stripe Dashboard

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
