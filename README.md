# cutebunny.rental — Online Dress Rental System

A full-stack monorepo for an online dress rental business. Supports customer browsing, booking, payment, and admin management with tri-lingual support (EN/TH/ZH).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Monorepo | pnpm workspaces |
| Customer UI | Next.js 14 (App Router) + Tailwind + shadcn/ui + next-intl |
| Admin UI | React + Vite + shadcn/ui + Zustand + React Query (TanStack) |
| API | Hono.js + TypeScript + Zod on Cloudflare Workers |
| Database | Supabase PostgreSQL + Prisma ORM |
| Cache | Upstash Redis (planned) |
| Storage | Cloudflare R2 (planned) |
| CI/CD | GitLab CI |
| i18n | next-intl (customer) + react-i18next (admin), JSON message files |
| Languages | English (default), Thai, Chinese |

## Monorepo Structure

```
cutebunny-rental/
├── apps/
│   ├── customer/          # Next.js 14 customer storefront
│   ├── admin/             # React + Vite admin dashboard
│   └── api/               # Hono.js API server
├── packages/
│   └── shared/            # Shared types, validators, Prisma schema, i18n
├── scripts/
│   └── gate-check.sh      # Automated release gate checks
├── .gitlab-ci.yml         # CI/CD pipeline (lint, test, build, security)
├── .env.example           # Environment variable template
└── package.json           # Root workspace config
```

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 8 (`npm install -g pnpm`)
- **PostgreSQL** (via Supabase or local instance)

## Setup

### 1. Clone and install

```bash
git clone https://gitlab.com/pairodorz-group/cutebunny-rental.git
cd cutebunny-rental
pnpm install
```

### 2. Environment variables

```bash
cp .env.example .env
```

Edit `.env` with your values. Required variables:

| Variable | Description |
|----------|------------|
| `DATABASE_URL` | PostgreSQL connection string (pooler) |
| `DIRECT_URL` | PostgreSQL direct connection (for migrations) |
| `JWT_SECRET` | Secret for signing admin JWT tokens |
| `PORT` | API server port (default: 3001) |
| `NEXT_PUBLIC_API_URL` | API URL for customer app |
| `VITE_API_URL` | API URL for admin app |

### 3. Database setup

```bash
# Generate Prisma client
pnpm --filter @cutebunny/shared prisma:generate

# Run migrations
pnpm --filter @cutebunny/shared prisma:migrate

# Seed with sample data (20 products, 5 customers, 10 orders)
pnpm --filter @cutebunny/shared seed
```

### 4. Run locally

```bash
# Start all apps (in separate terminals)
pnpm dev:api        # API at http://localhost:3001
pnpm dev:customer   # Customer app at http://localhost:3000
pnpm dev:admin      # Admin app at http://localhost:5173
```

## Available Scripts

| Script | Description |
|--------|------------|
| `pnpm dev:customer` | Start customer app (Next.js dev server) |
| `pnpm dev:admin` | Start admin app (Vite dev server) |
| `pnpm dev:api` | Start API server (tsx watch) |
| `pnpm build` | Build all packages |
| `pnpm lint` | Lint all packages |
| `pnpm typecheck` | TypeScript check all packages |
| `pnpm test` | Run all tests |
| `pnpm format` | Format code with Prettier |
| `pnpm format:check` | Check formatting |
| `pnpm gate-check` | Run automated release gate checks |

## API Overview

All endpoints are prefixed with `/api/v1/`. Response envelope: `{ data, meta?, error? }`.

### Customer Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/products` | Catalog list (with i18n, filters, pagination) |
| GET | `/products/:id` | Product detail |
| GET | `/products/:id/calendar` | Availability calendar |
| POST | `/cart` | Create cart with tentative holds |
| POST | `/orders` | Place order from cart |
| POST | `/orders/:token/payment-slip` | Upload payment slip |
| GET | `/orders/:token` | Order status lookup |
| GET | `/shipping/calculate` | Shipping fee calculator |

