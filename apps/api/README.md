# @cutebunny/api — Hono.js API Server

The backend API for cutebunny.rental, built with Hono.js, TypeScript, Zod, and Prisma ORM. Designed to run on Cloudflare Workers (with Node.js dev server for local development).

## Quick Start

```bash
# From repo root
pnpm dev:api
# API runs at http://localhost:3001
```

## Project Structure

```
apps/api/
├── src/
│   ├── index.ts              # Hono app setup + route mounting
│   ├── server.ts             # Node.js dev server (non-Workers)
│   ├── routes/
│   │   ├── products.ts       # C01-C02: Product catalog + detail
│   │   ├── calendar.ts       # C03: Availability calendar
│   │   ├── cart.ts           # C08: Cart creation with tentative holds
│   │   ├── orders.ts         # C08b, C10, C13: Orders, payment slip, status
│   │   ├── shipping.ts       # Shipping fee calculator
│   │   └── admin/
│   │       ├── auth.ts       # A-AUTH: Login with rate limiting
│   │       ├── dashboard.ts  # A-DASH: Dashboard stats
│   │       ├── orders.ts     # A12-A17: Order management + after-sales
│   │       ├── products.ts   # A02: Product CRUD
│   │       ├── calendar.ts   # A06: Master calendar
│   │       ├── customers.ts  # A10: Customer management
│   │       ├── shipping.ts   # A19-A20: Shipping zones + labels
│   │       └── finance.ts    # M01: Finance reports
│   ├── middleware/
│   │   └── auth.ts           # JWT auth middleware + token creation
│   ├── lib/
│   │   ├── db.ts             # Prisma client singleton
│   │   ├── env.ts            # Environment validation (fail-fast)
│   │   ├── response.ts       # Response envelope helpers
│   │   ├── i18n.ts           # Locale parsing + field localization
│   │   ├── availability.ts   # Availability checking + tentative holds
│   │   ├── shipping.ts       # Shipping fee calculation
│   │   ├── state-machine.ts  # Order state machine transitions
│   │   └── rate-limiter.ts   # In-memory rate limiter
│   └── __tests__/            # Test files (T01-T04, Q02)
├── wrangler.toml             # Cloudflare Workers config
├── vitest.config.ts          # Test configuration
└── package.json
```

## API Endpoints

All endpoints are prefixed with `/api/v1/`. Responses use the envelope format:

```json
{
  "data": { ... },
  "meta": { "page": 1, "total": 100 },
  "error": null
}
```

### Authentication

Admin endpoints require a Bearer token in the `Authorization` header. Tokens are obtained via `POST /api/v1/admin/auth/login` and expire after 8 hours.

Rate limiting: 5 login attempts per IP per 15 minutes.

### Order State Machine

Valid transitions:
- `unpaid` -> `paid_locked`
- `paid_locked` -> `shipped`
- `shipped` -> `returned`
- `returned` -> `cleaning`
- `cleaning` -> `ready` or `repair`
- `repair` -> `ready`

Invalid transitions return `422` with `allowed_transitions` array.

### File Upload

Payment slips are validated by magic bytes (not file extension):
- JPEG: `0xFF 0xD8`
- PNG: `0x89 0x50 0x4E 0x47`
- Max size: 10MB

## Testing

```bash
pnpm test           # Run all tests
pnpm test -- --ui   # Interactive test UI
```

146 tests covering:
- **T01**: API contract tests (27 tests)
- **T02**: Customer happy path E2E (18 tests)
- **T03**: Admin happy path E2E (27 tests)
- **T04**: i18n tests (19 tests)
- **Q02**: Security tests (19 tests)
- **Unit**: State machine, shipping, availability (36 tests)

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `JWT_SECRET` | No | dev default | JWT signing secret |
| `PORT` | No | 3001 | Server port |
| `NODE_ENV` | No | development | Environment |

## Deployment

```bash
# Cloudflare Workers
wrangler deploy

# Set secrets
wrangler secret put DATABASE_URL
wrangler secret put JWT_SECRET
```
