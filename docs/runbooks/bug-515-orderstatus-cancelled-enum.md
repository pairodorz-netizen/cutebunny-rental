# HOTFIX-515 — Add 'cancelled' to OrderStatus enum on prod

**Context:** Prisma schema declares `OrderStatus` with 8 values including `cancelled`,
but the production PostgreSQL enum only has 7 values. Any query touching an order with
`status='cancelled'` fails with `22P02: invalid input value for enum "OrderStatus": "cancelled"`.

**Standalone SQL file:**
- Forward: [`migrations/20260512_170_orderstatus_add_cancelled_forward.sql`](../../migrations/20260512_170_orderstatus_add_cancelled_forward.sql)

---

## Pre-requisites

- [ ] PR merged and CI green
- [ ] Access to Supabase SQL Editor (production)

---

## Step 1: Pre-run schema check

Run in Supabase SQL Editor:

```sql
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = '"OrderStatus"'::regtype
ORDER BY enumsortorder;
```

**Expected (before fix):** 7 values — `cancelled` is missing.

---

## Step 2: Run migration

Copy-paste the single statement from `migrations/20260512_170_orderstatus_add_cancelled_forward.sql`:

```sql
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'cancelled';
```

> **Important:** This statement **cannot** run inside a `BEGIN`/`COMMIT` transaction block.
> Run it as a standalone query in Supabase SQL Editor.

---

## Step 3: Post-run verification

```sql
SELECT enumlabel
FROM pg_enum
WHERE enumtypid = '"OrderStatus"'::regtype
ORDER BY enumsortorder;
```

**Expected (after fix):** 8 values:
`unpaid`, `paid_locked`, `shipped`, `returned`, `cleaning`, `repair`, `finished`, `cancelled`

---

## Step 4: Smoke test

Check Cloudflare Worker logs after running:

```
GET /api/v1/admin/orders?page=1&page_size=50&include_stale=false
```

- No `22P02` errors should appear
- Admin order list should load without errors

---

## Rollback

**PostgreSQL does not support `ALTER TYPE ... DROP VALUE`.**

If rollback is needed:
1. The `cancelled` enum value remains in the type (harmless — it's already in the Prisma schema)
2. If orders with `status='cancelled'` must be prevented, add application-level validation
3. Full enum recreation would require recreating all dependent columns — not recommended for a hotfix

---

## Related

- Prisma schema: `packages/shared/prisma/schema.prisma` (OrderStatus enum)
- Error: `22P02 invalid input value for enum "OrderStatus": "cancelled"`
- BUG-508 migrations: HOTFIX-514 (PR #163)
