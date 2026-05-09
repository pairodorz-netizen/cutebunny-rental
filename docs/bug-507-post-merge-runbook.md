# BUG-507 Post-Merge Verification Runbook

**PR:** #152 — PII/GDPR compliance for `audit_logs.ip_address`
**Merged to:** `main`
**Date:** 2026-05-08

---

## Pre-requisites

- Admin API token: `POST /api/v1/admin/auth/login` → extract `token` from response
- Cloudflare dashboard access for `cutebunny-api` Worker
- Supabase SQL Editor access for database queries

---

## Step 1: Confirm Production Deploy Success

### Vercel (admin + customer)

Check deployment status:
- Admin: https://vercel.com/pairodorz-2194s-projects/admin
- Customer: https://vercel.com/pairodorz-2194s-projects/customer

Both should show latest deployment from `main` as "Ready".

### Cloudflare Worker (API)

```bash
curl -s https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/health | jq .
```

Expected: `{ "status": "ok", ... }` — confirm deployment timestamp is after merge.

**Expected:** Green status on both Vercel and CF Worker.
**Failure indicator:** 502/503 errors, old deployment timestamp.

---

## Step 2: Verify Schema Migration Applied

Run in Supabase SQL Editor:

```sql
-- Verify audit_logs.ip_address is INET type
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'audit_logs'
  AND column_name = 'ip_address';
-- Expected: data_type = 'inet'

-- Verify system_logs table exists
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'system_logs'
ORDER BY ordinal_position;
-- Expected: id (uuid), job (text), status (text), details (jsonb), created_at (timestamp with time zone)
```

**Expected:** `ip_address` = `inet`, `system_logs` table exists with 5 columns.
**Failure indicator:** `data_type = 'text'` → migration not applied. Run:

```bash
cd packages/shared
DATABASE_URL="$PROD_DB_URL" npx prisma migrate deploy
```

---

## Step 3: Verify New Audit Logs Record Raw IP (0–30 days)

Perform any admin action (e.g., view an order), then verify:

```sql
SELECT id, ip_address, created_at
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** `ip_address` contains a full raw IP (e.g., `203.0.113.45`), not masked or NULL.
**Failure indicator:** NULL ip_address → IP extraction not working; check Worker logs for `[ip-extraction]` warnings.

---

## Step 4: Monitor Retention Job via system_logs (24h spy)

The retention cron runs daily at `0 20 * * *` (20:00 UTC = 03:00 Asia/Bangkok).

### After first cron tick:

```sql
SELECT id, job, status, details, created_at
FROM system_logs
WHERE job = 'pii_retention'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** At least 1 row after first 03:00 BKK tick with:
- `status` = `success` (or `partial` if some rows had issues)
- `details.masked` = number of IPs masked (30–90d old rows)
- `details.deleted` = number of IPs deleted (>90d old rows)
- `details.message` = `"Retention policy for YYYY-MM-DD applied"`

### Cloudflare Worker Logs

CF Dashboard → Workers & Pages → `cutebunny-api` → Logs

Search for: `[pii_retention] completed:`

**Expected:** Structured JSON log with `masked`, `deleted`, `duration_ms` counts.
**Failure indicator:** No log entry after 03:00 BKK → cron not registered (see Step 6).

---

## Step 5: Verify Privacy Policy Live on Customer Site

### Thai version
- URL: `https://<customer-domain>/privacy` or `https://<customer-domain>/th/privacy`
- Verify section: "การเก็บ IP Address ใน Admin Audit Log"
- Check: purpose, legal basis, retention table, DSAR channel, DPO contact

### English version
- URL: `https://<customer-domain>/en/privacy`
- Verify section: "Admin Audit Log IP Collection"
- Check: same content in English

**Expected:** Both pages render with retention table (0–30d raw, 31–90d masked, >90d deleted), DSAR form link, DPO email.
**Failure indicator:** 404 or missing section → MDX file not included in build; check Vercel build logs.

> **Action item:** Update `dpo@cutebunny.example` placeholder with actual DPO email.

---

## Step 6: Verify CI Guard — No Raw IP Leak in Logs

### Cloudflare Worker Logs Query

CF Dashboard → Workers & Pages → `cutebunny-api` → Logs

