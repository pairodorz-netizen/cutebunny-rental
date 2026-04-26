# BUG-504 Category Sync — Wave Final Report

**Report generated**: 2026-04-22 (post-A07 merge)
**Last updated**: 2026-04-22 (post-A08 merge; wait-state block added in §9)
**Wave owner**: Qew Cut Clip
**Wave implementer**: Devin (Cognition)
**Status**: A01 – A08 shipped to `main`; A06 commit 3 FINAL held on 24 h timer + owner ack

## 1. Background

BUG-504 was the "admin category ≠ customer category" drift: the two UIs
surfaced inconsistent taxonomies despite reading the same database. Root cause
was a legacy `SystemConfig.product_categories` blob being served to the admin
SPA while the customer SPA read a dedicated `categories` table. A03 had
introduced a DB-backed admin endpoint (`/api/v1/admin/categories`), A04 had
switched the admin SPA to consume it, and A05 had added a customer-side
Playwright parity guard — but the admin-side leg was still CI-invisible when
the owner observed drift on `admin-eight-rouge.vercel.app` on 2026-04-22.

## 2. Shipped PRs

| PR  | Title                                                                              | Merge SHA   | Phase                               |
|-----|------------------------------------------------------------------------------------|-------------|-------------------------------------|
| #47 | `feat(shared): categories table + seed (BUG-504 A01)`                              | (squashed)  | A01 — taxonomy SoT table            |
| #48 | `feat(api): public GET /api/v1/categories route (BUG-504-A02)`                     | (squashed)  | A02 — public read endpoint          |
| #49 | `feat: admin categories CRUD endpoints + Settings UI (BUG-504-A03)`                | (squashed)  | A03 — admin write path              |
| #50 | `feat(bug504-a04): customer wiring + admin dropdown cutover + legacy deprecation`  | (squashed)  | A04 — consumer cutover              |
| #51 | `test(bug504-a05): Playwright categories-parity diff guard`                        | (squashed)  | A05 — customer↔API CI guard         |
| #52 | `feat(bug504-a06): step 1/3 add products.category_id nullable FK + RED tests`      | `24ccc82`   | A06 commit 1 — RED migration        |
| #53 | `feat(bug504-a06): step 2/3 backfill + dual-write trigger + app-layer dual-write`  | `37dac60`   | A06 commit 2 — GREEN backfill       |
| #54 | `feat(bug504-a06.5): admin category drift guard + DriftBanner + audit event`       | `4848013`   | A06.5 — client-side drift guard     |
| #55 | `test(bug504-a07): admin-side categories parity gates 7+8 (ADMIN_JWT_PROD)`        | `1876b16`   | A07 — admin CI parity scaffolding   |
| #56 | `docs(bug504): wave final report + A06 commit 3 FINAL pre-flight checklist`        | `ba596d1`   | docs — this report + preflight      |
| #57 | `feat(bug504-a08): forensic read params on admin audit-log GET`                    | `67fd075`   | A08 — forensic read surface         |

A06 commit 3 FINAL (drop `products.category` column + drop `ProductCategory`
enum + 410-Gone legacy endpoint) is **not yet shipped**. See §6.

## 3. Prod verification (bearer-free)

All evidence gathered post-A07 merge on 2026-04-22.

### 3.1 Public endpoint parity

```
GET https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/categories
```

Returns the 7-row SoT matching the `categories` table:

| slug         | name_en       | name_th (UTF-8 hex verified)                                                | sort_order | visible_frontend | visible_backend |
|--------------|---------------|-----------------------------------------------------------------------------|------------|------------------|------------------|
| wedding      | Wedding       | `ชุดแต่งงาน` (`e0b88a e0b8b8 e0b894 e0b981 e0b895 e0b988 e0b887 e0b887 e0b8b2 e0b899`) | 10         | true             | true             |
| evening      | Evening       | `ชุดราตรี`                                                                 | 20         | true             | true             |
| cocktail     | Cocktail      | `ค็อกเทล`                                                                   | 30         | true             | true             |
| casual       | Casual        | `ชุดลำลอง`                                                                 | 40         | true             | true             |
| costume      | Costume       | `ชุดแฟนซี`                                                                 | 50         | true             | true             |
| traditional  | Traditional   | `ชุดไทย`                                                                    | 60         | true             | true             |
| accessories  | Accessories   | `เครื่องประดับ`                                                             | 70         | true             | true             |

Initial terminal curl stripped Thai combining marks (shell rendering
artifact); hex dump confirmed the bytes are correct UTF-8.

### 3.2 Admin SPA deploy alignment

```
curl -I https://admin-eight-rouge.vercel.app/
last-modified: Wed, 22 Apr 2026 15:15:45 GMT
```

Admin bundle embeds commit SHA `484801369b3dd9147dbf7f7d0a5ee0d018f92f18`
= A06.5 squash-merge `4848013`. The drift-guard hook + `<DriftBanner/>` +
`adminApi.settings.postAuditLog` wrapper are live as of that timestamp.

### 3.3 Customer↔API parity (CI)

`e2e-categories-parity` job on `main` @ `1876b16`: **10/10 green** including
gates 1–6 (customer↔public). Gates 7–8 `test.skip` pending
`secrets.ADMIN_JWT_PROD` (see §5).

## 4. What A06.5 bought us

