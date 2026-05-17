# Final Handover Document — Sprint BUG-543 → BUG-549

> **Sprint period**: 2026-05-14 – 2026-05-17
> **Engineer**: Devin (AI)
> **Reviewer**: @pairodorz-netizen (Qew)
> **Status**: All PRs merged, production deployed & verified, sprint closed

---

## Table of Contents

1. [Sprint Summary](#sprint-summary)
2. [PR Registry](#pr-registry)
3. [Root Cause Analysis](#root-cause-analysis)
4. [Production Verification](#production-verification)
5. [Data Migrations](#data-migrations)
6. [Lessons Learned](#lessons-learned)
7. [Playwright E2E Coverage](#playwright-e2e-coverage)
8. [Production URLs & Baselines](#production-urls--baselines)
9. [Open Risks](#open-risks)
10. [Next-Sprint Backlog](#next-sprint-backlog)
11. [Architecture Reference](#architecture-reference)

---

## Sprint Summary

This sprint focused on **pre-launch hardening** of the CuteBunny Rental platform, covering finance calculation fixes, i18n Thai-only enforcement, UX polish, PDPA compliance, and P/L consistency across admin views.

| Category | PRs | Bugs | Impact |
|---|---|---|---|
| Finance & Accounting | 5 | BUG-543, BUG-544, BUG-548, BUG-549 | P&L formula, dedup, monthly breakdown, view consistency |
| i18n / Locale | 2 | BUG-544, BUG-546 | Thai-only mode for customer + admin |
| UX / Display | 2 | BUG-543, BUG-545 | Popup variants, thumbnail fallback |
| PDPA Compliance | 1 | BUG-547 | Deleted customer masking + PDPA banner |
| Infrastructure | 2 | — | Handover doc, Playwright CI job |

**Total**: 12 atomic PRs (#193, #196–#207), all CI-gated (11–13 checks), all verified on production.

---

## PR Registry

| # | PR | Bug | Title | Merge Commit | Date (UTC) | CI |
|---|---|---|---|---|---|---|
| 1 | [#196](https://github.com/pairodorz-netizen/cutebunny-rental/pull/196) | BUG-544 | Customer: disable EN/ZH locale, Thai-only mode | `6e58c0c` | 2026-05-15 | 11/11 |
| 2 | [#197](https://github.com/pairodorz-netizen/cutebunny-rental/pull/197) | BUG-543/544 | API+Admin: fix P&L formula + Finance Summary VC | `6344cd7` | 2026-05-15 | 11/11 |
| 3 | [#198](https://github.com/pairodorz-netizen/cutebunny-rental/pull/198) | BUG-543 | Data: dedup ORD-26042674 finance transactions | `44b01f9` | 2026-05-15 | 11/11 |
| 4 | [#199](https://github.com/pairodorz-netizen/cutebunny-rental/pull/199) | BUG-545 | Customer: product thumbnail fallback | `30bf64e` | 2026-05-16 | 11/11 |
| 5 | [#200](https://github.com/pairodorz-netizen/cutebunny-rental/pull/200) | BUG-546 | Admin: hide globe/EN locale switcher | `c314a16` | 2026-05-16 | 11/11 |
| 6 | [#201](https://github.com/pairodorz-netizen/cutebunny-rental/pull/201) | BUG-547 | Admin+API: deleted customer display + PDPA banner | `9466ca5` | 2026-05-16 | 11/11 |
| 7 | [#193](https://github.com/pairodorz-netizen/cutebunny-rental/pull/193) | BUG-543 | Customer: 1-day range triggers all popup variants | `27dcb3f` | 2026-05-16 | 11/11 |
| 8 | [#203](https://github.com/pairodorz-netizen/cutebunny-rental/pull/203) | BUG-548 | API: finance monthly breakdown includes VC | `8ad8729` | 2026-05-16 | 11/11 |
| 9 | [#204](https://github.com/pairodorz-netizen/cutebunny-rental/pull/204) | — | Docs: handover document (interim) | `e5d6b80` | 2026-05-16 | 11/11 |
| 10 | [#205](https://github.com/pairodorz-netizen/cutebunny-rental/pull/205) | — | Playwright full-suite CI job | `81200bf` | 2026-05-16 | 13/13 |
| 11 | [#206](https://github.com/pairodorz-netizen/cutebunny-rental/pull/206) | BUG-549 | API+Admin: unify P/L formula across all views | `da14e83` | 2026-05-17 | 13/13 |
| 12 | [#207](https://github.com/pairodorz-netizen/cutebunny-rental/pull/207) | BUG-549 | Hotfix: use computeProductPL() for list view | `efc1000` | 2026-05-17 | 13/13 |

---

## Root Cause Analysis

### Category: Finance / Pricing

| Bug | Root Cause | Fix |
|---|---|---|
| **BUG-543 (P&L formula)** | Product detail used actual revenue from order items; product list used estimated `rental_count × 1day_price`. Variable cost not deducted in list view. | Created `computeProductPL()` shared helper; refactored all endpoints to use it. |
| **BUG-543 (dedup)** | ORD-26042674 had duplicate +590 rental_revenue from payment verification + returned-status triggers, plus a -590 BUG-517 reconciliation reversal. | Migration: delete duplicate +590 and -590 reversal, keep single "Payment verified" +590. |
| **BUG-548 (monthly breakdown)** | Variable costs were added to grand total `adjustedTotalExpenses` but not distributed into per-period breakdown. Period loop only aggregated `financeTransaction` records. | Added date-filtered `$queryRaw` join to calculate VC per period from order_items → orders → products. |
| **BUG-549 (P/L consistency)** | Product list endpoint used inline formula with `$queryRaw` revenue map, bypassing the shared `computeProductPL()` helper. Raw SQL may behave differently from Prisma on Cloudflare Workers. | **#206**: Created shared helper + pre-computed API fields. **#207 (hotfix)**: Replaced raw SQL with batch `orderItem.findMany()` → `computeProductPL()`. Added frontend fallback. |

### Category: i18n

| Bug | Root Cause | Fix |
|---|---|---|
| **BUG-544** | Customer app had locale switcher (globe dropdown) + EN/ZH routes active despite Thai-only business requirement. | Hid globe, set `defaultLocale: 'th'`, added 301 redirects for `/en/*` `/zh/*` → `/th/*`. |
| **BUG-546** | Admin app (separate Vite SPA) still had globe/EN dropdown in header and login page. | Removed `<LocaleSwitcher />` from header + login, set `lng: 'th'` in i18next config. |

### Category: UX

| Bug | Root Cause | Fix |
|---|---|---|
| **BUG-543 (popups)** | Delivery risk, queue collision, previous return popups didn't fire for 1-day ranges (same start+end date). The range completion logic skipped re-click on same date. | Added `rangeStartRef` to track whether the range is being started vs completed. |
| **BUG-545** | 14/15 products had empty `images[]` array in DB. Frontend showed raw text placeholder instead of a visual fallback. | Created `<ProductImage />` component with SVG dress silhouette fallback + `onError` handling. |

### Category: Compliance

| Bug | Root Cause | Fix |
|---|---|---|
| **BUG-547** | Soft-deleted customers (PDPA right-to-be-forgotten) showed raw `[Deleted customer]` text without visual distinction or PDPA context. Customer name input remained editable. | Added `isDeletedCustomer()` helper, PDPA amber banner, italic+muted styling, disabled name input. |

---

## Production Verification

### Finance & Accounting ✓
- [x] Memo Doll Top P&L: Revenue=290, VC=-100, Gross=190, Net P&L=**-810** THB
- [x] Finance Summary: Total Revenue=2,750 THB, Total Expenses=300 THB
- [x] Monthly breakdown: Expenses distributed per month (not 0)
- [x] ROI Rankings: Consistent with product detail values
- [x] ORD-26042674 dedup: 1 row remaining (+590), net revenue=590 THB
- [x] Formula verification: `computeProductPL()` unit tests 13/13 pass

### i18n / Locale ✓
- [x] Customer: Globe hidden, all pages Thai, branding EN
- [x] Customer redirect: `/en/*` → 301 → `/th/*`
- [x] Admin login: No globe/EN, Thai labels
- [x] Admin sidebar: Thai labels throughout

### UX / Display ✓
- [x] Product thumbnails: 15/15 with image or SVG fallback
- [x] Popup variants: All 3 types fire correctly for 1-day ranges
- [x] Cancel/reset: No stale popup on next selection

### PDPA Compliance ✓
- [x] `[Deleted customer]` italic + masked phone
- [x] PDPA amber banner in expanded + edit views
- [x] Customer name input disabled for deleted customers
- [x] Normal orders unaffected

### Customer E2E Audit (6/6 PASS) ✓
- [x] Landing page, product list, product detail, locale redirect, cart, profile

### Cloudflare API Health ✓
- [x] Post-hotfix: 16 Success / 0 Errors (1hr window)
- [x] Deploy API workflow: all 3 recent runs completed successfully

---

## Data Migrations

### ORD-26042674 Finance Transaction Dedup (PR #198)

**Executed**: 2026-05-15 on production Supabase (atomic transaction)

| Action | Row ID | Amount | Note |
|---|---|---|---|
| DELETED | `0cf9e80e-...` | +590 | "Rental revenue" (duplicate) |
| DELETED | `ba1f0251-...` | -590 | "BUG-517 reconciliation" (reversal) |
| KEPT | `1525c3b2-...` | +590 | "Payment verified" (correct) |

**Backup**: `finance_transactions_backup_bug543` table (2 rows, for rollback if needed)
**Rollback**: `packages/shared/prisma/migrations/20260513_.../rollback.sql`
**Retention**: Recommend dropping backup table after 30 days (2026-06-15)

---

## Lessons Learned

### 1. Formula Duplication is a Silent Killer (BUG-549 → #207 hotfix)

**Problem**: The product list endpoint computed P/L using inline arithmetic + raw SQL aggregate, while the product detail used `computeProductPL()`. Both _looked_ correct in isolation but produced different results (-710 vs -810) because the inline formula missed variable cost deduction.

**Lesson**: When a business formula exists in a shared helper, ALL consumers must call that helper — never duplicate the formula inline, even if it seems simpler. This was caught post-merge on production.

**Prevention**: The `computeProductPL()` helper is now the single source of truth. A unit test (`bug-549-pl-consistency.test.ts`) validates the helper against known baselines.

### 2. Raw SQL on Cloudflare Workers Needs Caution

**Problem**: `$queryRaw` on Cloudflare Workers with PrismaNeon may behave differently from standard Prisma. The `getProductRevenueMap()` raw SQL was replaced with Prisma `findMany()` in the hotfix.

**Lesson**: Prefer Prisma ORM queries over raw SQL on Cloudflare Workers unless performance absolutely requires it. When raw SQL is needed, always have a fallback path.

### 3. Frontend Should Always Have a Fallback for API Fields

**Problem**: The new `net_pl` API field could be undefined if the Cloudflare Worker hadn't redeployed yet, or if the browser cached an old API response.

**Lesson**: When adding new API response fields, the frontend should always fallback gracefully — especially when the API and frontend deploy independently (Vercel vs Cloudflare Workers).

### 4. Atomic PRs + CI Gate = Safe Velocity

**Pattern used**: 12 atomic PRs, each CI-gated (lint + typecheck + unit tests + E2E + build), each verified on preview deployment before merge. This caught issues early (e.g., PDPA banner not showing in PR #201 first review → fixed in same PR).

### 5. Data Migrations Need Dry-Run + Backup + Idempotent Guard

**Pattern used** (PR #198): dry-run SQL on production → user verifies → atomic migration with `BEGIN/COMMIT` → backup table → idempotent guard (`DELETE only if count > 1`). This prevented any data loss risk.

---

## Playwright E2E Coverage

Added in PR #205 (`.github/workflows/playwright-e2e.yml`):

| Suite | File | Tests | Coverage |
|---|---|---|---|
| Customer Smoke | `customer-smoke.spec.ts` | 6 | Landing, thumbnails (BUG-545), calendar, popup variants (BUG-543) |
| Admin Smoke | `admin-smoke.spec.ts` | 5 | Login Thai UI (BUG-546), no globe, auth guard, PDPA, P/L formula |
| i18n Locale | `i18n-locale.spec.ts` | 3 | `/en/*` `/zh/*` → 301 redirect, no locale switcher, Thai labels |

**Matrix**: chromium + webkit (2 browsers × 14 tests = 28 test runs per PR)
**Trigger**: PRs touching `apps/customer/`, `apps/admin/`, `packages/shared/`, `tests/e2e/`
**Local**: `pnpm test:e2e` or `pnpm test:e2e --project=chromium`

**Note**: Admin smoke P/L test (`admin-smoke.spec.ts:94`) calls production API — skips gracefully on 401 (auth required). Formula validation runs only when API responds with 200.

---

## Production URLs & Baselines

| App | URL | Platform | Status |
|---|---|---|---|
| Customer | https://customer-eta-ruby.vercel.app | Vercel (Next.js) | Healthy |
| Admin | https://admin-eight-rouge.vercel.app | Vercel (Vite SPA) | Healthy |
| API | https://cutebunny-api.cutebunny-rental.workers.dev | Cloudflare Workers | 16/0 (success/error) |
| Database | Supabase (PostgreSQL) | Supabase | Healthy |

**Baseline values** (post-sprint):
- Memo Doll Top (T021): Revenue=290, VC=100, Cost=1000, Selling=0, Net P&L=-810
- ORD-26042674: 1 finance_transaction row, net_revenue=590
- Finance Summary: Revenue=2,750 THB, Expenses=300 THB

---

## Open Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| 1 | **Admin P/L test skips on 401** | Low | Playwright P/L formula test requires admin auth; currently skips gracefully. Consider adding E2E_ADMIN_TOKEN env var for CI. |
| 2 | **Backup table retention** | Info | `finance_transactions_backup_bug543` should be dropped after 2026-06-15 (30-day retention). |
| 3 | **Translation files retained** | Info | en.json/zh.json kept in both customer + admin. `<LocaleSwitcher />` commented out. Ready for re-enable if needed. |
| 4 | **Cloudflare Worker cold starts** | Low | If API returns 1101, redeploy via GitHub Actions "Deploy API" workflow_dispatch. |

---

## Next-Sprint Backlog

### P1 — Should Fix Before Launch

| # | Task | Description | Effort |
|---|---|---|---|
| 1 | **Stripe webhook integration testing** | Verify payment webhooks (checkout.session.completed, payment_intent.succeeded) are processed correctly. Current flow uses tentative holds with 30-min stale cleanup — confirm webhook triggers status transitions. | M |
| 2 | **R2/Supabase product image upload** | 14/15 products use SVG fallback (PR #199). Upload actual product photos to Supabase Storage or Cloudflare R2 for production quality. | S |
| 3 | **Calendar edge cases** | Validate month-boundary bookings (e.g., book May 30→Jun 2), timezone handling for Thai users (UTC+7), and queue collision detection across month boundaries. | M |
| 4 | **Order status email notifications** | Confirm order status change emails (confirmed → shipped → returned) are sending correctly with Thai content. | S |

### P2 — Nice to Have

| # | Task | Description | Effort |
|---|---|---|---|
| 5 | **Admin E2E with auth** | Add `E2E_ADMIN_TOKEN` secret to CI and expand Playwright admin tests beyond login page (orders, finance numbers, P&L consistency at UI level). | M |
| 6 | **Performance: products list query** | PR #207 added batch `orderItem.findMany()` per page. For large catalogs (100+ products), consider pre-computed P/L columns or materialized view. | S |
| 7 | **Accessibility audit** | Run Lighthouse accessibility on customer site. Current score unknown — ensure WCAG 2.1 AA compliance for product images (alt text), form labels, color contrast. | M |
| 8 | **SEO meta tags** | Customer product pages need `<meta>` og:image, description for social sharing. Currently may show generic Next.js defaults. | S |
| 9 | **Cleanup backup table** | Drop `finance_transactions_backup_bug543` after 2026-06-15 retention period. | XS |
| 10 | **Re-evaluate multi-language** | If business decides to support EN/ZH again post-launch, uncomment LocaleSwitcher, re-enable middleware redirects, and run i18n parity tests. | L |

---

## Architecture Reference

```
cutebunny-rental/
├── apps/
│   ├── customer/     # Next.js + next-intl (Vercel)
│   ├── admin/        # Vite SPA + React Router + i18next (Vercel)
│   └── api/          # Cloudflare Workers (Hono + Prisma)
├── packages/
│   └── shared/       # Prisma schema, shared utils, customer-pii helpers
├── tests/
│   └── e2e/          # Playwright (chromium + webkit)
└── docs/             # Handover docs, runbooks, specs
```

**Key helpers**:
- `apps/api/src/lib/pl-calc.ts` — `computeProductPL()`, `computeProductROI()` (single source of truth)
- `@cutebunny/shared/customer-pii` — `isCustomerDeleted()`, `maskCustomerPII()`, `customerDisplayName()`
- `apps/customer/src/components/product-image.tsx` — Reusable image with SVG fallback
- `apps/admin/src/lib/api.ts` — `isDeletedCustomer()` client-side detection

**CI pipeline** (13 checks):
- lint, typecheck, test (1100 unit tests), build-admin, build-customer
- e2e (chromium), e2e (webkit), e2e-categories-parity
- security-audit, schema-drift-guard
- Vercel Preview (admin + customer)

---

*Document generated: 2026-05-17*
*Sprint Devin session: https://app.devin.ai/sessions/b75a62cd91904689ae2eebfafde68f0a*
*Supersedes: docs/handover-sprint-bug543-547.md (interim version)*
