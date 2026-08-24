-- Add Kumon Connect mode to existing enrollment table.
-- KC affects worksheet stock behavior only; it is not a billing/status flag.

ALTER TABLE kumon.enrollment
ADD COLUMN IF NOT EXISTS is_kumon_connect BOOLEAN NOT NULL DEFAULT FALSE;
