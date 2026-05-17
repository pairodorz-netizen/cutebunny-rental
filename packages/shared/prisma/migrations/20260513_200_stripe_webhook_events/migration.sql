-- BUG-550: Stripe Webhook Idempotency
-- Creates the stripe_webhook_events table for deduplication, out-of-order
-- buffering, and observability of Stripe webhook processing.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "StripeWebhookEventStatus" AS ENUM ('received', 'processing', 'processed', 'failed', 'pending_order');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "stripe_webhook_events" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "stripe_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "StripeWebhookEventStatus" NOT NULL DEFAULT 'received',
    "order_id" UUID,
    "payment_intent_id" TEXT,
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stripe_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "stripe_webhook_events_stripe_event_id_key" ON "stripe_webhook_events"("stripe_event_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_payment_intent_id_idx" ON "stripe_webhook_events"("payment_intent_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_status_idx" ON "stripe_webhook_events"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "stripe_webhook_events_created_at_idx" ON "stripe_webhook_events"("created_at");

-- RLS
ALTER TABLE "stripe_webhook_events" ENABLE ROW LEVEL SECURITY;
