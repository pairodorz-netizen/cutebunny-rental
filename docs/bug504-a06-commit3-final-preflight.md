# BUG-504-A06 Commit 3 FINAL_CUTOVER — Pre-flight Checklist

**Status**: HELD
**Earliest unlock**: 2026-04-23 13:00 UTC (24 h hold, started at A06 commit 2
merge `37dac60` on 2026-04-22 13:00 UTC)
**Additional gate**: explicit `FINAL_CUTOVER` ack from owner
**Branch** (when opened): `devin/BUG504-A06-commit3-final-cutover` off `main`

## 0. What this commit does

Closes out the A06 three-commit column flip. After commit 2, the
`products` table has:

- `category_id UUID NOT NULL` — FK to `categories(id)`
- `category ProductCategory NOT NULL` — the legacy enum column (now redundant)
- A DB trigger `products_sync_category_trg` that auto-derives one from the
  other on insert/update (dual-write)

Commit 3 FINAL removes everything that's now redundant:

1. Drop trigger `products_sync_category_trg` + function `products_sync_category()`
2. Drop column `products.category`
3. Drop enum type `"ProductCategory"`
4. Remove `Product.category` field + `ProductCategory` enum from `schema.prisma`
5. Remove `resolveCategoryPair` + dual-write branches from
   `apps/api/src/routes/admin/products.ts`
6. Replace legacy `/api/v1/admin/settings/categories` (GET) handler with
   `410 Gone` + `Sunset` + `Link: </api/v1/admin/categories>; rel="successor-version"`
   per RFC 8594
7. Un-skip vitest gates 8 / 11 / 12 / 13 in `bug504-a06-products-fk.test.ts`
8. Add new `bug504-a06-legacy-route-gone.test.ts` asserting the 410 +
   headers contract

After commit 3 merges, A04's dropdown cutover becomes load-bearing —
there is no legacy path anymore.

## 1. Pre-flight gates — ALL must be true before opening PR

### 1.1 Time + owner ack

- [ ] Current UTC time ≥ 2026-04-23 13:00 UTC
- [ ] Owner sent explicit `FINAL_CUTOVER` ack in chat
- [ ] No active P0 incidents on admin or customer SPAs

### 1.2 A06 step 2/3 state still healthy on prod

Re-verify by owner (Supabase SQL editor — Devin cannot run these without
DB access):

```sql
-- Row count sanity
SELECT
  COUNT(*)                                   AS total_products,
  COUNT(*) FILTER (WHERE category_id IS NULL) AS null_fks,
  COUNT(*) FILTER (WHERE category IS NULL)    AS null_legacy;
-- Expected: total=16, null_fks=0, null_legacy=0

-- Dual-write derivation consistency
SELECT
  COUNT(*)                                                                     AS total,
  COUNT(*) FILTER (WHERE LOWER(category::text) != (SELECT slug FROM categories c WHERE c.id = p.category_id)) AS mismatched
FROM products p;
-- Expected: total=16, mismatched=0

-- Trigger + function still installed
SELECT tgname FROM pg_trigger WHERE tgname = 'products_sync_category_trg';
SELECT proname FROM pg_proc   WHERE proname = 'products_sync_category';
-- Expected: one row each
```

- [ ] `null_fks = 0`
- [ ] `null_legacy = 0`
- [ ] `mismatched = 0`
- [ ] Trigger + function still present (= step 2/3 never got rolled back)

### 1.3 A06.5 drift guard is clean

- [ ] `GET https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/categories`
  returns the 7 SoT slugs unchanged (wedding / evening / cocktail / casual /
  costume / traditional / accessories)
- [ ] Admin SPA `/settings?tab=categories` is NOT displaying
  `<DriftBanner/>` when loaded fresh (owner eyeballs — visible red banner
  = drift is active, blocks cutover until resolved)
- [ ] Supabase `audit_log` query (if owner or Devin has access via A07.5)
  shows zero `category.drift_detected` rows since A06.5 merge, OR only
  rows matching drift that has since been manually resolved

### 1.4 CI green on tip of `main`

- [ ] `main` is at a SHA ≥ `1876b16` (A07 merge) with all 10 checks green
- [ ] A07.5 token flip has either shipped OR been explicitly deferred
  (commit 3 does not require it — A07.5 only adds coverage, it does not
  gate removal of the legacy path)

## 2. Commit 3 execution plan (when unlocked)

### 2.1 Branch setup

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git checkout -b devin/BUG504-A06-commit3-final-cutover
```

### 2.2 RED — write failing tests first

Add `apps/api/src/__tests__/bug504-a06-legacy-route-gone.test.ts`:

- `GET /api/v1/admin/settings/categories` (legacy) must return **410**
- Response must include `Sunset:` header with the commit-3 merge date
- Response must include
  `Link: </api/v1/admin/categories>; rel="successor-version"`
- Body must match the project's error envelope shape

Un-skip gates 8 / 11 / 12 / 13 in `bug504-a06-products-fk.test.ts`:

- Gate 8 — admin POST `/api/v1/admin/products` accepts `{ category: 'wedding' }`
  and server resolves `category_id` without dual-write
- Gates 11–13 — schema-drift guards: `products.category` column is
  absent, `ProductCategory` enum is absent, trigger + function are absent

Push the RED commit. CI is expected red on `test` until GREEN lands.

### 2.3 GREEN — implementation

SQL migration step 3/3 (owner runs in Supabase):

```sql
BEGIN;

