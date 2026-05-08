-- BUG-507: Convert audit_logs.ip_address from TEXT to INET for PII/GDPR compliance.
--
-- The INET type enables PostgreSQL-native subnet operations (host(ip) &
-- set_masklen()) used by the retention job to mask IPs to /24 (IPv4)
-- or /48 (IPv6) without application-side parsing.
--
-- This migration is idempotent and double-deploy safe:
--   1. If the column is already INET, the ALTER TYPE is a no-op (guarded).
--   2. If the column is TEXT, it is converted with USING ip_address::inet.
--      Invalid/NULL values remain NULL after the cast.

DO $$
BEGIN
  -- Only alter if the column exists and is not already inet
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs'
      AND column_name = 'ip_address'
      AND data_type <> 'inet'
  ) THEN
    -- Nullify any values that can't be cast to inet (e.g. garbage data)
    UPDATE "audit_logs"
    SET "ip_address" = NULL
    WHERE "ip_address" IS NOT NULL
      AND "ip_address" !~ '^[0-9a-fA-F.:]+(/[0-9]+)?$';

    ALTER TABLE "audit_logs"
      ALTER COLUMN "ip_address" TYPE inet
      USING "ip_address"::inet;
  END IF;
END$$;