Search for patterns that should NOT appear:
- Raw IPv4 in log output (e.g., `192.168.x.x`, `10.0.0.x` with non-zero last octet)
- `ip_address` field with full IP in structured logs

Search for patterns that SHOULD appear:
- `[REDACTED]` for any `ip_address`/`ipAddress`/`client_ip` fields in logs
- `masked_ip` fields with `/24` or `/48` suffix (these are allowed)

### Verify Cron Triggers

CF Dashboard → Workers & Pages → `cutebunny-api` → Triggers → Cron Triggers

Or via API:
```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/workers/scripts/cutebunny-api/schedules" \
  -H "Authorization: Bearer <CF_API_TOKEN>" | jq .
```

**Expected:** Two cron triggers:
- `0 * * * *` (hourly — BUG-505 order auto-advance)
- `0 20 * * *` (daily — BUG-507 PII retention)

**Failure indicator:** Only 1 cron → Worker config not deployed with updated wrangler.toml.

---

## Step 7: Backfill Dry-Run Report

⚠️ **DRY-RUN ONLY — DO NOT use --apply without legal sign-off**

```bash
DATABASE_URL="$PROD_DB_URL" npx tsx scripts/pii_backfill.ts
```

**Expected output:**
```
=== PII Backfill Dry-Run Report ===
Rows to mask (30–90 days old):    <N>
Rows to delete IP (>90 days old): <M>
Total affected:                   <N+M>
...
DRY-RUN complete. To apply: npx tsx scripts/pii_backfill.ts --apply
```

Record the counts for legal sign-off documentation on issue #151.

**To apply (AFTER legal sign-off documented on issue #151):**
```bash
DATABASE_URL="$PROD_DB_URL" npx tsx scripts/pii_backfill.ts --apply
```

---

## Step 8: Rollback Procedure

### Scenario A: Code rollback only (Worker issue)

1. Revert the merge commit on `main`:
   ```bash
   git revert <merge-commit-sha> --no-edit
   git push origin main
   ```
2. Wait for Cloudflare + Vercel to redeploy
3. Verify Worker is running previous code version

### Scenario B: Full rollback (code + DB)

**Step 1:** Code rollback first (Scenario A above)

**Step 2:** After Worker confirmed running old code, rollback DB:

```sql
-- IMPORTANT: Run during low-traffic window
SET lock_timeout = '2s';
SET statement_timeout = '5s';

-- Revert INET → TEXT
ALTER TABLE audit_logs
  ALTER COLUMN ip_address TYPE text
  USING host(ip_address)::text;

-- Optionally drop system_logs if not needed
-- DROP TABLE IF EXISTS system_logs;
```

⚠️ `ALTER TABLE` acquires `ACCESS EXCLUSIVE LOCK` — schedule during low-traffic period.

### Scenario C: Emergency cron disable

CF Dashboard → Workers & Pages → `cutebunny-api` → Triggers → Cron Triggers → Delete `0 20 * * *`

This stops the retention job without code changes. Re-add when ready.

---

## 24-Hour Monitoring Checklist

| Time | Check | Expected |
|------|-------|----------|
| +0h (post-merge) | Vercel + CF deploy green | Both "Ready" |
| +0h | Schema migration applied | `ip_address` = `inet` |
| +1h | New audit logs have raw IP | Non-NULL `ip_address` |
| +3h (03:00 BKK) | Retention cron runs | `system_logs` entry |
| +3h | CF Worker logs | `[pii_retention] completed:` |
| +24h | No `[prisma_p2022]` errors | 0 occurrences |
| +24h | No raw IP in Worker logs | Only `[REDACTED]` or masked |
| +24h | Privacy pages accessible | TH + EN render correctly |

---

## Alert Types to Monitor

| Alert | Meaning | Action |
|-------|---------|--------|
| `pii_retention_alert` | >3 consecutive batch failures | Check DB connectivity; review system_logs details |
| Raw IP in CF logs | IP redaction middleware bypassed | Investigate log source; patch redaction |
| `system_logs` empty after 03:00 BKK | Cron not firing | Verify wrangler.toml cron triggers |

---

*Generated by Devin — BUG-507 post-merge verification*