-- a) Drop trigger + function
DROP TRIGGER IF EXISTS products_sync_category_trg ON products;
DROP FUNCTION IF EXISTS products_sync_category();

-- b) Drop the legacy enum column
ALTER TABLE products DROP COLUMN IF EXISTS category;

-- c) Drop the enum type itself
DROP TYPE IF EXISTS "ProductCategory";

COMMIT;

-- Verify
SELECT column_name FROM information_schema.columns
WHERE table_name = 'products' AND column_name IN ('category', 'category_id');
-- Expected: one row, `category_id`
SELECT typname FROM pg_type WHERE typname = 'ProductCategory';
-- Expected: zero rows
SELECT tgname FROM pg_trigger WHERE tgname = 'products_sync_category_trg';
-- Expected: zero rows
```

App-layer changes:

- `packages/shared/prisma/schema.prisma`: remove `enum ProductCategory`,
  remove `Product.category` field. Run `pnpm --filter @cutebunny/shared db:generate`.
- `apps/api/src/routes/admin/products.ts`: delete `resolveCategoryPair`,
  strip all dual-write branches. POST/PATCH/CSV paths write only
  `categoryId`.
- `apps/api/src/routes/admin/settings.ts`: replace the legacy
  `GET /api/v1/admin/settings/categories` handler with:
  ```ts
  adminSettings.get('/categories', (c) => {
    c.header('Sunset', new Date().toUTCString());
    c.header('Link', '</api/v1/admin/categories>; rel="successor-version"');
    return c.json(
      { error: { code: 'GONE', message: 'Legacy endpoint removed; use /api/v1/admin/categories.' } },
      410
    );
  });
  ```
- `apps/admin/src/lib/api.ts`: delete dead `adminApi.settings.categories`
  wrappers (already unused after A04).
- Leave `adminApi.settings.postAuditLog` (A06.5) intact — unrelated.

Push GREEN commit. Expect `test` job green.

### 2.4 PR open

- Title: `feat(bug504-a06): step 3/3 drop legacy category column + 410 legacy endpoint (FINAL)`
- Body: link this checklist, paste Supabase verification output, list
  every test un-skipped.
- Tag risk: **RED** (destructive schema change, legacy-endpoint contract
  change). Review checklist must cover rollback plan.

### 2.5 Rollback plan (owner-side, if prod breaks post-merge)

The three destructive operations are all reversible if caught fast:

```sql
-- If the admin UI goes blank, we can temporarily re-add the trigger
-- + function + a NULLable category column, then manually re-seed the
-- column from the category_id FK. This is emergency-only — it rolls
-- back the schema but NOT the deleted app-layer dual-write code.

-- a) Re-add the enum (names hardcoded from migration 20260420000000)
CREATE TYPE "ProductCategory" AS ENUM (
  'wedding','evening','cocktail','casual','costume','traditional','accessories'
);

-- b) Re-add the column, allowing NULL while we backfill
ALTER TABLE products ADD COLUMN category "ProductCategory" NULL;

-- c) Backfill from the FK
UPDATE products p
SET    category = (SELECT c.slug::text::"ProductCategory" FROM categories c WHERE c.id = p.category_id);

-- d) Re-create trigger + function (copy from migration 20260421000000)

-- e) Re-deploy the previous Worker + admin SPA (pre commit-3 build)
--    via Vercel's "Promote to Production" on the last green deploy.
```

### 2.6 Post-merge smoke tests (Devin runs these the moment it flips)

- `curl -sI https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/admin/settings/categories`
  → `HTTP/1.1 410` + `Sunset:` + `Link: <…>; rel="successor-version"`
- `curl -s .../api/v1/categories` → still returns the 7 SoT slugs
- Admin SPA `/settings?tab=categories` loads without a 5xx (the legacy
  dead-code path is gone, so this is a live test of the dropdown cutover)
- Admin SPA product-create + product-edit flow end-to-end with any
  existing category slug — the server writes `category_id` alone
- A06.5 `<DriftBanner/>` remains absent (both endpoints still agree)

Any smoke-test regression triggers the §2.5 rollback.

## 3. Owner-ack protocol

The string `FINAL_CUTOVER` in the owner's message is the only ack
Devin accepts to start commit 3 work. Lowercase, sentence-cased,
or paraphrases do not qualify — the literal token is required to
make the intent auditable post-hoc. Devin must also confirm the
wall-clock gate (§1.1) before branching.

## 4. Related docs

- `docs/bug504-wave-final-report.md` — wave summary + prod evidence
- A05 Playwright guard: `tests/e2e/categories-parity.spec.ts`
- A06.5 guard layer:
  `packages/shared/src/categories-drift-guard.ts`,
  `apps/admin/src/lib/categories-drift-guard.ts`,
  `apps/admin/src/components/drift-banner.tsx`
