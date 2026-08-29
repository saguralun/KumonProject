-- Add soft enable/disable support for existing opening schedules.
-- Run this on an existing KumonDB database instead of recreating master tables.

ALTER TABLE kumon.opening_schedule
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
