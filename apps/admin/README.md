# @cutebunny/admin — React Admin Dashboard

The admin dashboard for cutebunny.rental, built with React, Vite, shadcn/ui, Zustand, React Query (TanStack), and react-i18next for tri-lingual support.

## Quick Start

```bash
# From repo root
pnpm dev:admin
# App runs at http://localhost:5173
```

## Project Structure

```
apps/admin/
├── src/
│   ├── App.tsx                    # Router setup with protected routes
│   ├── main.tsx                   # Entry point
│   ├── pages/
│   │   ├── login.tsx              # Admin login form
│   │   ├── dashboard.tsx          # Stats cards, top products, alerts
│   │   ├── orders.tsx             # Order table, filters, detail, status transitions
│   │   ├── products.tsx           # Product CRUD with i18n tabs
│   │   ├── calendar.tsx           # Master calendar (products x dates grid)
│   │   ├── customers.tsx          # Customer list + detail profiles
│   │   ├── finance.tsx            # Revenue/expense charts, ROI table
│   │   └── settings.tsx           # App settings
│   ├── components/
│   │   ├── layout/
│   │   │   ├── protected-layout.tsx  # Auth guard + sidebar wrapper
│   │   │   ├── sidebar.tsx           # Navigation sidebar
│   │   │   └── locale-switcher.tsx   # EN/TH/ZH selector
│   │   └── ui/                       # shadcn/ui components
│   ├── stores/
│   │   └── auth-store.ts          # Zustand JWT auth store
│   ├── lib/
│   │   ├── api.ts                 # API client with auth headers
│   │   └── utils.ts               # Utility functions
│   ├── i18n/
│   │   ├── index.ts               # react-i18next setup
│   │   └── locales/
│   │       ├── en.json            # English translations (153 keys)
│   │       ├── th.json            # Thai translations (153 keys)
│   │       └── zh.json            # Chinese translations (153 keys)
│   └── index.css                  # Tailwind base styles
├── vite.config.ts
├── tailwind.config.js
└── package.json
```

## Features

- **Dashboard** — orders today, pending payments, shipped, overdue, revenue, top products, low stock
- **Order management** — table with filters, status transitions (state machine enforced), slip verification, after-sales (late fee, damage fee, force buy, partial refund)
- **Product CRUD** — create/edit with i18n fields (EN/TH/ZH tabs), image upload, pricing tiers
- **Master calendar** — products x dates grid with color-coded availability
- **Customer profiles** — list with tier badges, rental history, credit balance
- **Finance reports** — revenue/expense charts (recharts), group by category/product/month, per-dress ROI
- **Tri-lingual** — EN/TH/ZH with locale switcher
- **JWT authentication** — login with rate limiting, 8-hour token expiry

## i18n

Translations are in `src/i18n/locales/{en,th,zh}.json`. All 3 files must have identical key structures.

```tsx
// In components:
import { useTranslation } from 'react-i18next';

export default function Component() {
  const { t } = useTranslation();
  return <h1>{t('dashboard.title')}</h1>;
}
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_API_URL` | No | `http://localhost:3001` | API base URL |

## Build & Deploy

```bash
pnpm build:admin  # Builds static files to dist/
# Deploy dist/ to any static hosting (Vercel, Netlify, S3, etc.)
```
