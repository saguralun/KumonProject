import pool from '../config/db.js';

// Explicit read-only diagnostics; never called by the program updater.
export async function paymentDatabaseStatus(client = pool) {
    const result = await client.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='kumon' AND table_name='billing_detail'
        AND column_name = ANY($1::text[])`, [['inserted_status_history_id', 'payment_status_updated_at']]);
    return { ready: result.rows.length === 2, required: result.rows.length !== 2 };
}
