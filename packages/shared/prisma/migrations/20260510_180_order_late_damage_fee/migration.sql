-- FEAT-512: Add order-level late_fee and damage_fee columns
-- These store the manually-entered fees from the admin status change flow.
-- Default 0 ensures backward compatibility; existing orders keep 0.

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "late_fee" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "damage_fee" INTEGER NOT NULL DEFAULT 0;
