-- BUG-507: Convert audit_logs.ip_address from TEXT to INET for PII/GDPR compliance.
--
-- The INET type enables PostgreSQL-native subnet operations (host(ip) &
-- set_masklen()) used by the retention job to mask IPs to /24 (IPv4)
-- or /48 (IPv6) without application-side parsing.
--
-- This migration is idempotent and double-deploy safe:
--   1. If the column is already INET, the ALTER TYPE is a no-op (guarded).
--   2. If the column is TEXT, it is converted with a safe USING CASE clause
--      that NULLs invalid values instead of crashing.

-- UP: TEXT → INET (safe cast)
DO $$
BEGIN
  -- Only alter if the column exists and is not already inet
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'audit_logs'
      AND column_name = 'ip_address'
      AND data_type <> 'inet'
  ) THEN
    ALTER TABLE "audit_logs"
      ALTER COLUMN "ip_address" TYPE inet
      USING (
        CASE
          WHEN "ip_address" ~ '^[0-9a-fA-F.:]+(/[0-9]+)?$'
          THEN "ip_address"::inet
          ELSE NULL
        END
      );
  END IF;
END$$;

-- DOWN (rollback): INET → TEXT
-- To rollback, run this manually after reverting the Worker code:
--
--   SET lock_timeout = '2s';
--   SET statement_timeout = '5s';
--   ALTER TABLE audit_logs
--     ALTER COLUMN ip_address TYPE text
--     USING host(ip_address)::text;
