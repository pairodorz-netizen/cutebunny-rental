-- Sprint E: Remove Stripe integration (final cleanup)
-- Drops the stripe_webhook_events table and StripeWebhookEventStatus enum.
-- CuteBunny uses bank transfer + slip upload only; Stripe was never used in production.

-- Drop table (CASCADE removes indexes and constraints)
DROP TABLE IF EXISTS "stripe_webhook_events" CASCADE;

-- Drop enum type
DROP TYPE IF EXISTS "StripeWebhookEventStatus";