Even with the admin-side Playwright guard still skip-mode, the A06.5 runtime
drift detector closes the observability hole:

- On every admin categories fetch (React Query key `['admin-categories']`),
  `useAdminCategoriesWithDriftGuard()` fires a parallel `fetch` against
  `/api/v1/categories` and runs `detectCategoryDrift()` from
  `packages/shared/src/categories-drift-guard.ts`.
- If slugs or labels disagree on the visible intersection
  (`visible_frontend=true`), `<DriftBanner/>` renders above the categories
  table (Settings) and inside the product-edit category field (Products).
  Admin-only rows with `visible_frontend=false` are tracked but do not
  trigger the banner.
- A `category.drift_detected` audit event is POSTed to
  `/api/v1/admin/settings/audit-log` (narrow whitelist, `safeAuditLog`
  persistence), giving us a trail even if the admin dismisses the banner.

This means any future drift reintroduces a visible red banner in the admin
UI within one fetch cycle, independent of CI.

## 5. Remaining work — A07.5 (owner-blocked)

A07 shipped gates 7 + 8 as real tests guarded by a graceful
`test.skip(!process.env.ADMIN_JWT_PROD, ...)`. To flip them live:

1. Owner mints a long-lived, read-capable admin bearer (HS256-signed with
   prod Worker's `JWT_SECRET`). Recipe in `.env.example`.
2. Owner adds the value as a GitHub Actions repo secret at
   `Settings → Secrets and variables → Actions → New repository secret →
   ADMIN_JWT_PROD`.
3. Next `main` CI run automatically executes gates 7 + 8 against
   `/api/v1/admin/categories` + the deployed admin SPA.
4. Devin (session-scoped) can additionally receive the token via
   `secrets(action=request, should_save=true, save_scope=repo)` to enable
   on-demand forensic curls.

No code changes needed in A07.5 — pure ops flip.

## 6. A06 commit 3 FINAL — HELD

- **Earliest unlock**: 2026-04-23 13:00 UTC (24 h hold started at A06 commit 2
  merge, 2026-04-22 13:00 UTC).
- **Additional gate**: explicit `FINAL_CUTOVER` ack from owner.
- **Scope**: drop `products.category` TEXT column, drop `ProductCategory`
  enum, drop dual-write trigger + function, replace legacy
  `/api/v1/admin/settings/categories` with RFC 8594 `410 Gone` +
  `Sunset` + `Link: rel=successor-version`.
- **Pre-flight checklist**: see `docs/bug504-a06-commit3-final-preflight.md`
  (shipped alongside this report).

## 7. Forensic gaps still open (for completeness)

These were part of the owner's verification request on 2026-04-22 that
could not be fulfilled without an admin bearer or direct DB access:

| Check                                                                       | Blocker                                                                                             |
|-----------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| `GET /api/v1/admin/categories` byte-diff vs public                          | needs `ADMIN_JWT_PROD` (A07.5)                                                                      |
| `SELECT * FROM audit_log WHERE action='category.drift_detected' AND created_at > '2026-04-22'` | ~~needs Supabase MCP / service-role key / new read route~~ — **read route landed in A08 (#57)**; now needs only `ADMIN_JWT_PROD` (A07.5) |
| Playwright gate 8 live run against `admin-eight-rouge.vercel.app`           | needs `ADMIN_JWT_PROD` as GitHub repo secret (A07.5)                                                |

All three unblock the moment A07.5 ships. After A08 (#57, merge `67fd075`) the
audit-log query is a single `curl -H "Authorization: Bearer $ADMIN_JWT_PROD"
.../api/v1/admin/settings/audit-log?action=category.drift_detected&since=2026-04-22T13:00:00Z&limit=100`
away.

## 8. Unrelated / standby items (not in this wave)

- **BUG-405 STANDBY**: ORD-26048933 E2E re-test awaiting owner.
- **BUG-405-A02 FROZEN**: blocked on BUG-405 unlock.
- **BUG-501/502/503/505/506/507** + P1 feature backlog: queued.

## 9. Current wait state (post-A08)

As of 2026-04-22 (post-A08 merge), Devin is standing down on BUG-504 work
until one of the two remaining owner-gated unlocks arrives:

| Next unlock         | What it is                                                                                                          | Who                              |
|---------------------|---------------------------------------------------------------------------------------------------------------------|----------------------------------|
| **A07.5**           | Mint `ADMIN_JWT_PROD` + add as GitHub Actions repo secret → CI gates 7+8 flip skip→live; forensic curls become possible | Owner (Supabase service role)    |
| **A06 commit 3 FINAL** | Wall-clock ≥ 2026-04-23 13:00 UTC **and** explicit `FINAL_CUTOVER` ack from owner → destructive schema cutover (see preflight) | Owner (ack)                      |

Neither gate has a Devin-side workaround:

- A07.5 needs prod `JWT_SECRET` which Devin does not have (`secrets list` =
  empty; no service-role key; local dev `JWT_SECRET=dev-secret-change-in-production`
  will not verify against the prod Worker).
- A06 commit 3 is both time-gated and owner-ack-gated by design — the 24 h
  hold exists so commit 2's dual-write runs in production long enough to
  catch any backfill miss before the destructive step.

All non-blocked work in the wave is merged. See
`docs/bug504-a06-commit3-final-preflight.md` for the exact unlock protocol
and execution plan.
