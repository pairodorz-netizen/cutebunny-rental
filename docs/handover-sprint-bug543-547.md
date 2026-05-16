# Handover Document — Sprint BUG-543 → BUG-548

> **Sprint period**: 2026-05-15 – 2026-05-16
> **Engineer**: Devin (AI)
> **Reviewer**: @pairodorz-netizen (Qew)
> **Status**: All PRs merged, production deployed & verified

---

## Table of Contents

1. [Sprint Summary](#sprint-summary)
2. [PR Registry](#pr-registry)
3. [Files Changed Per PR](#files-changed-per-pr)
4. [Production URLs](#production-urls)
5. [Production Verification Checklist](#production-verification-checklist)
6. [Data Migrations](#data-migrations)
7. [Known Issues & Tech Debt](#known-issues--tech-debt)
8. [Remaining Backlog](#remaining-backlog)

---

## Sprint Summary

This sprint focused on **pre-launch hardening** of the CuteBunny Rental platform, covering finance calculation fixes, i18n Thai-only enforcement, UX improvements, and PDPA compliance.

| Category | Count | Bugs |
|---|---|---|
| Finance & Accounting | 3 PRs | BUG-543 (P&L formula), BUG-543 (dedup), BUG-548 (monthly breakdown) |
| i18n / Locale | 2 PRs | BUG-544 (customer Thai-only), BUG-546 (admin Thai-only) |
| UX / Display | 2 PRs | BUG-545 (thumbnails), BUG-543 (popup 1-day range) |
| Compliance (PDPA) | 1 PR | BUG-547 (deleted customer display) |

**Total**: 8 atomic PRs, all CI-gated (11/11 checks), all manually verified on production before merge.

---

## PR Registry

| # | PR | Bug | Title | Merge Commit | Date (UTC) |
|---|---|---|---|---|---|
| 1 | [#196](https://github.com/pairodorz-netizen/cutebunny-rental/pull/196) | BUG-544 | Customer: disable EN/ZH locale, Thai-only mode | `6e58c0c` | 2026-05-15 |
| 2 | [#197](https://github.com/pairodorz-netizen/cutebunny-rental/pull/197) | BUG-543/544 | API+Admin: fix Product P&L formula + Finance Summary VC | `6344cd7` | 2026-05-15 |
| 3 | [#198](https://github.com/pairodorz-netizen/cutebunny-rental/pull/198) | BUG-543 | Data: dedup ORD-26042674 finance transactions | `44b01f9` | 2026-05-15 |
| 4 | [#199](https://github.com/pairodorz-netizen/cutebunny-rental/pull/199) | BUG-545 | Customer: product thumbnail fallback + broken image handling | `30bf64e` | 2026-05-16 |
| 5 | [#200](https://github.com/pairodorz-netizen/cutebunny-rental/pull/200) | BUG-546 | Admin: hide globe/EN locale switcher, Thai-only mode | `c314a16` | 2026-05-16 |
| 6 | [#201](https://github.com/pairodorz-netizen/cutebunny-rental/pull/201) | BUG-547 | Admin+API: deleted customer display + PDPA banner | `9466ca5` | 2026-05-16 |
| 7 | [#193](https://github.com/pairodorz-netizen/cutebunny-rental/pull/193) | BUG-543 | Customer: 1-day range triggers all popup variants | `27dcb3f` | 2026-05-16 |
| 8 | [#203](https://github.com/pairodorz-netizen/cutebunny-rental/pull/203) | BUG-548 | API: finance monthly breakdown includes variable costs | `8ad8729` | 2026-05-16 |

---

## Files Changed Per PR

### PR #196 — BUG-544: Customer Thai-only mode
```
apps/customer/src/components/header.tsx          # Globe switcher commented out
apps/customer/src/i18n/routing.ts                # defaultLocale → 'th'
apps/customer/src/middleware.ts                   # 301 redirect /en/* /zh/* → /th/*
tests/e2e/categories-parity.spec.ts              # Skip locale-switch parity test
```

### PR #197 — BUG-543/544: Product P&L formula + Finance Summary
```
apps/admin/src/i18n/locales/en.json              # grossProfit, variableCost keys
apps/admin/src/i18n/locales/th.json              # grossProfit, variableCost keys
apps/admin/src/i18n/locales/zh.json              # grossProfit, variableCost keys
apps/admin/src/lib/api.ts                        # API types: gross_profit field
apps/admin/src/pages/product-detail.tsx           # P&L card: Revenue→VC→Gross→Net
apps/api/src/__tests__/bug-544-pl-formula.test.ts # 7 unit tests
apps/api/src/routes/admin/finance.ts             # VC calculation in Finance Summary
apps/api/src/routes/admin/products.ts            # P&L formula: net_pl, gross_profit
```

### PR #198 — BUG-543: Dedup ORD-26042674 finance transactions
```
packages/shared/prisma/migrations/20260513_.../dry-run-select.sql  # 4 verification queries
packages/shared/prisma/migrations/20260513_.../migration.sql       # Idempotent DELETE (2 rows)
packages/shared/prisma/migrations/20260513_.../rollback.sql        # Backup + restore template
```

### PR #199 — BUG-545: Product thumbnail fallback
```
apps/customer/src/app/[locale]/cart/page.tsx           # Use ProductImage
apps/customer/src/app/[locale]/orders/[token]/page.tsx # Use ProductImage
apps/customer/src/app/[locale]/page.tsx                # Use ProductImage (hero)
apps/customer/src/app/[locale]/products/[id]/page.tsx  # Use ProductImage (detail+related)
apps/customer/src/app/[locale]/profile/page.tsx        # Use ProductImage
apps/customer/src/components/product-card.tsx           # Use ProductImage
apps/customer/src/components/product-image.tsx          # NEW: reusable component
```

### PR #200 — BUG-546: Admin Thai-only mode
```
apps/admin/src/components/layout/protected-layout.tsx  # Remove <LocaleSwitcher />
apps/admin/src/i18n/index.ts                           # lng/fallbackLng → 'th'
apps/admin/src/pages/login.tsx                         # Remove <LocaleSwitcher />
```

### PR #201 — BUG-547: Deleted customer display + PDPA banner
```
apps/admin/src/i18n/locales/en.json       # deletedCustomerBanner key
apps/admin/src/i18n/locales/th.json       # deletedCustomerBanner key
apps/admin/src/i18n/locales/zh.json       # deletedCustomerBanner key
apps/admin/src/lib/api.ts                 # isDeletedCustomer() helper
apps/admin/src/pages/orders.tsx           # Italic display + PDPA banner + disabled input
apps/api/src/routes/admin/orders.ts       # _deleted flag in API response
```

### PR #193 — BUG-543: 1-day range popup variants
```
apps/api/src/__tests__/delivery-risk.test.ts              # 58 unit tests
apps/customer/src/app/[locale]/products/[id]/page.tsx     # Risk check integration
apps/customer/src/components/availability-calendar.tsx     # isComplete + rangeStartRef
apps/customer/src/components/delivery-risk-modal.tsx       # Unified popup component
apps/customer/src/messages/en.json                         # Popup wording
apps/customer/src/messages/th.json                         # "เสี่ยงส่งไม่ทัน"
apps/customer/src/messages/zh.json                         # Popup wording
```

### PR #203 — BUG-548: Finance monthly breakdown variable costs
```
apps/api/src/__tests__/bug-526-528-rental-count-parity.test.ts  # Updated $queryRaw mock
apps/api/src/__tests__/bug-548-finance-monthly-breakdown.test.ts # NEW: 3 unit tests
apps/api/src/routes/admin/finance.ts                             # Per-period VC aggregation
```

---

## Production URLs

| App | URL | Platform |
|---|---|---|
| Customer (production) | https://customer-eta-ruby.vercel.app | Vercel (Next.js) |
| Admin (production) | https://admin-eight-rouge.vercel.app | Vercel (Vite SPA) |
| API | Cloudflare Workers | Cloudflare |
| Database | Supabase (PostgreSQL) | Supabase |

---

## Production Verification Checklist

All items verified on production post-merge:

### Finance & Accounting
- [x] **Memo Doll Top (T021) P&L**: Rentals=1, Revenue=+290, VC=100×1=-100, Gross=+190, Net P&L=-810 THB
- [x] **Finance Summary**: Total Revenue=2,750 THB, Total Expenses=300 THB, Net P&L=2,450 THB
- [x] **Monthly breakdown**: Expenses distributed per month (not 0)
- [x] **ROI Rankings**: Consistent with product detail values
- [x] **ORD-26042674 dedup**: 1 row remaining (+590 "Payment verified"), net revenue=590 THB
- [x] **Backup table**: `finance_transactions_backup_bug543` created on Supabase with 2 deleted rows

### i18n / Locale
- [x] **Customer**: Globe dropdown hidden, all pages in Thai
- [x] **Customer redirect**: `/en/*` → 301 → `/th/*`, `/zh/*` → 301 → `/th/*`
- [x] **Admin login**: No globe/EN dropdown, Thai labels (เข้าสู่ระบบผู้ดูแล)
- [x] **Admin sidebar**: Thai labels (แดชบอร์ด, คำสั่งซื้อ, สินค้า, ลูกค้า, ปฏิทิน, การเงิน, ตั้งค่า)
- [x] **Branding**: Hero slogan remains English per AGENTS.md branding rules

### UX / Display
- [x] **Product thumbnails**: 15/15 products display image or SVG placeholder (no text-only cards)
- [x] **Popup variants**: Delivery risk ("เสี่ยงส่งไม่ทัน"), queue collision, previous return all fire correctly
- [x] **1-day range**: Click same date twice → popup fires on 2nd click
- [x] **Cancel reset**: After cancel, no stale popup on next range selection

### PDPA Compliance
- [x] **Deleted customer**: ORD-26042674 + ORD-26048933 show `[Deleted customer]` italic + `***-***-****`
- [x] **PDPA banner (expanded)**: Amber banner "ลูกค้ารายนี้ถูกลบแล้ว — ข้อมูลส่วนตัวถูก mask ตาม PDPA"
- [x] **PDPA banner (edit)**: Banner shown + customer name input disabled
- [x] **Normal orders**: No banner, name input editable

### Customer E2E Audit (6/6 PASS)
- [x] Landing page: hero branding EN + Thai nav + no globe
- [x] Product list: 15 products with fallback images
- [x] Product detail: calendar, pricing, sizes, delivery info
- [x] Locale redirect: /en/* + /zh/* → 301 → /th/*
- [x] Cart + Profile: Thai UI correct
- [x] GitHub open issues: 0

### Cloudflare Observability
- [x] API health: 7 success, 0 errors (baseline at time of audit)

---

## Data Migrations

### ORD-26042674 Finance Transaction Dedup (PR #198)

**Executed on**: Production Supabase (2026-05-15)
**Method**: Atomic BEGIN/COMMIT transaction

| Action | Row ID | Amount | Note |
|---|---|---|---|
| DELETED | `0cf9e80e-...` | +590 | "Rental revenue" (original duplicate) |
| DELETED | `ba1f0251-...` | -590 | "BUG-517 reconci..." (reversal workaround) |
| KEPT | `1525c3b2-...` | +590 | "Payment verified..." (correct entry) |

**Result**: net revenue unchanged at 590 THB
**Backup**: `finance_transactions_backup_bug543` table on Supabase (2 rows)
**Rollback**: Available at `packages/shared/prisma/migrations/20260513_.../rollback.sql`

---

## Known Issues & Tech Debt

| # | Issue | Severity | Status | Notes |
|---|---|---|---|---|
| 1 | Products list P/L shows -710 (no VC) vs detail -810 (with VC) | P3 | Open | Cosmetic inconsistency between list summary and detail view |
| 2 | `product-create-error-envelope.test.ts` failing | P3 | Pre-existing | Prisma constructor mock issue, unrelated to sprint changes |
| 3 | Translation files (en.json, zh.json) retained but unused | Info | By design | Preserved for potential future i18n re-enable |
| 4 | `locale-switcher.tsx` component preserved (commented out) | Info | By design | Both customer + admin, for future re-enable |
| 5 | Admin has no server-side middleware (Vite SPA) | Info | N/A | No `/en/*` URL routes exist; locale is client-side i18next only |

---

## Remaining Backlog

| # | Task | Priority | Description |
|---|---|---|---|
| 1 | Playwright full-suite CI job | P2 | Popup variants, PDPA banner visibility, Admin Thai i18n assertions, locale redirect E2E |
| 2 | Product list P/L consistency | P3 | Align list-level P/L calculation with detail-level (include VC deduction) |
| 3 | Cleanup `finance_transactions_backup_bug543` | P4 | Drop backup table after 30-day retention period |
| 4 | Re-evaluate i18n re-enable | P4 | If multi-language is needed post-launch, uncomment LocaleSwitcher + update middleware |

---

## Architecture Reference

```
cutebunny-rental/
├── apps/
│   ├── customer/     # Next.js + next-intl (Vercel)
│   ├── admin/        # Vite SPA + React Router + i18next (Vercel)
│   └── api/          # Cloudflare Workers (Hono)
├── packages/
│   └── shared/       # Prisma schema, shared utils, customer-pii helpers
├── tests/
│   └── e2e/          # Playwright E2E tests
└── docs/             # This handover doc + runbooks + specs
```

**Key helpers**:
- `@cutebunny/shared/customer-pii` — `isCustomerDeleted()`, `maskCustomerPII()`, `customerDisplayName()`
- `apps/customer/src/components/product-image.tsx` — Reusable image component with SVG fallback
- `apps/admin/src/lib/api.ts` — `isDeletedCustomer()` client-side detection from masked data

---

*Document generated: 2026-05-16*
*Sprint Devin session: https://app.devin.ai/sessions/b75a62cd91904689ae2eebfafde68f0a*
