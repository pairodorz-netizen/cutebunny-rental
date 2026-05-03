# AGENTS.md - CuteBunny Rental

This file provides instructions for AI agents (Devin, Claude, Copilot, etc.) working on this codebase.

## Project Overview

- **Monorepo** (pnpm workspaces): `apps/customer` (Next.js), `apps/admin` (Next.js), `apps/api` (Cloudflare Worker)
- **Database**: Supabase (PostgreSQL + Prisma ORM)
- **Deployment**: Customer & Admin on Vercel, API on Cloudflare Workers
- **Languages**: Thai (th), English (en), Chinese (zh)

## Branding Rules (DO NOT TRANSLATE)

The following translation keys are **branding** and MUST remain in English across ALL locales (th.json, en.json, zh.json):

| Key path | Value (keep in all locales) |
|---|---|
| `home.hero.title` | `Wear the dream dress, keep the budget.` |
| `home.hero.titleLine1` | `Wear the` |
| `home.hero.titleLine2` | `dream dress,` |
| `home.hero.titleLine3` | `keep the budget.` |
| `common.appName` | `CuteBunny Rental` |

**Never translate these keys.** They are intentionally English for brand identity.

## i18n Guidelines

- Translation files: `apps/customer/src/messages/{en,th,zh}.json`
- When fixing i18n bugs, always check if a key is in the branding table above before translating
- Subtitle, CTA, nav, and UI labels should be translated per locale
- Product names come from the database and are not in translation files

## Architecture Notes

- API base URL env var: `NEXT_PUBLIC_API_URL` (Cloudflare Worker)
- Customer app uses `next-intl` for i18n with `[locale]` route segments
- Admin app is English-only
- Orders use tentative holds with 30-minute stale cleanup

## Testing

- Unit tests: `pnpm test` (Vitest)
- Timestamp-sensitive tests must use `vi.useFakeTimers()` to avoid flaky 1ms drift
- E2E: Playwright (`pnpm e2e`)

## Common Pitfalls

1. **Cloudflare Worker cold starts**: If the API returns 1101, redeploy via GitHub Actions "Deploy API" workflow
2. **Duplicate JSON keys**: JSON allows duplicate keys but only the last one takes effect - always check for duplicates
3. **Branding vs i18n**: See the branding table above - do NOT translate branding keys even if they appear "untranslated" in non-English locale files
