# BUG-508 Phase 2 — Production Migration Runbook

**Context:** BUG-508 Phase 1 (PR #154) deployed defensive code that degrades
gracefully when `audit_logs.ip_address` is TEXT instead of INET. Phase 2 applies
the pending Prisma migrations to fix the root cause.

**Migrations to apply (in order):**
0. `20260512_140_audit_logs_phase1_columns` — ADD `ip_address` TEXT + `user_agent` TEXT (**run first if columns missing**)
1. `20260508_150_audit_logs_ip_inet` — ALTER `ip_address` from TEXT to INET
2. `20260508_160_system_logs` — CREATE TABLE `system_logs` for retention job compliance

**Standalone SQL files (for Supabase SQL Editor):**
- Forward: [`migrations/20260512_140_audit_logs_phase1_columns_forward.sql`](../../migrations/20260512_140_audit_logs_phase1_columns_forward.sql) **(run first)**
- Rollback: [`migrations/20260512_140_audit_logs_phase1_columns_rollback.sql`](../../migrations/20260512_140_audit_logs_phase1_columns_rollback.sql)
- Forward: [`migrations/20260508_150_audit_logs_ip_inet_forward.sql`](../../migrations/20260508_150_audit_logs_ip_inet_forward.sql)
- Rollback: [`migrations/20260508_150_audit_logs_ip_inet_rollback.sql`](../../migrations/20260508_150_audit_logs_ip_inet_rollback.sql)
- Forward: [`migrations/20260508_160_system_logs_forward.sql`](../../migrations/20260508_160_system_logs_forward.sql)
- Rollback: [`migrations/20260508_160_system_logs_rollback.sql`](../../migrations/20260508_160_system_logs_rollback.sql)

---

## Pre-requisites

- [ ] PR #154 (Phase 1 defensive code) merged and deployed
- [ ] Post-merge verification runbook (`docs/runbooks/bug-508-post-merge.md`) Steps 1–7 pass
- [ ] Database backup taken before migration
- [ ] Low-traffic window selected (recommended: 03:00–06:00 Asia/Bangkok)
- [ ] `DATABASE_URL` for production Supabase available

---

## Step 0: Restore missing columns (HOTFIX-514)

> **Run this step FIRST** if `ip_address` column does not exist on `audit_logs`.
> Check with: `SELECT column_name FROM information_schema.columns WHERE table_name='audit_logs' AND column_name='ip_address';`
> If 0 rows → run this step. If 1 row → skip to Step 1.

Copy-paste contents of `migrations/20260512_140_audit_logs_phase1_columns_forward.sql` into Supabase SQL Editor → Run.

This adds `ip_address TEXT` and `user_agent TEXT` columns that Phase 1 code (PR #154) expects.
The columns are TEXT at this stage — Step 2 migration #150 will convert `ip_address` to INET.

**Verification (included in the SQL file):**
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'audit_logs'
  AND column_name IN ('ip_address', 'user_agent');
-- Expected: ip_address | text | YES
--           user_agent | text | YES
```

---

## Step 1: Backup

Before running any migration, take a database backup:

```sql
-- Via Supabase Dashboard → Database → Backups
-- Or via pg_dump:
pg_dump "$PROD_DB_URL" --format=custom -f backup-pre-bug508-$(date +%Y%m%d-%H%M%S).dump
```

---

## Step 2: Run Migration

**Option A — Via Prisma CLI:**
```bash
cd packages/shared
DATABASE_URL="$PROD_DB_URL" npx prisma migrate deploy
```

**Expected output:**
```
2 migrations applied successfully.
  20260508_150_audit_logs_ip_inet
  20260508_160_system_logs
```

**Option B — Via Supabase SQL Editor (recommended):**

Run the standalone forward SQL files in order:
1. Copy-paste contents of `migrations/20260508_150_audit_logs_ip_inet_forward.sql` → Run
2. Copy-paste contents of `migrations/20260508_160_system_logs_forward.sql` → Run

The migration SQL for `20260508_150_audit_logs_ip_inet` uses a safe USING clause:
```sql
ALTER TABLE "audit_logs"
ALTER COLUMN "ip_address" TYPE INET
USING (CASE WHEN ip_address ~ '^[0-9a-fA-F.:]+(/[0-9]+)?$' THEN ip_address::inet ELSE NULL END);
```
Invalid values are converted to NULL rather than causing the migration to fail.

**IP regex explanation:** `^[0-9a-fA-F.:]+(/[0-9]+)?$` matches:
- IPv4: `192.168.1.1`
- IPv6: `::1`, `2001:db8::1`
- CIDR: `192.168.1.0/24`, `::1/128`
- Rejects: empty strings, `unknown`, `localhost`, mixed-content

---

## Step 3: Verify Schema

Run in Supabase SQL Editor:

```sql
-- Verify audit_logs.ip_address is INET
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
-- Expected: id (uuid), job (text), status (text), details (jsonb), created_at (timestamptz)

-- Verify _prisma_migrations records
SELECT migration_name, finished_at
FROM _prisma_migrations
WHERE migration_name LIKE '%150%' OR migration_name LIKE '%160%'
ORDER BY finished_at;
-- Expected: both rows with non-null finished_at
```

---

## Step 4: Post-Migration Verification

### 4a. CF Worker Logs — No more P2022

CF Dashboard → Workers & Pages → `cutebunny-api` → Logs

Monitor for 1 hour after migration:

- `audit_logs_unavailable` → should **STOP** appearing
- `schema_drift_detected` → should **STOP** appearing
- `unhandled_error` with `prismaCode: "P2022"` → should **NOT** appear

### 4b. Audit Log Writes Resume

Perform an admin action (e.g., edit a product), then verify:

```sql
SELECT id, action, resource, ip_address, created_at
FROM audit_logs
WHERE created_at > NOW() - INTERVAL '10 minutes'
ORDER BY created_at DESC
LIMIT 5;
```

**Expected:** New entries with `ip_address` as valid INET value (raw IP for
entries < 30 days old).

### 4c. GET /admin/orders/:id — Full Audit Logs

```bash
TOKEN="<admin-jwt-token>"
curl -s https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/orders/<ORDER_ID> \
  -H "Authorization: Bearer $TOKEN" | jq '.data.audit_logs[:2], .data._meta'
```

**Expected:**
- `audit_logs: [...]` (populated, NOT empty)
- `_meta` should be **absent** (no degradation warning)

### 4d. GET /admin/settings/audit-log — Full Data

```bash
TOKEN="<admin-jwt-token>"
curl -s "https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/settings/audit-log?page=1&per_page=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.data[:2], .meta'
```

**Expected:**
- `data: [...]` (populated with audit entries)
- No `_meta.warning: "audit_logs_unavailable"`

---

## Step 5: Monitor 24h Window

Over the next 24 hours, check periodically:

```sql
-- No P2022 errors in last 24h
-- (Check CF Worker Logs for 'prisma_p2022' tag)
```

- [ ] No `[prisma_p2022]` events in CF logs
- [ ] No `audit_logs_unavailable` events
- [ ] No `schema_drift_detected` alerts
- [ ] Audit log entries being written with valid `ip_address` values
- [ ] First PII retention cron tick at 03:00 BKK → check `system_logs`

---

## Rollback Procedure

If migration causes issues, perform a **double-deploy rollback**:

### Step R1: Code Rollback First

Revert PR #154 code changes (or deploy a version that doesn't reference
`ip_address` as INET). Wait for Worker redeploy to complete.

### Step R2: DB Rollback After Worker Confirmed Live

Run the standalone rollback SQL files in **reverse** order:
1. Copy-paste `migrations/20260508_160_system_logs_rollback.sql` → Run
2. Copy-paste `migrations/20260508_150_audit_logs_ip_inet_rollback.sql` → Run

Or run manually:
```sql
-- Set safety timeouts
SET lock_timeout = '2s';
SET statement_timeout = '5s';

-- Revert ip_address from INET back to TEXT
ALTER TABLE "audit_logs"
ALTER COLUMN "ip_address" TYPE TEXT
USING host(ip_address)::text;

-- Drop system_logs if needed
DROP TABLE IF EXISTS "system_logs";
```

> **Warning:** `ALTER TABLE` takes `ACCESS EXCLUSIVE LOCK`. Run during
> low-traffic window. The `lock_timeout` ensures it fails fast if the table
> is heavily locked rather than blocking other queries.

### Step R3: Verify Rollback

```sql
SELECT data_type
FROM information_schema.columns
WHERE table_name = 'audit_logs'
  AND column_name = 'ip_address';
-- Expected: 'text'
```

---

## Verification Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | Backup taken | ☐ |
| 2 | `prisma migrate deploy` succeeded | ☐ |
| 3 | `ip_address` data_type = `inet` | ☐ |
| 4 | `system_logs` table exists | ☐ |
| 5 | No `audit_logs_unavailable` events (1h) | ☐ |
| 6 | Audit log writes have valid IP | ☐ |
| 7 | GET /admin/orders/:id returns audit_logs (not empty) | ☐ |
| 8 | 24h monitoring clear | ☐ |

---

## Related

- Phase 1 (defensive code): PR #154
- Post-merge verification: `docs/runbooks/bug-508-post-merge.md`
- PII/GDPR compliance: PR #152 (BUG-507)
- Original schema drift resilience: PR #150 (BUG-506)
