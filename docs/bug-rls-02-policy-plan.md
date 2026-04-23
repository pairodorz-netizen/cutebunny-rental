# BUG-RLS-02 — Per-Table RLS Policy Plan (follow-up to BUG-RLS-01)

**Status:** PLAN / draft — not yet scheduled.
**Blocks:** nothing. This is the non-urgent sequel to BUG-RLS-01.
**Predecessor:** BUG-RLS-01 (PR #59, merged) enabled Row Level Security
on all 27 public-schema tables with **zero policies**, relying on the
Worker's `service_role` `BYPASSRLS` attribute to keep every existing
app path working. Security Advisor errors went from 27 → 0.

## Why this doc exists

RLS-01 is the *safe* hotfix — lock the doors shut for everyone who
isn't `service_role`, keep the app alive because the app only talks
to Postgres as `service_role`. That works today. But it fails the
moment any of the following becomes true:

1. A route starts using the Supabase JS client with the **anon** key
   (e.g. letting the customer browser query `/rest/v1/products`
   directly instead of round-tripping through the Worker).
2. A route starts using the Supabase JS client with the
   **authenticated** key (customer JWT via Supabase Auth).
3. A tool, cron, or admin utility connects as a non-`service_role`
   database user.

Any of those will return zero rows with no error surface — a silent
data outage. Before that happens we need real policies.

## Scope

For each of the 27 tables, author `SELECT` / `INSERT` / `UPDATE` /
`DELETE` policies that describe the *correct* access surface for the
`anon` and `authenticated` Postgres roles. `service_role` continues
to bypass RLS (no policy needed for it; it's the `BYPASSRLS`
attribute at the role level). `postgres` (superuser) likewise.

## Table classification (27 tables → 4 groups)

The tables fall into four access-pattern groups. Each group becomes
one atomic sub-PR. Order is from lowest-risk to highest so we get
signal before touching sensitive paths.

### Group 1 — **public-readable** (9 tables)

Anon read. No writes from anon or authenticated. Writes still go
through the Worker's `service_role`.

| Table                      | `anon SELECT`     | `authenticated SELECT` | Writes         |
| -------------------------- | ----------------- | ---------------------- | -------------- |
| `brands`                   | allow             | allow                  | service_role   |
| `categories`               | allow (`visible_frontend = true`) | allow (`visible_frontend = true`) | service_role   |
| `products`                 | allow (`visible_frontend = true`) | allow (`visible_frontend = true`) | service_role   |
| `product_images`           | allow             | allow                  | service_role   |
| `combo_sets`               | allow (`visible_frontend = true`) | allow (`visible_frontend = true`) | service_role   |
| `combo_set_items`          | allow             | allow                  | service_role   |
| `i18n_strings`             | allow             | allow                  | service_role   |
| `shipping_zones`           | allow             | allow                  | service_role   |
| `shipping_province_configs`| allow             | allow                  | service_role   |

**Notes**
- `categories`, `products`, `combo_sets` MUST filter on
  `visible_frontend = true` in the anon + authenticated policies so
  admin-staged rows cannot leak to the public browser.
- `_frontend` / `_backend` flag drift regression is already guarded
  by A06.5's `DriftBanner` at the app layer; the RLS filter here is
  belt-and-braces.

### Group 2 — **customer-owned** (6 tables)

Authenticated read/write limited to the row owner. Anon denied.
Owner-key column varies per table.

| Table              | Ownership column | `anon` | `authenticated SELECT`         | `authenticated INSERT / UPDATE / DELETE`      |
| ------------------ | ---------------- | ------ | ------------------------------ | ---------------------------------------------- |
| `customers`        | `id = auth.uid()` | deny  | self only                      | self only (UPDATE; no DELETE; INSERT = signup) |
| `customer_documents` | `customer_id`  | deny  | self only                      | self only                                      |
| `orders`           | `customer_id`    | deny  | self only                      | INSERT only (checkout); no UPDATE / DELETE     |
| `order_items`      | `orders.customer_id` (join) | deny | self via order       | INSERT only (checkout)                         |
| `order_status_logs`| `orders.customer_id` (join) | deny | self via order       | deny (server-side only)                        |
| `payment_slips`    | `orders.customer_id` (join) | deny | self via order       | INSERT only                                    |

**Notes**
- Decision needed before this sub-PR: are we using **Supabase Auth**
  for customer identity or a custom JWT? Policies referencing
  `auth.uid()` only work with the former. If custom, we need a
  `current_setting('request.jwt.claims', true)::json->>'sub'` style
  lookup. Worker today uses custom hono/jwt; browser currently has no
  direct DB session at all, so this is deferred until we actually
  expose a direct-from-browser path.
- Checkout inserts come from the Worker (`service_role`), so
  `authenticated INSERT` on `orders` etc. is future-facing (direct
  browser checkout over PostgREST). Start with **deny** to keep the
  surface narrow; open up per explicit roadmap item.

### Group 3 — **admin-only** (11 tables)

Anon and authenticated **both deny**. Only `service_role` (Worker
admin routes) and `postgres` (dashboard) touch these. This is the
largest group and the lowest-risk because the policies are literally
`false`.

| Table                     | `anon` | `authenticated` | `service_role` |
| ------------------------- | ------ | --------------- | -------------- |
| `admin_users`             | deny   | deny            | full           |
| `audit_logs`              | deny   | deny            | full           |
| `system_configs`          | deny   | deny            | full           |
| `notification_logs`       | deny   | deny            | full           |
| `finance_categories`      | deny   | deny            | full           |
| `finance_transactions`    | deny   | deny            | full           |
| `after_sales_events`      | deny   | deny            | full           |
| `inventory_units`         | deny   | deny            | full           |
| `inventory_status_logs`   | deny   | deny            | full           |
| `product_stock_logs`      | deny   | deny            | full           |
| `availability_calendar`   | deny   | deny            | full           |

### Group 4 — **system internal** (1 table)

| Table                | `anon` | `authenticated` | `service_role` | `postgres` |
| -------------------- | ------ | --------------- | -------------- | ---------- |
| `_prisma_migrations` | deny   | deny            | full           | full       |

Identical posture to admin-only. Broken out because this is managed
by Prisma, not by application code — any change here MUST be
auditable against Prisma's expectations (Prisma's migration engine
connects as the role in `DATABASE_URL`, which already has
`BYPASSRLS`, so the policy never matters for it, but explicit
deny-all for non-privileged roles is the correct posture).

