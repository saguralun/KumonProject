import fs from 'node:fs/promises';
import pool from '../config/db.js';
import { runBackupNow } from './backupService.js';
import { httpError } from './httpError.js';
import { parse } from 'dotenv';

async function assertBackupTarget(options) {
    const env = parse(await fs.readFile('.env'));
    const expected = { host: env.DB_HOST, database: env.DB_NAME, user: env.DB_USER, password: env.DB_PASSWORD, port: Number(env.DB_PORT) || 5432 };
    if (Object.entries(expected).some(([key, value]) => String(options?.[key] ?? '') !== String(value ?? ''))) {
        throw httpError(409, 'การเชื่อมต่อฐานข้อมูลไม่ตรงกับไฟล์สำรองของเครื่องนี้ หยุดก่อนปรับโครงสร้าง');
    }
}

export async function paymentDatabaseStatus(client = pool) {
    const result = await client.query(`SELECT column_name FROM information_schema.columns
        WHERE table_schema='kumon' AND table_name='billing_detail'
        AND column_name = ANY($1::text[])`, [['inserted_status_history_id', 'payment_status_updated_at']]);
    return { ready: result.rows.length === 2, required: result.rows.length !== 2 };
}

// Explicit Admin update/prepare only: never invoked at startup or while receiving a payment.
export async function preparePaymentDatabase({ database = pool, backup = runBackupNow } = {}) {
    const client = await database.connect();
    let locked = false, releaseError;
    try {
        await client.query('SELECT pg_advisory_lock(76401, 2)'); locked = true;
        if ((await paymentDatabaseStatus(client)).ready) return { ready: true, applied: false };
        if (backup === runBackupNow) await assertBackupTarget(database.options);
        const snapshot = await backup();
        if (!snapshot?.filename || !(snapshot.sizeBytes > 0)) throw httpError(500, 'สำรองฐานข้อมูลไม่สำเร็จ ยังไม่ปรับโครงสร้าง');
        const source = await fs.readFile(new URL('../database/004_payment_status_provenance.sql', import.meta.url), 'utf8');
        try { await client.query(source); }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        if (!(await paymentDatabaseStatus(client)).ready) throw httpError(500, 'ปรับโครงสร้างใบเสร็จไม่ครบ กรุณาตรวจไฟล์สำรอง');
        return { ready: true, applied: true, backup: snapshot.filename };
    } finally {
        if (locked) {
            try { await client.query('SELECT pg_advisory_unlock(76401, 2)'); }
            catch (error) { releaseError = error; }
        }
        client.release(releaseError);
    }
}
