# Migration Runbook — PR1: LINE Login MVP + Customer Identity

> **Who runs this**: Repository owner (or DBA) with Supabase production SQL Editor access.
> **When**: BEFORE merging PR1-v2 into `main`. Code deploy happens automatically after merge — the database must be ready first.

---

## Pre-deploy Checklist

- [ ] You have access to Supabase **production** project SQL Editor
- [ ] You have read the full migration SQL below
- [ ] Production is in a low-traffic window (recommended, not required — migration is additive/non-destructive)
- [ ] The following env vars are ready to set on Cloudflare Workers dashboard after migration + merge:
  - `LINE_LOGIN_CHANNEL_ID` — from LINE Developers Console
  - `LINE_LOGIN_CHANNEL_SECRET` — from LINE Developers Console
  - `LINE_LOGIN_CALLBACK_URL` — e.g. `https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/line/callback`
  - `APP_BASE_URL` — e.g. `https://your-customer-domain.vercel.app`
  - `FEATURE_LINE_LOGIN=on`

---

## Step 1: Run Migration SQL

Open **Supabase Dashboard → SQL Editor → New query**.

Copy and paste the entire block below, then click **Run**:

```sql
-- ============================================================
-- PR1 UP — Evolve customers + customer_identities + consents + order_number_counters
-- Additive only. No existing column/table/enum is altered or dropped.
-- TEXT + CHECK constraints — no new enums.
-- ============================================================

-- 1. EVOLVE EXISTING CUSTOMERS TABLE ---------------------------
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS auth_user_id       uuid UNIQUE,
  ADD COLUMN IF NOT EXISTS display_name       text,
  ADD COLUMN IF NOT EXISTS primary_phone_e164 text,
  ADD COLUMN IF NOT EXISTS primary_email      text,
  ADD COLUMN IF NOT EXISTS line_user_id       text UNIQUE,
  ADD COLUMN IF NOT EXISTS line_display_name  text,
  ADD COLUMN IF NOT EXISTS line_picture_url   text,
  ADD COLUMN IF NOT EXISTS line_friend_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS line_last_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS source             text NOT NULL DEFAULT 'storefront',
  ADD COLUMN IF NOT EXISTS status             text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS merged_into        uuid REFERENCES public.customers(id);

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_line_friend_status'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT chk_customers_line_friend_status
        CHECK (line_friend_status IN ('friend','not_friend','unknown'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_source'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT chk_customers_source
        CHECK (source IN ('storefront','line_oa','admin_manual','import'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_customers_status'
  ) THEN
    ALTER TABLE public.customers
      ADD CONSTRAINT chk_customers_status
        CHECK (status IN ('active','merged','archived'));
  END IF;
END $$;

-- 2. CUSTOMER IDENTITIES --------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_identities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id         uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  provider            text NOT NULL
                        CHECK (provider IN ('email','line','admin_manual')),
  provider_subject    text NOT NULL,
  verification_method text NOT NULL
                        CHECK (verification_method IN
                          ('email_password','line_login','admin_create','admin_merge')),
  verified_at         timestamptz,
  last_used_at        timestamptz,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS idx_customer_identities_customer
  ON public.customer_identities(customer_id);

-- 3. ORDER NUMBER SEQUENCE PER YEAR ----------------------------
CREATE TABLE IF NOT EXISTS public.order_number_counters (
  prefix     text NOT NULL,
  year       int  NOT NULL,
  last_seq   int  NOT NULL DEFAULT 0,
  PRIMARY KEY (prefix, year)
);

CREATE OR REPLACE FUNCTION public.next_order_number(prefix_val text DEFAULT 'DR')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  y    int := extract(year FROM now())::int;
  nseq int;
BEGIN
  INSERT INTO public.order_number_counters(prefix, year, last_seq)
  VALUES (prefix_val, y, 0)
  ON CONFLICT (prefix, year) DO NOTHING;

  UPDATE public.order_number_counters
    SET last_seq = last_seq + 1
    WHERE prefix = prefix_val AND year = y
    RETURNING last_seq INTO nseq;

  RETURN prefix_val || '-' || y::text || '-' || lpad(nseq::text, 4, '0');
END $$;

-- 4. CONSENTS (PDPA) ------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id    uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  purpose        text NOT NULL
                   CHECK (purpose IN ('privacy_notice','order_updates','marketing')),
  channel        text NOT NULL
                   CHECK (channel IN ('website','line_oa','admin')),
  status         text NOT NULL
                   CHECK (status IN ('accepted','declined','withdrawn')),
  notice_version text,
  collected_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customer_consents_customer
  ON public.customer_consents(customer_id);

-- 5. updated_at trigger ----------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_customers_updated'
  ) THEN
    CREATE TRIGGER trg_customers_updated
      BEFORE UPDATE ON public.customers
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- 6. ROW LEVEL SECURITY ----------------------------------------
ALTER TABLE public.customer_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_consents   ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'identities_self_select'
  ) THEN
    CREATE POLICY identities_self_select ON public.customer_identities
      FOR SELECT USING (
        customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
      );
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'consents_self_select'
  ) THEN
    CREATE POLICY consents_self_select ON public.customer_consents
      FOR SELECT USING (
        customer_id IN (SELECT id FROM public.customers WHERE auth_user_id = auth.uid())
      );
  END IF;
EXCEPTION WHEN undefined_function THEN
  NULL;
END $$;
```

