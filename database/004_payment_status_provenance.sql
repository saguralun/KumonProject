-- Explicit Admin deployment/prepare after a fresh backup, never at startup.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
ALTER TABLE kumon.billing_detail
    ADD COLUMN IF NOT EXISTS inserted_status_history_id INTEGER
        REFERENCES kumon.enrollment_status(enrollment_status_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payment_status_updated_at TIMESTAMP;
COMMIT;
