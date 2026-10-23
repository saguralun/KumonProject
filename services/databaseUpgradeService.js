import fs from 'node:fs/promises';
import pool from '../config/db.js';
import { runBackupNow, verifyBackupSnapshot } from './backupService.js';
import { httpError } from './httpError.js';
import { parse } from 'dotenv';
import { inspectApplicationSchema } from './databaseSchema.js';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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

async function writeUpgradeReport(report) {
    const directory = path.resolve('logs');
    await fs.mkdir(directory, { recursive: true });
    const destination = path.join(directory, 'database-upgrade-latest.json');
    const previous = await fs.readFile(destination, 'utf8').then(JSON.parse).catch(() => null);
    const checkedAt = new Date().toISOString();
    const lastApplied = report.applied ? { checkedAt, backup: report.backup, changes: report.changes } : previous?.lastApplied;
    const temporary = path.join(directory, `database-upgrade-${randomUUID()}.tmp`);
    try {
        await fs.writeFile(temporary, JSON.stringify({ ...report, checkedAt, lastApplied }, null, 2));
        await fs.rename(temporary, destination);
    } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

export async function prepareApplicationDatabase({ database = pool, backup = runBackupNow, report = writeUpgradeReport, inspect = inspectApplicationSchema } = {}) {
    const client = await database.connect();
    let locked = false, transaction = false, snapshot, releaseError, plan;
    const record = async result => {
        try { await report(result); }
        catch { result.reportWarning = 'เขียนรายงานการตรวจฐานข้อมูลไม่สำเร็จ'; }
        return result;
    };
    try {
        locked = (await client.query('SELECT pg_try_advisory_lock(76401, 2) AS locked')).rows[0].locked;
        if (!locked) throw httpError(409, 'กำลังเตรียมฐานข้อมูลในอีกคำขอ กรุณารอให้เสร็จก่อน');
        plan = await inspect(client);
        if (plan.blockers.length) throw httpError(409, `หยุดเตรียมฐานข้อมูล: ${plan.blockers.join(' • ')}`);
        if (plan.ready) return await record({ ready: true, applied: false, changes: [] });
        const startedAt = Date.now();
        if (backup === runBackupNow) await assertBackupTarget(database.options);
        snapshot = await backup();
        if (!snapshot?.filename || !(snapshot.sizeBytes > 0)) throw httpError(500, 'สำรองฐานข้อมูลไม่สำเร็จ ยังไม่ปรับโครงสร้าง');
        if (backup === runBackupNow) await verifyBackupSnapshot(snapshot, startedAt);
        await client.query('BEGIN'); transaction = true;
        await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL search_path=pg_catalog,kumon");
        // Reinspect after the backup, so changed data cannot make the earlier plan unsafe.
        plan = await inspect(client);
        if (plan.blockers.length) throw httpError(409, plan.blockers.join(' • '));
        for (const operation of plan.operations) await client.query(operation.sql);
        const after = await inspect(client);
        if (!after.ready) throw httpError(500, `ตรวจหลังปรับฐานข้อมูลยังไม่ผ่าน: ${after.blockers.join(' • ') || after.operations.map(item => item.name).join(', ')}`);
        await client.query('COMMIT'); transaction = false;
        return await record({ ready: true, applied: plan.operations.length > 0, backup: snapshot.filename,
            changes: plan.operations.map(({ kind, name }) => ({ kind, name })) });
    } catch (error) {
        if (transaction) {
            try { await client.query('ROLLBACK'); }
            catch (rollbackError) { releaseError = rollbackError; }
        }
        await record({ ready: false, applied: false, backup: snapshot?.filename,
            blockers: plan?.blockers || [], error: error.message });
        if (releaseError) throw httpError(500, `การเชื่อมต่อขาดระหว่างปรับฐานข้อมูล ต้องตรวจสถานะก่อนลองใหม่ • สำรอง ${snapshot?.filename || 'ไม่สำเร็จ'}`);
        throw httpError(error.statusCode || 500, `${error.message}${snapshot?.filename ? ` • สำรองก่อนปรับ: ${snapshot.filename} • ยังไม่รีสตาร์ต` : ''}`);
    } finally {
        if (locked) {
            try { await client.query('SELECT pg_advisory_unlock(76401, 2)'); }
            catch (error) { releaseError = error; }
        }
        client.release(releaseError);
    }
}
