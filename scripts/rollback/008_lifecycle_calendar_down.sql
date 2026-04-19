-- Rollback FEAT-402: Remove shipping/washing statuses
-- Note: PostgreSQL does not support removing enum values directly.
-- Convert any shipping/washing slots back to 'blocked_repair' before rollback.
UPDATE availability_calendar SET slot_status = 'blocked_repair' WHERE slot_status IN ('shipping', 'washing');
-- The enum values will remain but be unused. Full removal requires recreating the enum type.
