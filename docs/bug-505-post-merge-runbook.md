# BUG-505 Post-Merge Verification Runbook

> **PR:** [#147](https://github.com/pairodorz-netizen/cutebunny-rental/pull/147) — merged to `main` at commit `53d82b3`
>
> **Date:** 2026-05-06
>
> **Scope:** Order status auto-advance via Cloudflare Scheduled Worker (hourly cron)

---

## Prerequisites

- Admin JWT token (login via admin UI or `POST /api/v1/admin/auth/login`)
- Cloudflare dashboard access (account owner)
- Supabase SQL Editor access (database verification)

### Obtain Admin JWT Token

```bash
# Replace <EMAIL> and <PASSWORD> with your admin credentials
TOKEN=$(curl -s 'https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/auth/login' \
  -H 'Content-Type: application/json' \
  -d '{"email":"<EMAIL>","password":"<PASSWORD>"}' | jq -r '.data.token')

echo $TOKEN
```

Verify token works:

```bash
curl -s 'https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/orders?limit=1' \
  -H "Authorization: Bearer $TOKEN" | jq '.data | length'
# Expected: 1
```

---

## Step 1 — Confirm Production Deploy

### 1.1 Verify API is live

```bash
curl -s 'https://cutebunny-api.cutebunny-rental.workers.dev/health' | jq .
```

**Expected:**

```json
{
  "status": "healthy",
  "timestamp": "2026-05-06T...",
  "database": "connected"
}
```

### 1.2 Verify backfill endpoint exists

```bash
curl -s -w '\nHTTP %{http_code}\n' \
  'https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/orders/backfill-auto-advance' \
  -X POST -H 'Content-Type: application/json' -d '{"dry_run":true}'
```

**Expected:** HTTP `401` with `UNAUTHORIZED` (not `404`). If you get `404`, the deploy has not completed yet — wait 5 min and retry.

### 1.3 Verify Vercel deploys (admin + customer)

Check these Vercel dashboards:

- **Admin:** https://vercel.com/pairodorz-2194s-projects/admin
- **Customer:** https://vercel.com/pairodorz-2194s-projects/customer

Both should show a deployment for commit `53d82b3` with status **Ready**.

---

## Step 2 — Confirm Cron Trigger in Cloudflare

### 2.1 Dashboard method

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to: **Workers & Pages → cutebunny-api → Triggers**
3. Under **Cron Triggers**, verify: `0 * * * *` is listed and active

### 2.2 API method (alternative)

```bash
# Replace <CF_ACCOUNT_ID> and <CF_API_TOKEN> with your Cloudflare credentials
curl -s "https://api.cloudflare.com/client/v4/accounts/<CF_ACCOUNT_ID>/workers/scripts/cutebunny-api/schedules" \
  -H "Authorization: Bearer <CF_API_TOKEN>" | jq .
```

**Expected output:**

```json
{
  "result": [
    {
      "cron": "0 * * * *",
      "created_on": "...",
      "modified_on": "..."
    }
  ],
  "success": true
}
```

**Failure indicator:** Empty `result` array or `success: false` → cron was not registered. Re-deploy via [GitHub Actions "Deploy API" workflow](https://github.com/pairodorz-netizen/cutebunny-rental/actions/workflows/deploy-api.yml) (manual trigger).

---

## Step 3 — Backfill DRY-RUN

```bash
curl -s 'https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/orders/backfill-auto-advance' \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": true}' | jq .
```

### Expected response shape

```json
{
  "data": {
    "dry_run": true,
    "orders_scanned": <number>,
    "transitions": [
      {
        "order_id": "<uuid>",
        "order_number": "ORD-26050507",
        "from_status": "paid_locked",
        "to_status": "shipped",
        "reason": "Rental started 2026-05-05, today is 2026-05-06"
      }
    ],
    "skipped": [],
    "errors": []
  }
}
```

### Verification checklist

| Check | Expected | Failure action |
|-------|----------|----------------|
| `data.dry_run` | `true` | Verify request body |
| `data.transitions` contains ORD-26050507 | `from_status: "paid_locked"`, `to_status: "shipped"` | Check order status in DB (Step 3a) |
| `data.errors` | Empty array `[]` | Investigate error messages |
| Any `returned → cleaning` transitions | `from_status: "returned"`, `to_status: "cleaning"` with buffer logic in reason | OK if none exist |
| `data.skipped` entries | Inspect reasons: `"Inventory unavailable"` or `"Legacy order"` or `"Buffer not passed"` | `legacy_returned_no_log` means old order without status log — expected |

### 3a — If ORD-26050507 is NOT in transitions, check its current status

```sql
-- Run in Supabase SQL Editor
SELECT id, order_number, status, rental_start_date, rental_end_date, updated_at
FROM orders
WHERE order_number = 'ORD-26050507';
```

If status is already `shipped` or later, the cron may have already advanced it. This is fine — proceed to Step 5 to verify.

---

## Step 4 — Backfill LIVE

> ⚠️ Only proceed if Step 3 output looks correct.

```bash
curl -s 'https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/orders/backfill-auto-advance' \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": false}' | jq .
```

### Expected response

```json
{
  "data": {
    "dry_run": false,
    "orders_scanned": <number>,
    "transitions": [
      {
        "order_id": "<uuid>",
        "order_number": "ORD-26050507",
        "from_status": "paid_locked",
        "to_status": "shipped",
        "reason": "Backfilled: rental started 2026-05-05"
      }
    ],
    "skipped": [],
    "errors": []
  }
}
```

### Verification

| Check | Expected |
|-------|----------|
| `transitions` matches dry-run output | Same orders, same transitions |
| `errors` | Empty `[]` |
| Re-running the same command | `transitions: []`, `orders_scanned: 0` (idempotent) |

### 4a — Verify idempotency

Run the same live backfill command again:

```bash
curl -s 'https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/orders/backfill-auto-advance' \
  -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"dry_run": false}' | jq .
```

**Expected:** `transitions: []` — no orders left to process. If the same orders appear again, the optimistic lock or idempotency logic has a bug.

---

## Step 5 — Verify in Admin UI

### 5.1 Admin URL

Production admin URL: `https://admin-pairodorz-2194s-projects.vercel.app`

> If you see a Vercel auth gate, use a Vercel team member account or bypass token.

### 5.2 Verify ORD-26050507 status

1. Navigate to **Orders** page
2. Search for `ORD-26050507`
3. **Expected:** Status badge shows `Shipped` (was `Paid Locked`)
4. Check derived flags: `needs_action` badge should now be absent (order is in normal flow)
5. Open order detail → **Status Log** tab should show new entry:
   - `paid_locked → shipped`
   - Note: `system-backfill: paid_locked → shipped (BUG-505)`
   - Changed by: `null` (system action)

### 5.3 Verify Calendar D013

1. Navigate to **Calendar** page
2. Find product **D013** (Bohemian Maxi Dress #1)
3. Look at date **2026-05-06**
4. **Expected:** Slot status is `booked` (not `shipping`)
5. The calendar block should reflect the order's actual `shipped` status

### 5.4 SQL verification (alternative to UI)

```sql
-- ORD-26050507 current status
SELECT o.order_number, o.status, o.rental_start_date, o.rental_end_date, o.updated_at
FROM orders o
WHERE o.order_number = 'ORD-26050507';
-- Expected: status = 'shipped'

-- Status log for ORD-26050507
SELECT osl.from_status, osl.to_status, osl.note, osl.changed_by, osl.created_at
FROM order_status_logs osl
JOIN orders o ON osl.order_id = o.id
WHERE o.order_number = 'ORD-26050507'
ORDER BY osl.created_at ASC;
-- Expected: last row shows paid_locked → shipped, note contains 'BUG-505'

-- Calendar slots for D013 around 2026-05-05 ~ 2026-05-06
SELECT ac.calendar_date, ac.slot_status, ac.order_id, o.order_number
FROM availability_calendars ac
LEFT JOIN orders o ON ac.order_id = o.id
JOIN products p ON ac.product_id = p.id
WHERE p.sku = 'D013'
  AND ac.calendar_date BETWEEN '2026-05-05' AND '2026-05-07'
ORDER BY ac.calendar_date;
-- Expected: slot_status = 'booked' for ORD-26050507's dates (not 'shipping' or 'tentative')
```

---

## Step 6 — Check First Cron Tick Logs

The cron runs every hour at `:00`. The first tick after deploy will log metrics.

### 6.1 Cloudflare Dashboard method

1. Go to: **Workers & Pages → cutebunny-api → Logs → Real-time**
2. Or use: **Workers & Pages → cutebunny-api → Observability → Logs**
3. Filter for `Cron Trigger` event type
4. Look for log line starting with:
   ```
   [scheduled] completed: {"paid_locked_to_shipped":...}
   ```

### 6.2 Wrangler tail method (CLI)

```bash
cd apps/api
npx wrangler tail cutebunny-api --format json | jq 'select(.logs[].message[] | contains("[scheduled]"))'
```

Leave this running until the next `:00` mark. You should see output like:

```json
{
  "paid_locked_to_shipped": { "processed": 0, "skipped": 0, "failed": 0 },
  "returned_to_cleaning": { "processed": 0, "skipped": 0, "failed": 0 },
  "alerts": [],
  "duration_ms": 123
}
```

### 6.3 Expected cron behavior

After the backfill has already run:

| Metric | Expected value | Notes |
|--------|---------------|-------|
| `paid_locked_to_shipped.processed` | `0` | Backfill already handled stale orders |
| `returned_to_cleaning.processed` | `0` or `N` | Depends on returned orders with passed buffer |
| `alerts` | May contain `stale_paid_locked` or `stale_shipped` | These are informational, not errors |
| `duration_ms` | `< 5000` | Should complete quickly with few orders |
| `[scheduled] fatal error:` | **Should NOT appear** | If it does, check DB connection or code error |

---

## Step 7 — Post-Merge Monitoring (First 24 Hours)

### 7.1 Dashboards to watch

| Dashboard | URL | What to look for |
|-----------|-----|-----------------|
| CF Workers Analytics | Cloudflare Dashboard → cutebunny-api → Analytics | Invocations chart should show hourly spikes (cron) |
| CF Workers Logs | Cloudflare Dashboard → cutebunny-api → Observability → Logs | `[scheduled] completed:` entries every hour |
| Supabase DB | Supabase Dashboard → SQL Editor | Run verification queries below |
| Vercel (admin) | https://vercel.com/pairodorz-2194s-projects/admin | No build errors |
| GitHub Actions | https://github.com/pairodorz-netizen/cutebunny-rental/actions/workflows/deploy-api.yml | Deploy workflow completed |

### 7.2 Expected alerts to fire

These are logged in the cron metrics JSON under `alerts[]`:

| Alert type | When it fires | Severity | Action needed |
|-----------|--------------|----------|---------------|
| `stale_paid_locked` | Order is `paid_locked` and `rental_start > today + 1d` | ⚠️ Warning | Review order — may need manual intervention |
| `stale_shipped` | Order is `shipped` and `rental_end + 7d < today` | ⚠️ Warning | Contact customer about return |
| `inventory_unavailable_at_shipping` | Product decommissioned or conflicting booking | 🚨 Error | Manual review needed — order can't auto-ship |
| `calendar_drift` | Calendar slots were out of sync with order status | ℹ️ Info | Auto-fixed by reconciliation |
| `legacy_returned_no_log` | `returned` order has no `OrderStatusLog` entry | ⚠️ Warning | Manually advance or add missing status log |

### 7.3 Monitoring SQL queries

Run these periodically in Supabase SQL Editor:

```sql
-- Active stale orders (should decrease over time)
SELECT status, COUNT(*) as count
FROM orders
WHERE status IN ('paid_locked', 'shipped', 'returned', 'cleaning')
  AND rental_end_date < CURRENT_DATE
GROUP BY status
ORDER BY status;

-- Recent auto-advance status transitions (last 24h)
SELECT osl.from_status, osl.to_status, osl.note, osl.created_at, o.order_number
FROM order_status_logs osl
JOIN orders o ON osl.order_id = o.id
WHERE osl.note LIKE '%BUG-505%'
  OR osl.note LIKE '%system-auto%'
  OR osl.note LIKE '%system-backfill%'
ORDER BY osl.created_at DESC
LIMIT 50;

-- Orders that SHOULD have been auto-advanced but weren't
-- (paid_locked with rental already started — should be 0 after backfill)
SELECT order_number, status, rental_start_date, rental_end_date
FROM orders
WHERE status = 'paid_locked'
  AND rental_start_date <= CURRENT_DATE
ORDER BY rental_start_date;

-- Calendar slots that might still be drifted
SELECT p.sku, ac.calendar_date, ac.slot_status, o.order_number, o.status as order_status
FROM availability_calendars ac
JOIN products p ON ac.product_id = p.id
LEFT JOIN orders o ON ac.order_id = o.id
WHERE o.status = 'shipped' AND ac.slot_status NOT IN ('booked')
  AND ac.calendar_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY ac.calendar_date;
```

---

## Rollback Procedure

If the backfill produced incorrect results:

### Rollback a single order

```sql
-- 1. Revert order status
UPDATE orders SET status = 'paid_locked'
WHERE order_number = 'ORD-26050507' AND status = 'shipped';

-- 2. Remove the backfill status log entry
DELETE FROM order_status_logs
WHERE order_id = (SELECT id FROM orders WHERE order_number = 'ORD-26050507')
  AND note LIKE '%system-backfill%BUG-505%';

-- 3. Revert calendar slots if needed
UPDATE availability_calendars
SET slot_status = 'tentative'
WHERE order_id = (SELECT id FROM orders WHERE order_number = 'ORD-26050507')
  AND slot_status = 'booked';
```

### Rollback all backfilled orders

```sql
-- Find all orders backfilled by BUG-505
SELECT DISTINCT o.order_number, osl.from_status, osl.to_status
FROM order_status_logs osl
JOIN orders o ON osl.order_id = o.id
WHERE osl.note LIKE '%system-backfill%BUG-505%'
ORDER BY osl.created_at;

-- Revert them (run per-order or batch):
UPDATE orders o
SET status = osl.from_status
FROM order_status_logs osl
WHERE osl.order_id = o.id
  AND osl.note LIKE '%system-backfill%BUG-505%'
  AND o.status = osl.to_status;

-- Remove backfill log entries
DELETE FROM order_status_logs
WHERE note LIKE '%system-backfill%BUG-505%';
```

### Disable cron (emergency)

If the cron is causing issues, either:

1. **Dashboard:** Cloudflare Dashboard → cutebunny-api → Triggers → Delete the cron trigger
2. **wrangler.toml:** Comment out or remove `[triggers]` section and redeploy:
   ```toml
   # [triggers]
   # crons = ["0 * * * *"]
   ```
3. **GitHub Actions:** Trigger "Deploy API" workflow manually after the wrangler.toml change

---

## Completion Checklist

| # | Step | Status | Notes |
|---|------|--------|-------|
| 1 | API health check passes | ☐ | |
| 2 | Backfill endpoint returns 401 (exists) | ☐ | |
| 3 | Cron `0 * * * *` visible in CF dashboard | ☐ | |
| 4 | Backfill dry-run shows ORD-26050507 | ☐ | |
| 5 | Backfill live succeeds | ☐ | |
| 6 | Backfill is idempotent (re-run = no-op) | ☐ | |
| 7 | ORD-26050507 status = `shipped` | ☐ | |
| 8 | Calendar D013 slot = `booked` (not `shipping`) | ☐ | |
| 9 | First cron tick logs `[scheduled] completed:` | ☐ | |
| 10 | No `[scheduled] fatal error:` in logs | ☐ | |
| 11 | 24h monitoring: no anomalies | ☐ | |