### Admin Endpoints (JWT required)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/auth/login` | Admin login (rate-limited) |
| GET | `/admin/dashboard/stats` | Dashboard statistics |
| GET | `/admin/orders` | Order list with filters |
| PATCH | `/admin/orders/:id/status` | Status transition (state machine) |
| POST | `/admin/orders/:id/payment-slip/verify` | Verify payment slip |
| POST | `/admin/orders/:id/after-sales` | After-sales events |
| GET/POST/PATCH/DELETE | `/admin/products` | Product CRUD |
| GET | `/admin/calendar` | Master calendar view |
| GET | `/admin/customers` | Customer list |
| GET | `/admin/customers/:id` | Customer detail |
| GET | `/admin/shipping/zones` | Shipping zones |
| GET | `/admin/finance/report` | Finance report |

See `apps/api/README.md` for detailed API documentation.

## Order State Machine

```
unpaid --> paid_locked --> shipped --> returned --> cleaning --> ready
                                                          \--> repair --> ready
```

Invalid transitions return `422` with `allowed_transitions`.

## Deployment

### Customer App (Vercel)

```bash
cd apps/customer
vercel deploy
```

Set environment variables: `NEXT_PUBLIC_API_URL`

### Admin App (Vercel/Netlify)

```bash
cd apps/admin
pnpm build
# Deploy dist/ to any static hosting
```

Set environment variables: `VITE_API_URL`

### API (Cloudflare Workers)

```bash
cd apps/api
wrangler deploy
```

Set secrets via `wrangler secret put`:
- `DATABASE_URL`
- `JWT_SECRET`

### Database (Supabase)

1. Create a Supabase project
2. Copy the connection strings to `.env`
3. Run `pnpm --filter @cutebunny/shared prisma:migrate`

## i18n: Adding/Editing Translations

### Customer App (next-intl)

Translation files: `apps/customer/src/messages/{en,th,zh}.json`

```json
{
  "home": {
    "title": "Your key here",
    "subtitle": "Your translation"
  }
}
```

Usage in components:
```tsx
const t = useTranslations('home');
return <h1>{t('title')}</h1>;
```

### Admin App (react-i18next)

Translation files: `apps/admin/src/i18n/locales/{en,th,zh}.json`

```json
{
  "dashboard": {
    "title": "Your key here"
  }
}
```

Usage in components:
```tsx
const { t } = useTranslation();
return <h1>{t('dashboard.title')}</h1>;
```

**Important:** Always add keys to ALL 3 locale files (en, th, zh) simultaneously.

## Architecture Decisions

1. **Monorepo with pnpm workspaces** — shared types and validators across all apps, single dependency tree
2. **Hono.js for API** — lightweight, Cloudflare Workers-native, TypeScript-first
3. **Prisma ORM** — type-safe database queries, auto-generated types shared across apps
4. **Zod validation** — runtime request validation with type inference
5. **State machine for orders** — enforced transitions prevent invalid order states
6. **Token-based order access** — UUID tokens (not sequential IDs) for customer order lookup
7. **Magic bytes file validation** — validates actual file content, not just extension
8. **JWT with rate limiting** — admin auth with 5 attempts per IP per 15 minutes
9. **i18n from day one** — all UI strings use i18n keys, never hardcoded

## Testing

```bash
# Run all tests
pnpm test

# Run API tests only
pnpm --filter @cutebunny/api test

# Run gate checks (full release validation)
pnpm gate-check
```

Test suite: 146 tests across 8 test files:
- Unit tests: state machine, shipping calculator, availability checker
- E2E tests: customer happy path, admin happy path, i18n, API contracts
- Security tests: Zod validation, magic bytes, JWT expiry, rate limiting

## Contributing

1. Create a feature branch from the latest base
2. Make changes following existing code conventions
3. Ensure all checks pass: `pnpm lint && pnpm typecheck && pnpm test`
4. Run gate check: `pnpm gate-check`
5. Create a merge request

### Code Conventions

- TypeScript strict mode enabled
- ESLint + Prettier configured
- All UI strings via i18n keys (no hardcoded strings)
- All API responses use the `{ data, meta?, error? }` envelope
- Zod schemas for all request validation
- No secrets in code (use environment variables)

## License

MIT License. See [LICENSE](LICENSE) for details.
