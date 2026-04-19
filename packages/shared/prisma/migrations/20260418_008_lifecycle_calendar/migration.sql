-- FEAT-402: Add shipping and washing statuses to SlotStatus enum
-- These enable lifecycle-aware calendar blocking (pre-block shipping, post-block wash)

ALTER TYPE "SlotStatus" ADD VALUE IF NOT EXISTS 'shipping';
ALTER TYPE "SlotStatus" ADD VALUE IF NOT EXISTS 'washing';