**Expected result**: `Success. No rows returned` (or similar success message from Supabase SQL Editor).

---

## Step 2: Run Verification Queries

After migration succeeds, run each query below and verify the expected output:

### 2a. Verify new columns on `customers`

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'customers'
  AND column_name IN (
    'auth_user_id', 'display_name', 'line_user_id',
    'line_display_name', 'source', 'status', 'merged_into'
  )
ORDER BY column_name;
```

**Expected**: 7 rows — all columns listed with correct types (`uuid`, `text`, `text`, `text`, `text`, `text`, `uuid`).

### 2b. Verify new tables exist

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('customer_identities', 'customer_consents', 'order_number_counters')
ORDER BY table_name;
```

**Expected**: 3 rows — `customer_consents`, `customer_identities`, `order_number_counters`.

### 2c. Verify `order_number_counters` has composite PK

```sql
SELECT kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name = 'order_number_counters'
  AND tc.constraint_type = 'PRIMARY KEY'
ORDER BY kcu.ordinal_position;
```

**Expected**: 2 rows — `prefix`, `year`.

### 2d. Verify `next_order_number()` function exists

```sql
SELECT routine_name, data_type
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'next_order_number';
```

**Expected**: 1 row — `next_order_number`, `text`.

### 2e. Verify CHECK constraints

```sql
SELECT conname
FROM pg_constraint
WHERE conrelid = 'public.customers'::regclass
  AND conname LIKE 'chk_customers_%'
ORDER BY conname;
```

**Expected**: 3 rows — `chk_customers_line_friend_status`, `chk_customers_source`, `chk_customers_status`.

---

## Step 3: Smoke Test — `next_order_number()`

Run inside a transaction that rolls back (no permanent data change):

```sql
BEGIN;

SELECT public.next_order_number('DR') AS test_1;
-- Expected: DR-2026-0001 (or current year)

SELECT public.next_order_number('DR') AS test_2;
-- Expected: DR-2026-0002

SELECT public.next_order_number('DR') AS test_3;
-- Expected: DR-2026-0003

ROLLBACK;
-- Rolls back the test counter rows — no data persisted
```

**Expected**: Three sequential order numbers with 4-digit zero-padded sequence, all rolled back after.

---

## Step 4: Sign-off

After all verification queries pass, post a comment on the PR with:

```
Migration applied ✅
- Timestamp: YYYY-MM-DD HH:MM UTC
- Supabase user: [your username]
- All verification queries passed
- Smoke test: next_order_number() returns DR-YYYY-NNNN correctly
```

Then approve and merge the PR.

---

## Rollback (if needed)

If the migration causes issues **before any real LINE Login / order data exists**, run:

```sql
-- PR1 DOWN — for a failed migration BEFORE go-live only.
-- Once real customers/orders exist, DO NOT run this; fix forward instead.

DROP POLICY IF EXISTS consents_self_select   ON public.customer_consents;
DROP POLICY IF EXISTS identities_self_select ON public.customer_identities;

DROP TRIGGER IF EXISTS trg_customers_updated ON public.customers;

DROP TABLE IF EXISTS public.customer_consents;
DROP TABLE IF EXISTS public.customer_identities;
DROP FUNCTION IF EXISTS public.next_order_number(text);
DROP TABLE IF EXISTS public.order_number_counters;

DROP FUNCTION IF EXISTS public.set_updated_at();

ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS chk_customers_status;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS chk_customers_source;
ALTER TABLE public.customers DROP CONSTRAINT IF EXISTS chk_customers_line_friend_status;

ALTER TABLE public.customers DROP COLUMN IF EXISTS merged_into;
ALTER TABLE public.customers DROP COLUMN IF EXISTS status;
ALTER TABLE public.customers DROP COLUMN IF EXISTS source;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_last_event_at;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_friend_status;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_picture_url;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_display_name;
ALTER TABLE public.customers DROP COLUMN IF EXISTS line_user_id;
ALTER TABLE public.customers DROP COLUMN IF EXISTS primary_email;
ALTER TABLE public.customers DROP COLUMN IF EXISTS primary_phone_e164;
ALTER TABLE public.customers DROP COLUMN IF EXISTS display_name;
ALTER TABLE public.customers DROP COLUMN IF EXISTS auth_user_id;
```

> **Warning**: Do NOT run rollback if real customer or order data has been created with the new schema. Fix forward instead.

---

## Post-merge: Set Environment Variables

After merge + code deploys (Cloudflare Worker auto-deploys on push to main):

1. Go to **Cloudflare Dashboard → Workers → cutebunny-api → Settings → Variables**
2. Set:
   - `LINE_LOGIN_CHANNEL_ID` = (from LINE Developers Console)
   - `LINE_LOGIN_CHANNEL_SECRET` = (from LINE Developers Console, encrypt)
   - `LINE_LOGIN_CALLBACK_URL` = `https://cutebunny-api.cutebunny-rental.workers.dev/api/v1/line/callback`
   - `APP_BASE_URL` = your customer app URL
   - `FEATURE_LINE_LOGIN` = `on`
3. Click **Save and Deploy**
