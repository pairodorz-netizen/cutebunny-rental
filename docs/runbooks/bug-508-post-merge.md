# BUG-508 Post-Merge Verification Runbook

**PR:** #154 — Defensive resilience for audit log schema drift
**Merged to:** `main` (commit `3360e60`)
**Date:** 2026-05-09

---

## Context

BUG-508 was a production regression where `POST /api/v1/admin/products` failed
with "Could not reach the API" / `TypeError: Failed to fetch` after BUG-507
deployment. Root cause: Prisma Client expected `audit_logs.ip_address` as INET
but production DB still had TEXT (migration not applied). The fix adds:

1. Global `app.onError` handler — prevents Worker crashes on unhandled errors
2. Centralized `safeAuditLogCreate` / `safeAuditLogQuery` — degrades gracefully
   on schema drift (P2022), logs structured alerts
3. 18 audit log call sites updated across 6 route files

---

## Pre-requisites

- Admin API token: `POST /api/v1/admin/auth/login` → extract `token`
- Cloudflare dashboard access for `cutebunny-api` Worker
- Admin site access: https://admin-eight-rouge.vercel.app

---

## Step 1: Verify Worker Deploy Version ≥ 3360e60

### Cloudflare Worker

```bash
curl -s https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/health | jq .
```

**Expected:** `{ "status": "ok", ... }` — deployment timestamp after PR #154 merge.

### Vercel (admin + customer)

- Admin: https://vercel.com/pairodorz-2194s-projects/admin
- Customer: https://vercel.com/pairodorz-2194s-projects/customer

Both should show latest deployment from `main` as "Ready".

**Failure indicator:** 502/503, old deployment timestamp → trigger "Deploy API"
GitHub Action manually.

---

## Step 2: Monitor CF Worker Logs (1h post-deploy)

CF Dashboard → Workers & Pages → `cutebunny-api` → Logs

### Events to look for:

| Event | Meaning | Action |
|-------|---------|--------|
| `unhandled_error` | Global error handler caught a crash | Investigate `errorName` / `prismaCode` |
| `audit_logs_unavailable` | Audit log write/query failed gracefully | **Expected** if migration not yet applied |
| `schema_drift_detected` | P2022 on `audit_logs.ip_address` | **Expected** pre-migration; includes guidance to run `prisma migrate deploy` |

**Pre-migration expected state:**
- `audit_logs_unavailable` events WILL appear (audit log writes are degraded)
- `schema_drift_detected` alerts WILL appear (ip_address column type mismatch)
- Business operations (product creation, order editing) should succeed despite these

**Post-migration expected state:**
- All three events should stop appearing
- Audit log writes resume normally

---

## Step 3: Smoke Test — POST /admin/products

### Via admin UI:

1. Go to https://admin-eight-rouge.vercel.app/products
2. Click "Create Product" (or equivalent)
3. Fill in required fields (SKU, name, category, size, color, prices)
4. Submit

**Expected:** Product created successfully (201 response). No "Could not reach
the API" error. If migration is not yet applied, the product still creates
successfully — audit log simply degrades silently.

### Via curl:

```bash
TOKEN="<admin-jwt-token>"
curl -s -X POST https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/products \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "sku": "SMOKE-508-001",
    "name": "BUG-508 Smoke Test",
    "category": "dress",
    "size": ["M"],
    "color": ["black"],
    "rental_price_1day": 500,
    "rental_price_3day": 1200,
    "rental_price_5day": 1800,
    "variable_cost": 100,
    "cost_price": 2000
  }' | jq .
```

**Expected:** `201` with product data.
**Failure indicator:** `500` or CORS error → check Worker logs for `unhandled_error`.

> **Cleanup:** Delete the smoke test product after verification.

---

## Step 4: Smoke Test — GET /admin/orders/:id

```bash
TOKEN="<admin-jwt-token>"
# Use any known order ID
curl -s https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/orders/<ORDER_ID> \
  -H "Authorization: Bearer $TOKEN" | jq '.data.audit_logs, .data._meta'
```

**Expected (pre-migration):**
- `audit_logs: []` (empty — query degraded)
- `_meta: { warning: "audit_logs_unavailable" }` (degradation flag)
- HTTP status: `200` (NOT 500)

**Expected (post-migration):**
- `audit_logs: [...]` (populated array)
- `_meta` absent (no degradation)

---

## Step 5: Smoke Test — GET /admin/settings/audit-log

```bash
TOKEN="<admin-jwt-token>"
curl -s "https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/settings/audit-log?page=1&per_page=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[:2], .meta'
```

**Expected (pre-migration):**
- `data: []` (empty)
- `meta._meta.warning: "audit_logs_unavailable"` (degradation flag)
- HTTP status: `200`

**Expected (post-migration):**
- `data: [...]` (populated)
- No `_meta.warning`

---

## Step 6: Verify Calendar Surfaces

Test all 3 calendar surfaces still render correctly:

1. **Customer frontend:** Browse any product detail page with calendar
2. **Admin product calendar:** `GET /api/v1/admin/products/:id/calendar?year=2026&month=5`
3. **Admin master calendar:** https://admin-eight-rouge.vercel.app/calendar

**Expected:** All 3 render without errors. Calendar data is unrelated to
audit logs — these should be unaffected by BUG-508 changes.

---

## Verification Checklist

| # | Check | Status | Evidence |
|---|-------|--------|----------|
| 1 | Worker deploy ≥ 3360e60 | ☐ | Health endpoint timestamp |
| 2 | CF logs: no `unhandled_error` (1h) | ☐ | CF dashboard screenshot |
| 3 | CF logs: `audit_logs_unavailable` expected (pre-migration) | ☐ | CF dashboard screenshot |
| 4 | POST /admin/products: 201 success | ☐ | curl output or admin UI |
| 5 | GET /admin/orders/:id: 200 (not 500) | ☐ | curl output |
| 6 | GET /admin/settings/audit-log: 200 | ☐ | curl output |
| 7 | Calendar surfaces: all 3 render | ☐ | Screenshots |

---

## Sign-off

- [ ] All 7 checks pass
- [ ] Phase 2 migration scheduled (see `docs/runbooks/bug-508-phase-2-migration.md`)
- [ ] Smoke test product cleaned up

**Verified by:** _______________
**Date:** _______________

---

## Related

- Issue: BUG-508
- Fix PR: #154
- Phase 2 migration: `docs/runbooks/bug-508-phase-2-migration.md`
- Root cause: BUG-507 (PR #152) deployed INET schema but migration not applied
- Previous resilience: BUG-506 (PR #150)