## Sub-PR breakdown

5 atomic PRs, in order. Each has the same shape: one SQL migration
file + one vitest test file that asserts the exact set of policies
exists for the tables in that group.

| # | Branch | Group | Expected risk |
| - | ------ | ----- | ------------- |
| 1 | `devin/bug-rls-02-group4-prisma-internal` | Group 4 (1 table) | green |
| 2 | `devin/bug-rls-02-group3-admin-only`      | Group 3 (11 tables) | green |
| 3 | `devin/bug-rls-02-group1-public-readable` | Group 1 (9 tables) | yellow — requires anon smoke tests post-deploy |
| 4 | `devin/bug-rls-02-group2a-customers-schema-decision` | Group 2 design-decision doc PR | n/a (doc only) |
| 5 | `devin/bug-rls-02-group2b-customer-owned` | Group 2 (6 tables) | red — depends on sub-PR 4's decision |

Sub-PRs 1 and 2 can merge in any order (both are deny-only for
non-bypass roles; service_role continues to work). Sub-PR 3 ships
`anon`-facing policies — needs a post-deploy smoke test from a
browser directly hitting Supabase's `/rest/v1/*` to prove customer
reads work. Sub-PRs 4 + 5 are gated on an architecture decision
(Supabase Auth vs custom JWT for customers) and should not ship
until that's settled.

## Per-sub-PR template

Each sub-PR adds:

1. `packages/shared/prisma/migrations/<timestamp>_rls_policies_<group>/migration.sql`
   - `CREATE POLICY` statements, wrapped in `BEGIN/COMMIT`.
   - One file per group, idempotent (use `DROP POLICY IF EXISTS` then
     `CREATE POLICY` so re-runs don't error).
2. `apps/api/src/__tests__/bug-rls-02-<group>-policies.test.ts`
   - Layer 1 (always runs): parses the migration SQL, asserts the
     canonical set of `(table, role, command)` tuples exists.
   - Layer 2 (`skipIf(!DATABASE_URL)`): queries `pg_policies` live
     and asserts the same set.
3. (group 3 only) `apps/customer/tests/e2e/rls-anon-smoke.spec.ts`
   - Optional: a Playwright smoke that hits a public PostgREST
     endpoint (if such a path exists) and asserts the read works.

## Rollback protocol

All policies are additive (they relax an otherwise deny-all RLS
posture). Rollback is `DROP POLICY IF EXISTS <name> ON <table>` per
sub-PR — that returns the table to post-RLS-01 state (RLS on, no
policies, everything denied for non-bypass roles). The service_role
path keeps working either way.

## Scheduling

Not urgent. Kick off when either:

- We schedule a direct-from-browser data path for customers (e.g.
  Supabase Auth adoption). That forces the decision in sub-PR 4.
- Security audit asks for "RLS policies, not just RLS enabled".

Until then, BUG-RLS-01's RLS-enabled-no-policies posture is the
resting security baseline.

## Explicitly out of scope

- Supabase Storage bucket policies (separate concern, tracked
  elsewhere).
- Per-column grants.
- PostgREST exposure config changes (`supabase_private` schema, RPC
  functions, etc.).
- Customer auth-system decision (pre-requisite for group 2, but that
  decision is a product-shape call, not an RLS call).

## See also

- `docs/bug504-wave-final-report.md` — forensic context for the
  BUG-504 category wave that exposed drift behaviours which in turn
  motivated formal access policies.
- `packages/shared/prisma/migrations/20260423_040_enable_rls_bug_rls_01/migration.sql`
  — the RLS-01 enable migration that this plan follows up on.
- `apps/api/src/__tests__/bug-rls-01-rls-enabled.test.ts` — the
  drift guard this plan's sub-PRs will extend with policy-shape
  assertions.
