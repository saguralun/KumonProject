-- Apply explicitly during deployment, never automatically against the live database.
BEGIN;
ALTER TABLE kumon.billing_detail
    ADD COLUMN IF NOT EXISTS inserted_status_history_id INTEGER
        REFERENCES kumon.enrollment_status(enrollment_status_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS payment_status_updated_at TIMESTAMP;
COMMIT;
