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

**Status:** observed once, deferred. Open atom only on second occurrence.

**Symptom:** A single transient banner reading `Unexpected server error`
on the admin Categories page during the ~30-second window between
`wrangler deploy` flipping the active Worker and the Vercel admin edge
cache rolling over. Did not recur on reload.

**Hypothesis (T3 advisory, 2026-04-26):** Cloudflare blue/green deploy
cutover — a small fraction of requests during the active-version swap
can land on a cold isolate that exceeds CPU budget OR races with
module-load. Hono's global `onError()` returns the canonical
`internal_error` envelope (`message: "Unexpected server error"`),
which the admin frontend's `parseAdminErrorResponse` surfaces verbatim.
Not drift-guard related (`s-maxage=30` from BUG-505-A01 targets stale
data, not 5xx). Not a module-load throw (BUG-API-WORKER-CRASH-01 gates
in `bug-api-worker-crash-01.test.ts` are green and would catch that).

**Trigger threshold:** **2 occurrences in 7 days** of normal traffic
(post-2026-04-26). On second occurrence, open `BUG-UX-TRANSIENT-5XX-A01`
implementing **Option A** from the advisory:

> React-Query mutation retry on 5xx: enable `retry` (1-2 attempts with
> exponential backoff) on `useMutation` defaults so 5xx transients
> auto-retry once before surfacing the banner. Estimated ~0.3 h.

**Occurrence log:**

| #   | Date (UTC)              | Worker deploy   | Notes                                  |
|-----|-------------------------|-----------------|----------------------------------------|
| 1   | 2026-04-26 ~01:00 JST   | `320f1dde`      | PR #90 rollover; did not recur on reload |

If the second occurrence happens, append the row + open the atom. If 7
days pass with no recurrence, this section can be folded into a generic
"deploy-cutover noise" footnote.

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
