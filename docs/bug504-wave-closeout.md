# BUG-504 Wave — Closeout (A07.5 PARKED)

**Closeout date**: 2026-04-24
**Wave owner**: Qew Cut Clip
**Wave implementer**: Devin (Cognition)
**Status**: **Workflow CLOSED.** All user-visible bugs resolved; one hardening leg parked pending owner-side ops.

This document supersedes the in-flight notes in
`docs/bug504-wave-final-report.md` and the scratch copy kept on the
implementer VM at `/home/ubuntu/bug504-wave-closeout.md`. For the full
chronological history, forensic deltas, and A06.5 rationale, see the
final-report file; this closeout is the owner-signed end-state.

---

## 1. Shipped to prod

### 1.1 BUG-504 wave (category sync)

| Atom   | PR                                                                                   | Phase                                                   |
|--------|--------------------------------------------------------------------------------------|---------------------------------------------------------|
| A01    | [#47](https://github.com/pairodorz-netizen/cutebunny-rental/pull/47)                 | `categories` table + seed (7 rows)                      |
| A02    | [#48](https://github.com/pairodorz-netizen/cutebunny-rental/pull/48)                 | `GET /api/v1/categories` public route                   |
| A03    | [#49](https://github.com/pairodorz-netizen/cutebunny-rental/pull/49)                 | Admin CRUD + Settings UI                                |
| A04    | [#50](https://github.com/pairodorz-netizen/cutebunny-rental/pull/50)                 | Customer cutover + admin dropdown + RFC 8594 deprecation |
| A05    | [#51](https://github.com/pairodorz-netizen/cutebunny-rental/pull/51)                 | Playwright customer↔public parity guard (CI)            |
| A06-1  | [#52](https://github.com/pairodorz-netizen/cutebunny-rental/pull/52)                 | `products.category_id` nullable FK + RED tests          |
| A06-2  | [#53](https://github.com/pairodorz-netizen/cutebunny-rental/pull/53)                 | Backfill + dual-write trigger + app-layer dual-write    |
| A06.5  | [#54](https://github.com/pairodorz-netizen/cutebunny-rental/pull/54)                 | Admin client-side drift guard + `<DriftBanner/>`        |
| A07    | [#55](https://github.com/pairodorz-netizen/cutebunny-rental/pull/55)                 | Admin-side Playwright parity gates 7 + 8 (skip-mode)    |
| A08    | [#57](https://github.com/pairodorz-netizen/cutebunny-rental/pull/57)                 | Forensic query params on admin `GET /audit-log`         |

Docs (non-code) merged as part of the wave:

- [#56](https://github.com/pairodorz-netizen/cutebunny-rental/pull/56) — wave final report + A06 commit 3 FINAL pre-flight
- [#58](https://github.com/pairodorz-netizen/cutebunny-rental/pull/58) — post-A08 wait-state section

### 1.2 Security hardening arc (post-BUG-504)

| Atom     | PR                                                                                  | Phase                                                     |
|----------|-------------------------------------------------------------------------------------|-----------------------------------------------------------|
| RLS-01   | [#59](https://github.com/pairodorz-netizen/cutebunny-rental/pull/59)                | RLS enabled on all 27 public tables (code-sync hotfix)    |
| RLS-02-0 | [#60](https://github.com/pairodorz-netizen/cutebunny-rental/pull/60)                | Per-table policy plan (scope doc)                         |
| RLS-02-1 | [#61](https://github.com/pairodorz-netizen/cutebunny-rental/pull/61)                | Group 4 — `_prisma_migrations` RESTRICTIVE deny-all       |
| RLS-02-2 | [#62](https://github.com/pairodorz-netizen/cutebunny-rental/pull/62)                | Group 3 — admin-only RESTRICTIVE deny-all (11 tables)     |
| RLS-02-3 | [#63](https://github.com/pairodorz-netizen/cutebunny-rental/pull/63)                | Group 1 — public-readable PERMISSIVE SELECT (9 tables)    |
| RLS-02-4 | [#64](https://github.com/pairodorz-netizen/cutebunny-rental/pull/64)                | Group 2 — customer-owned RESTRICTIVE deny-all (6 tables)  |
| RLS-03   | [#65](https://github.com/pairodorz-netizen/cutebunny-rental/pull/65)                | `search_path` pinned on 2 functions                       |

---

## 2. System health (as of 2026-04-24 closeout)

- **Supabase Security Advisor**: Errors 0 · Warnings 0 · Info 0.
- **Cloudflare Worker** (`cutebunny-api.cutebunny-rental.workers.dev`): deploy green;
  `GET /api/v1/categories` returns the 7-row SoT; admin bearer routes protected.
- **Vercel — admin** (`admin-eight-rouge.vercel.app`): deploy green; DriftBanner
  hook + audit-log wrapper live (A06.5).
- **Vercel — customer**: deploy green; locale-aware category labels on
  `/th` + `/en`.
- **CI**: `main` passing; `e2e-categories-parity` runs 10 gates, 2 of which
  (gates 7 + 8) `test.skip` pending `ADMIN_JWT_PROD` (see §3).
- **Rollbacks required during wave**: 0.

---

## 3. A07.5 — PARKED

**Date parked**: 2026-04-24.

**Decision**: owner ratified parking A07.5 (admin JWT minting + Playwright
skip→test flip). The `BUG-504` wave is already fully closeout-ready: the
user-visible category drift was resolved at **A04 merge**, and regression
protection has been live since **A05**. A07.5 is a hardening leg that
removes the final `test.skip` on the admin-side Playwright gates
(gates 7 + 8); it does **not** gate any product functionality.

**Why parked (not in-flight)**:

- The prod Worker's `JWT_SECRET` is stored as a Cloudflare **encrypted**
  secret via `wrangler secret put`; Cloudflare's platform design makes
  the value **unreadable** once written — it can only be rotated, not
  retrieved. Owner does not have the original value on hand and is not
  ready to rotate + redeploy the Worker at this time.
- Without `JWT_SECRET`, no party (owner, Devin, CI) can mint a token
  whose signature `requireAuth` will verify. The planned local-mint
  path from this session is feasible but blocked on that one input.
- Shipping A07.5 is orthogonal to the BUG-504 user-impact closure:
  A06.5's client-side drift guard + audit event already give us
  in-product observability; A07 already scaffolded gates 7 + 8 with a
  graceful skip; there is no user-facing regression risk from leaving
  them in skip-mode.

**What is NOT affected by parking**:

- Category taxonomy correctness — fully governed by A01 → A05.
- Admin + customer deploys — both green; DriftBanner (A06.5) surfaces
  any drift at runtime.
- Security Advisor — 0/0/0, independent of this leg.
- BUG-RLS-01 / 02 / 03 — independent arc, all shipped and verified.

**What IS on hold**:

- `tests/e2e/categories-parity.spec.ts` gates 7 + 8 remain `test.skip`
  in CI. Gate 7 (admin `/api/v1/admin/categories` byte-diff vs public)
  + gate 8 (A06.5 `<DriftBanner/>` absent on parity) do not execute.
- Forensic curls that require an admin bearer (e.g. querying
  `/api/v1/admin/settings/audit-log` from the implementer's side
  post-A08) are owner-only until resume.

---

## 4. RESUME CHECKLIST

Follow these steps in order when A07.5 is re-opened. Each step is owner-
executable; Devin can own step (d) on signal.

### (a) Rotate `JWT_SECRET` on the Cloudflare Worker

`JWT_SECRET` is unreadable post-write, so "recover" = "rotate".

```bash
# from the owner's workstation, authenticated to the
# cutebunny-rental Cloudflare account
cd apps/api
wrangler secret put JWT_SECRET --env production
# paste a freshly generated 64-byte hex string (openssl rand -hex 64)
```

Notes:

- Worker auto-restarts; all in-flight admin sessions are invalidated
  (expected — admins need to re-login after rotation).
- Do **not** commit the new value. Record it only in the owner's
  password manager + the grant in step (c).
- Rotation is independent of `SUPABASE_SERVICE_ROLE_KEY` — do not
  touch that.

### (b) Mint `ADMIN_JWT_PROD` locally

Use the zero-dep Node script delivered in the chat transcript for
this session (self-contained, uses only `node:crypto`). It reproduces
the exact HS256 shape expected by
[`apps/api/src/middleware/auth.ts`](../apps/api/src/middleware/auth.ts):

```
header  = { alg: "HS256", typ: "JWT" }
payload = { sub, email, role: "superadmin", iat, exp }   # exp = now + 90d
```

Mint:

```bash
JWT_SECRET='<value from step (a)>' \
ADMIN_UUID='<id from admin_users WHERE role = '"'"'superadmin'"'"' LIMIT 1>' \
ADMIN_EMAIL='admin@cutebunny.local' \
node mint-admin-jwt.js > /tmp/admin-jwt-prod.txt
```

The `ADMIN_UUID` comes from prod Supabase:

```sql
SELECT id, email, role, created_at
FROM public.admin_users
WHERE role = 'superadmin'
ORDER BY created_at ASC
LIMIT 5;
```

Sanity-verify the bearer against prod (expect HTTP 200):

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $(cat /tmp/admin-jwt-prod.txt)" \
  https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/categories
```

### (c) Provision the secret

`ADMIN_JWT_PROD` must be available **to GitHub Actions** (for CI gates
7 + 8 in `.github/workflows/ci.yml`), and may optionally be mirrored
into Vercel for any admin-SPA-side preview harness.

**Primary (required) — GitHub Actions repo secret:**

- URL: https://github.com/pairodorz-netizen/cutebunny-rental/settings/secrets/actions
- Click **"New repository secret"**.
- Name: `ADMIN_JWT_PROD` (exact, case-sensitive).
- Scope: repository-level (not environment-scoped — the workflow
  references `${{ secrets.ADMIN_JWT_PROD }}` at job level without an
  `environment:` binding).
- Value: contents of `/tmp/admin-jwt-prod.txt` with no surrounding
  quotes or trailing newline.

**Secondary (optional) — Vercel admin project env var:**

Only needed if the admin SPA ever needs to exercise admin endpoints
from a preview deploy. For CI parity gates alone, the GitHub secret
is sufficient.

- Project: `admin-eight-rouge.vercel.app` (Vercel → admin project →
  Settings → Environment Variables).
- Name: `ADMIN_JWT_PROD`.
- Scope: **Production** only (do not leak to Preview / Development).
- Redeploy the admin project to pick up the new env var.

### (d) Re-enable the Playwright admin flip — Devin opens the PR

On owner's "secret is set" ping, Devin will open a follow-up PR to
[#51](https://github.com/pairodorz-netizen/cutebunny-rental/pull/51)
converting the two `test.skip(!ADMIN_JWT, …)` soft-skips in
[`tests/e2e/categories-parity.spec.ts`](../tests/e2e/categories-parity.spec.ts)
(gates 7 + 8) into hard pre-asserts, so future rotations that forget
to update the secret fail CI loudly instead of silently skipping:

```ts
expect(ADMIN_JWT, 'ADMIN_JWT_PROD must be provisioned as a repo secret')
  .toBeTruthy();
```

Devin will then wait for CI to run gates 7 + 8 live and post the
receipt (PR link, CI run link, Security Advisor still 0/0/0).

---

## 5. A06 commit 3 FINAL — also on hold

A06 commit 3 FINAL (drop `products.category` TEXT column, drop
`ProductCategory` enum, 410-Gone the legacy admin settings endpoint)
remains **parked awaiting explicit owner ratify** per
[`docs/bug504-a06-commit3-final-preflight.md`](./bug504-a06-commit3-final-preflight.md)
and the scratch checkpoint `/home/ubuntu/bug504-a06-checkpoint.md` on
the implementer VM.

The draft branch
[`devin/BUG504-A06-commit3-FINAL-draft`](https://github.com/pairodorz-netizen/cutebunny-rental/tree/devin/BUG504-A06-commit3-FINAL-draft)
is pre-staged with:

- `packages/shared/prisma/migrations/20260423_030_products_category_enum_drop/migration.sql`
- `…/rollback.sql` (emergency-only schema restore)
- `apps/api/src/__tests__/bug504-a06-legacy-route-gone.test.ts` (RED)
- `docs/bug504-a06-commit3-DRAFT-notes.md` (8-step exec checklist)

Nothing is merged from that branch. It sits idle pending a literal
`FINAL_CUTOVER` ack from the owner.

---

## 6. Housekeeping — branches still present on remote

No orphan A07.5 branches exist (A07.5 never progressed past the
investigation step; no branch was ever pushed). The following
intentionally-parked branches remain on `origin`:

- `devin/BUG504-A06-commit3-FINAL-draft` — pre-staged for FINAL cutover, do not delete.
- `devin/BUG504-wave-docs-update` — stale; safe to delete at owner's convenience.

All other BUG-504 and BUG-RLS branches have been squash-merged and
auto-deleted by GitHub on merge.

---

## 7. Provenance

- Wave author: devin-ba5866a7430a41bd9322ed07c88bb299
- Sessions: `ba5866a7430a41bd9322ed07c88bb299` and predecessors (see individual PRs for per-atom session IDs).
- Ratification path: each atom ratified by owner inline (`Qew Cut Clip`) before squash-merge; A07.5 park ratified by owner on 2026-04-24.
- Atomic protocol: one PR per atom, TDD-first RED→GREEN where applicable, CI must be green pre-merge. Zero violations across the wave.

**This workflow is CLOSED.** Reopen A07.5 via §4 when the `JWT_SECRET`
rotation is convenient for the owner.

---

## 8. Post-closeout watch list

Items that surfaced *after* the wave was closed and are being tracked
without a dedicated atom yet.

### 8.1 BUG-UX-TRANSIENT-5XX — "Unexpected server error" banner during deploy cutover

**Status:** **confirmed regression** as of 2026-04-26 (2/2 occurrences
inside the 7-day window). Original "deploy-cutover noise" hypothesis
**falsified** — second occurrence was 3× DELETE 500s in 7 seconds
under steady-state traffic, not a deploy rollover. Promoted to a
two-commit response track:

- **A07-commit1 (observability) — SHIPPED.** PR [#95][pr-95]
  (`eb330b8`, merged 2026-04-26 ~19:00 UTC) added a structured
  `console.error` line tagged `[admin-categories]` to the global
  `adminCategories.onError(...)` catch-all so future occurrences
  surface `err_message / err_name / err_code / err_stack[top5] /
  categoryId / userId / requestId` in Workers Logs. Wire envelope
  byte-for-byte unchanged. Pattern mirrors PR #43 (BUG-404-A01) and
  PR #46 (BUG-405-A01). Vitest spy gate added at
  `apps/api/src/__tests__/bug504-a07-observability.test.ts`.
- **A07-commit2 (targeted fix) — PENDING.** Held until the owner
  reproduces the 500 against the deployed `eb330b8` and pastes the
  new structured `[admin-categories]` log line. Candidates ranked
  pre-capture: (1) `$executeRaw` UUID-cast / parameter-binding
  throw at `apps/api/src/routes/admin/categories.ts:332-337` (~55%
  pre-evidence), (2) Prisma `P2003` race between the
  `db.product.count` pre-check and `db.category.delete` (~25%),
  (3) Prisma client schema drift (~15%), (4) auth-middleware edge
  case (~5%). Speculative bundling explicitly forbidden — fix lands
  only with observed evidence.

**Symptom:** Banner reading `Unexpected server error` on the admin
Categories page after clicking the trash icon on a row. Initial
hypothesis assumed deploy-cutover blue/green isolate races; the
second occurrence's log shape (3× DELETE in 7s, all 500, no
deploy event in window) ruled this out.

**Hypothesis (T3 advisory, 2026-04-26 — superseded by A07):**
Cloudflare blue/green deploy cutover — a small fraction of requests
during the active-version swap landing on a cold isolate. Hono's
global `onError()` returns the canonical `internal_error` envelope
(`message: "Unexpected server error"`), which the admin frontend's
`parseAdminErrorResponse` surfaces verbatim. **This hypothesis is
retained for the historical record; the actual root cause for
occurrence #2 is being narrowed by A07-commit1's observability
patch and will be documented under A07-commit2 once the live
capture lands.**

The *frontend* mitigation from the original advisory still has
standalone value and is split into its own backlog item:

> React-Query mutation retry on 5xx: enable `retry` (1-2 attempts
> with exponential backoff) on `useMutation` defaults so 5xx
> transients auto-retry once before surfacing the banner. Estimated
> ~0.3 h. Owner-gate this if A07-commit2 doesn't fully eliminate
> the residual 5xx rate.

**Occurrence log:**

| #   | Date (JST)              | Worker deploy   | Cloudflare ray         | Notes                                                                |
|-----|-------------------------|-----------------|------------------------|----------------------------------------------------------------------|
| 1   | 2026-04-26 ~01:00       | `320f1dde`      | (not captured)         | PR #90 rollover; did not recur on reload. Original "transient" entry. |
| 2   | 2026-04-26 19:53:51–58  | (PR #90 era)    | `9f250bf8fe01e395`     | 3× DELETE 500 in 7s on `/api/v1/admin/categories/:id`. Ray JSON had `exception:{}` / `logs:{}` — opaque. Promoted §8.1 to confirmed regression; triggered A07. |

**Closure conditions:** §8.1 stays open until A07-commit2 lands a
targeted fix and 7 calendar days of normal traffic pass without
another `[admin-categories]` 500 line in Workers Logs. If A07-commit2
ships and the residual 5xx rate stays > 0, the React-Query mutation
retry mitigation above is the next escalation rung.

[pr-95]: https://github.com/pairodorz-netizen/cutebunny-rental/pull/95

### 8.2 BUG-URGENT-ORDER-STATUS / Issue #45 — Verified resolved by PR #46

**Status:** verified resolved, GitHub Issue [#45][issue-45] closed.
Reopens only on second occurrence within 7 days.

**Filed:** 2026-04-22 ~16:00 JST (ORD-26048933, Somchai, 4,960 THB).
Reproduction: admin Categories→Orders status modal, `cleaning →
finished` transition rejected with red `Failed to fetch` banner;
status stuck at `cleaning`. Other transitions (`paid_locked → shipped
→ returned → cleaning`) committed cleanly.

**Root cause:** uncaught throws in the `cleaning → finished`
side-effect chain (`orderItem.aggregate` + up to 2
`financeTransaction.create` calls for `deposit_returned` /
`deposit_forfeited`) terminated the Cloudflare Worker before a
response could be flushed. Browser surfaced the dropped TCP/HTTP
session as `TypeError: Failed to fetch`, which the admin frontend's
`parseAdminErrorResponse` rendered verbatim. Other transitions had no
side-effect fan-out (or only one finance insert) so they never
exhausted the wall-clock budget. **Not** a missing FSM transition —
`state-machine.ts` has always allowed `cleaning → finished` via
`ORDER_TRANSITIONS.cleaning = ['repair', 'finished', 'returned',
'cancelled']`.

**Fix:** PR #46 (`f371534`, BUG-405-A01, merged 2026-04-22 16:49:40
JST — *49 minutes after the issue was filed*) shipped three changes
to `apps/api/src/routes/admin/orders.ts`:

1. **`adminOrders.onError(...)` catch-all** returning a 500 JSON
   envelope on uncaught throws, mirroring BUG-404-A01's pattern.
   Replaces Hono's default plain-text crash that would terminate the
   Worker mid-response.
2. **Atomic `db.$transaction([order.update, orderStatusLog.create])`**
   for the two writes that define whether the transition really
   happened. Half-commits become impossible.
3. **Per-side-effect `try/catch` isolation** around
   `orderItem.aggregate`, `financeTransaction.create` (×2), customer
   notification, and admin audit log. Any individual failure no
   longer drains the wall-clock budget; the response envelope is
   committed regardless.

**Verification:**

- Owner-side smoke 2026-04-26 ~02:00 JST: ORD-26048933 (Somchai,
  4,960 THB) and ORD-26042674 (590 THB) both at `status=finished`.
  No `Failed to fetch` on the admin orders page.
- Cloudflare Workers Observability now permanent post-BUG-OBS-01;
  query spec for owner re-verification (any time):
  `(method = "PATCH") AND (path matches "/api/v1/admin/orders/.+/status$")
   AND (timestamp >= 2026-04-22T07:49:40Z)`. Acceptance: zero
  `outcome=exception` and zero `status=500` rows where the request
  body's `to_status` is `finished` from a `cleaning` source.

**Regression gates:** `bug405-orders-status-resilience.test.ts`

- Gate #9 — `cleaning→finished happy path response shape is unchanged`.
- Gate #14 — `cleaning→finished with EVERY side effect throwing still
  commits 200 JSON`.

**Watch window:** reopens only on a second occurrence before
**2026-05-03 ~02:00 JST**. If a second occurrence lands inside that
window, escalate to **Option A** from the T3 advisory (add a
structured `[admin-orders-status]` JSON envelope mirroring BUG-504's
`[admin-categories]` pattern, ~1 h). One occurrence pre-fix does not
justify even Option A — the fix is already in place.

[issue-45]: https://github.com/pairodorz-netizen/cutebunny-rental/issues/45

### 8.3 BUG-AUDIT-IDX-01 — `audit_logs` composite index, parked with tripwire

**Status:** parked. Owner-gated like A06 — will not auto-ratify even if
threshold trips. Trigger word locked: **`IDX_CUTOVER`**.

**Context:** BUG-AUDIT-UI-A01 (PR #93, merged 2026-04-26) shipped the
read-only Audit Log UI on `/admin/settings?tab=audit`, superadmin-gated,
with `from`/`to`/`section`/`actor`/`q`/`pageSize` filters. The default
query is:

```sql
SELECT … FROM audit_logs
WHERE resource = 'system_config'
  AND created_at >= NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 50 OFFSET ?;
```

The default 7-day window keeps the working set bounded; sequential
scan stays under the UI's 200ms perceptual threshold below ~10k rows.

**Baseline (Supabase prod, 2026-04-26):**

| Metric | Value |
|---|---|
| `total_rows` | **0** |
| `config_rows` (`resource = 'system_config'`) | **0** |
| `pg_relation_size('audit_logs')` | **8192 B** (1 empty page) |
| `pg_indexes_size('audit_logs')` | n/a (PK only) |

Well below the 10k threshold; no index needed today.

**Tripwire — owner runs monthly (read-only, no locks):**

```sql
SELECT
  COUNT(*) FILTER (WHERE resource = 'system_config') AS config_rows,
  COUNT(*) AS total_rows,
  pg_size_pretty(pg_relation_size('audit_logs')) AS table_size,
  pg_size_pretty(pg_indexes_size('audit_logs')) AS indexes_size,
  MIN(created_at) AS oldest_row,
  MAX(created_at) AS newest_row
FROM audit_logs;
```

**Decision tree on `total_rows`:**

| `total_rows` | Action |
|---|---|
| `< 5,000` | **Park.** No measurable perf benefit; index adds write overhead with zero read win. Re-check next month. |
| `5,000 – 10,000` | **Schedule** for next maintenance window as a 5-min cleanup atom. |
| `> 10,000` | **Send `IDX_CUTOVER`** — Devin opens the PR with the diff below. |
| `> 50,000` | **Hot-fix priority.** Sequential scans tail the UI noticeably. |

**Schema diff** (`packages/shared/prisma/schema.prisma`, +1 line on the
`AuditLog` model):

```diff
 model AuditLog {
   …
+  @@index([resource, createdAt(sort: Desc)], name: "audit_logs_resource_created_at_idx")
   @@map("audit_logs")
 }
```

**Migration:** `20260427_100_audit_logs_resource_created_at_idx`
(matches the `YYYYMMDD_NNN_<slug>` cadence; next free `_100_` slot
after `20260424_090_fix_function_search_path`).

**`migration.sql` body** — `CONCURRENTLY` to avoid a write lock on
`audit_logs`:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS audit_logs_resource_created_at_idx
  ON audit_logs (resource, created_at DESC);
```

`CONCURRENTLY` cannot run inside a transaction. Prisma's
`migrate deploy` wraps each migration in a tx by default; use the same
no-transaction convention BUG-RLS-01 (PR #59) used for its
`ENABLE ROW LEVEL SECURITY` migrations on Supabase Postgres 15. If that
pattern proves brittle on this migration, the fallback is to drop
`CONCURRENTLY` and accept a sub-100ms write lock on `audit_logs` — the
only blocked path is admin-settings audit inserts.

**Read-path latency estimate (Supabase pooler, Postgres 15):**

| Total rows | Pre-index | Post-index | Speedup |
|---|---|---|---|
| 1k | ~3ms | ~2ms | 1.5× |
| 10k | ~25ms | ~3ms | 8× |
| 100k | ~280ms | ~5ms | 55× |
| 1M | ~3.2s | ~8ms | 400× |

**Write-path overhead:** ~50–100µs per insert (one extra btree leaf
write at <100k table rows). Page splits are cheap because
`created_at DESC` ordering puts new rows at the leftmost position.
Negligible vs the surrounding `Promise.allSettled` write batch
(~5ms baseline). `safeAuditLog` already swallows errors, so even
index-write contention can't escalate to a user-visible failure.

**Reversibility:** fully reversible, no data loss.

```sql
DROP INDEX CONCURRENTLY IF EXISTS audit_logs_resource_created_at_idx;
```

`CONCURRENTLY` is supported on Supabase Postgres 15+ for both `CREATE`
and `DROP`. The index is purely a query-planner artifact.

**UBS gate classification:** **T3 schema → owner-ratify** (matches A06
precedent). Touches `schema.prisma` + adds a migration file. Outside
the auto-decide envelope per UBS v8 §3.2 even though this index is
mechanically simpler than A06's dual-write trigger flip. Single-PR
scope, single squash-merge, no app-layer code changes (existing
Prisma `where`/`orderBy` clauses already match the new index).

**Trigger protocol:** owner sends literal `IDX_CUTOVER` in chat → Devin
opens the PR with the diff above on a fresh branch off main → CI 10/10
green → owner merges. ~5 min wall, ~$5.

**Non-goals (do NOT bundle):**

- Keyset pagination on the audit-log GET (deep-page OFFSET >10000 still
  index-scans to skip rows; not addressable by this index).
- Index on `details->>'key'` (JSONB path) — out of scope; `q`
  free-text search is bounded by the default 7-day window.
- Index on `(adminId, createdAt)` for `actor=` filter — defer; actor
  filter is rare and currently fast on small tables.

**Watch window:** indefinite. Owner runs the count query in this
section monthly (or whenever the Audit Log UI feels sluggish). No
auto-trigger; cutover requires literal `IDX_CUTOVER`.

[issue-34]: https://github.com/pairodorz-netizen/cutebunny-rental/issues/34
[pr-93]: https://github.com/pairodorz-netizen/cutebunny-rental/pull/93
