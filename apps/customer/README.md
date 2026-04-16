# @cutebunny/customer — Next.js Customer Storefront

The customer-facing storefront for cutebunny.rental, built with Next.js 14 (App Router), Tailwind CSS, shadcn/ui, and next-intl for tri-lingual support.

## Quick Start

```bash
# From repo root
pnpm dev:customer
# App runs at http://localhost:3000
```

## Project Structure

```
apps/customer/
├── src/
│   ├── app/
│   │   └── [locale]/              # Locale-based routing (/en/, /th/, /zh/)
│   │       ├── layout.tsx         # Root layout with locale provider
│   │       ├── page.tsx           # Home page (hero, featured, categories)
│   │       ├── products/
│   │       │   ├── page.tsx       # Catalog grid with filters
│   │       │   └── [id]/page.tsx  # Product detail + calendar + rent CTA
│   │       ├── cart/page.tsx      # Cart + checkout flow
│   │       └── orders/
│   │           └── [token]/
│   │               ├── page.tsx          # Order status
│   │               └── payment/page.tsx  # Payment slip upload
│   ├── components/
│   │   ├── product-card.tsx       # Product grid card
│   │   ├── locale-switcher.tsx    # EN/TH/ZH language selector
│   │   └── ui/                    # shadcn/ui components
│   ├── stores/
│   │   └── cart-store.ts          # Zustand cart state management
│   ├── lib/
│   │   └── api.ts                 # API client with base URL from env
│   ├── messages/
│   │   ├── en.json                # English translations (128 keys)
│   │   ├── th.json                # Thai translations (128 keys)
│   │   └── zh.json                # Chinese translations (128 keys)
│   └── i18n.ts                    # next-intl configuration
├── next.config.mjs
├── tailwind.config.ts
└── package.json
```

## Features

- **Catalog browsing** with filters (color, size, availability date range), pagination
- **Product detail** with image gallery, rental price tiers (1/3/5 day), deposit display
- **Availability calendar** — color-coded day-by-day status
- **Cart + checkout** — Zustand state, real-time shipping fee calculation
- **Payment slip upload** — JPEG/PNG with magic bytes validation, preview
- **Order status tracking** — token-based (no login required), auto-refresh
- **Tri-lingual** — EN/TH/ZH with locale switcher in header
- **Mobile-first responsive** — target audience: women 20-35

## i18n

Translations are in `src/messages/{en,th,zh}.json`. All 3 files must have identical key structures.

```tsx
// In components:
import { useTranslations } from 'next-intl';

export default function Component() {
  const t = useTranslations('products');
  return <h1>{t('title')}</h1>;
}
```

Locale routing: `/en/products`, `/th/products`, `/zh/products`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001` | API base URL |

## Build & Deploy

```bash
pnpm build:customer  # Builds Next.js for production
# Deploy to Vercel, Netlify, or any Node.js host
```
