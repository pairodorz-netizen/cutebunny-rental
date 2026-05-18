# ENV Verification Checklist — Stripe Webhook Integration

> **Last updated**: 2026-05-14 (BUG-550 closeout)

---

## Purpose

This checklist verifies that all environment variables are correctly set and consistent across Stripe Dashboard, Cloudflare Worker, and Vercel deployments.

---

## 1. Cloudflare Worker (`cutebunny-api`) Secrets

Dashboard: Workers & Pages → `cutebunny-api` → Settings → Variables and Secrets

| Secret | Format | How to verify |
|--------|--------|---------------|
| `STRIPE_SECRET_KEY` | `sk_test_...` (sandbox) or `sk_live_...` (live) | Last 4 chars must match Stripe Dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` | Last 4 chars must match Stripe Dashboard → Webhooks → endpoint → Signing secret |
| `DATABASE_URL` | `postgresql://postgres.[ref]:[pw]@...pooler.supabase.com:6543/postgres` | Supabase Dashboard → Settings → Database → Connection string → URI (Transaction) |
| `JWT_SECRET` | Any string | Must match across all environments that validate JWT tokens |

### Verification: `STRIPE_WEBHOOK_SECRET` matches Stripe Dashboard

1. **Stripe Dashboard** → Developers → Webhooks → select endpoint → **Signing secret** → Reveal → note last 4 chars
2. **Cloudflare Dashboard** → Workers & Pages → `cutebunny-api` → Settings → Variables → `STRIPE_WEBHOOK_SECRET` → note last 4 chars (encrypted, may need to re-enter to verify)
3. **Must match.** If mismatch → all webhooks will return 400 (`stripe_webhook_signature_failed`)

### Verification: `STRIPE_SECRET_KEY` matches Stripe Dashboard

1. **Stripe Dashboard** → Developers → API keys → Secret key → Reveal → note last 4 chars
2. Must be `sk_test_*` for sandbox, `sk_live_*` for production
3. Cloudflare Worker uses this for API calls to Stripe (currently unused, reserved for future Checkout session creation)

### Quick endpoint test

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST \
  https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/webhooks/stripe \
  -H "Content-Type: application/json" -d '{"test":true}'
```

| Response | Meaning |
|----------|---------|
| `400` | Handler active, signature verification working (correct — unsigned request rejected) |
| `500` | `STRIPE_WEBHOOK_SECRET` not set or Worker error |
| `404` | Route not found (Worker may not be deployed) |

---

## 2. Vercel: Admin App (`admin`)

Dashboard: Vercel → Project `admin` → Settings → Environment Variables

| Variable | Required | Value |
|----------|----------|-------|
| `VITE_API_URL` | ✅ | `https://cutebunny-api.cutebunny-rental.workers.dev` |
| `VITE_VERCEL_DEPLOYMENT_ID` | Auto | Set by Vercel |
| `VITE_COMMIT_SHA` | Auto | Set by Vercel |
| `VITE_DIAG_BAR` | Optional | `on` to show diagnostic bar |

**No Stripe secrets needed** — admin app does not interact with Stripe directly.

---

## 3. Vercel: Customer App (`customer`)

Dashboard: Vercel → Project `customer` → Settings → Environment Variables

| Variable | Required | Value |
|----------|----------|-------|
| `NEXT_PUBLIC_API_URL` | ✅ | `https://cutebunny-api.cutebunny-rental.workers.dev` |

**No Stripe secrets needed** — customer app will create Checkout sessions via API (future), not directly.

---

## 4. Supabase

Dashboard: Supabase → Settings → Database

| Item | Check |
|------|-------|
| `stripe_webhook_events` table exists | `SELECT COUNT(*) FROM stripe_webhook_events;` |
| RLS enabled | `SELECT relrowsecurity FROM pg_class WHERE relname = 'stripe_webhook_events';` → `true` |
| Connection pooler active | Settings → Database → Connection Pooling → Transaction mode |

---

## 5. Cross-Environment Consistency Matrix

| Check | Source A | Source B | Must match |
|-------|----------|----------|------------|
| Webhook signing secret | Stripe Dashboard → endpoint → Signing secret | CF Worker → `STRIPE_WEBHOOK_SECRET` | Last 4 chars |
| API secret key | Stripe Dashboard → API keys → Secret key | CF Worker → `STRIPE_SECRET_KEY` | Last 4 chars |
| API URL | CF Worker deployed URL | Vercel admin `VITE_API_URL` | Exact match |
| API URL | CF Worker deployed URL | Vercel customer `NEXT_PUBLIC_API_URL` | Exact match |
| DB connection | Supabase Dashboard → Connection string | CF Worker → `DATABASE_URL` | Exact match (pooler URL) |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| All webhooks 400 | `STRIPE_WEBHOOK_SECRET` mismatch | Re-copy signing secret from Stripe Dashboard |
| All webhooks 500 | `STRIPE_WEBHOOK_SECRET` not set | `npx wrangler secret put STRIPE_WEBHOOK_SECRET` |
| Admin can't reach API | `VITE_API_URL` wrong or missing | Update Vercel env var + redeploy |
| Customer can't reach API | `NEXT_PUBLIC_API_URL` wrong | Update Vercel env var + redeploy |
| DB connection errors | `DATABASE_URL` wrong or Supabase down | Check Supabase status + pooler config |
