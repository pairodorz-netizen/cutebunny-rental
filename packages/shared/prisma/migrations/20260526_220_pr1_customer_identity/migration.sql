-- PR1: Evolve customers + customer_identities + consents + order_number_counters
-- Additive only. TEXT + CHECK constraints — no new enums.

-- 1. EVOLVE EXISTING CUSTOMERS TABLE
ALTER TABLE "customers"
  ADD COLUMN IF NOT EXISTS "auth_user_id"       UUID UNIQUE,
  ADD COLUMN IF NOT EXISTS "display_name"       TEXT,
  ADD COLUMN IF NOT EXISTS "primary_phone_e164" TEXT,
  ADD COLUMN IF NOT EXISTS "primary_email"      TEXT,
  ADD COLUMN IF NOT EXISTS "line_user_id"       TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "line_display_name"  TEXT,
  ADD COLUMN IF NOT EXISTS "line_picture_url"   TEXT,
  ADD COLUMN IF NOT EXISTS "line_friend_status" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "line_last_event_at" TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS "source"             TEXT NOT NULL DEFAULT 'storefront',
  ADD COLUMN IF NOT EXISTS "status"             TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "merged_into"        UUID REFERENCES "customers"("id");

-- 2. CUSTOMER IDENTITIES
CREATE TABLE IF NOT EXISTS "customer_identities" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id"         UUID NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "provider"            TEXT NOT NULL,
  "provider_subject"    TEXT NOT NULL,
  "verification_method" TEXT NOT NULL,
  "verified_at"         TIMESTAMPTZ,
  "last_used_at"        TIMESTAMPTZ,
  "metadata"            JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at"          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("provider", "provider_subject")
);
CREATE INDEX IF NOT EXISTS "idx_customer_identities_customer" ON "customer_identities"("customer_id");

-- 3. ORDER NUMBER SEQUENCE PER YEAR
CREATE TABLE IF NOT EXISTS "order_number_counters" (
  "year"       INT PRIMARY KEY,
  "last_seq"   INT NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION public.next_order_number()
RETURNS TEXT LANGUAGE plpgsql AS $$
DECLARE
  y    INT := extract(year FROM now())::int;
  nseq INT;
BEGIN
  INSERT INTO "order_number_counters"("year", "last_seq")
  VALUES (y, 0)
  ON CONFLICT ("year") DO NOTHING;

  UPDATE "order_number_counters"
    SET "last_seq" = "last_seq" + 1
    WHERE "year" = y
    RETURNING "last_seq" INTO nseq;

  RETURN 'DR-' || y::text || '-' || lpad(nseq::text, 4, '0');
END $$;

-- 4. CONSENTS (PDPA)
CREATE TABLE IF NOT EXISTS "customer_consents" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "customer_id"    UUID NOT NULL REFERENCES "customers"("id") ON DELETE CASCADE,
  "purpose"        TEXT NOT NULL,
  "channel"        TEXT NOT NULL,
  "status"         TEXT NOT NULL,
  "notice_version" TEXT,
  "collected_at"   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "idx_customer_consents_customer" ON "customer_consents"("customer_id");

-- 5. RLS
ALTER TABLE "customer_identities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_consents"   ENABLE ROW LEVEL SECURITY;
