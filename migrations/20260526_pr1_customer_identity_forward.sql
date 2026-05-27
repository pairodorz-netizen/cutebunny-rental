-- ============================================================
-- PR1 UP — Evolve customers + customer_identities + consents + order_number_counters
-- Additive only. No existing column/table/enum is altered or dropped.
-- TEXT + CHECK constraints — no new enums.
-- ============================================================

-- 1. EVOLVE EXISTING CUSTOMERS TABLE ---------------------------
-- Add LINE-related columns + CRM columns to the existing customers table.
-- All new columns are nullable or have defaults so existing rows are safe.

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

-- Add CHECK constraints (idempotent via IF NOT EXISTS on constraint name)
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

-- Only create triggers if they don't already exist
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

-- Self-select policies for customer_identities and consents
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
  -- auth.uid() not available (non-Supabase env) — skip RLS policy
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
