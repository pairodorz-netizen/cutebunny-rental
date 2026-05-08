-- BUG-507: Create system_logs table for retention job compliance proof.
--
-- Records every execution of automated jobs (PII retention, etc.)
-- with structured details for audit/compliance purposes.

CREATE TABLE IF NOT EXISTS "system_logs" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
  "job" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "details" JSONB,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "system_logs_pkey" PRIMARY KEY ("id")
);
