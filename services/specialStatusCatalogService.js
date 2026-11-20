import pool from '../config/db.js';
import { runBackupNow } from './backupService.js';
import { httpError } from './httpError.js';

const findSql = "SELECT status_id,status_code,status_name,status_group FROM kumon.status_master WHERE status_code='FRGH'";
function existingStatus(row) {
    if (Number(row.status_group) !== 2) throw httpError(409, 'รหัส FRGH มีอยู่ในกลุ่มที่ไม่ใช่ Special Status กรุณาตรวจรายการรหัส');
    return { ready: true, added: false, statusId: Number(row.status_id) };
}

// Only this explicitly supported reference row is added. No schema repair or
// existing status/enrollment/billing changes belong in this preparation.
export async function ensureFrghStatus({ database = pool, backup = runBackupNow } = {}) {
    const found = await database.query(findSql);
    if (found.rows[0]) return existingStatus(found.rows[0]);
    const client = await database.connect();
    try {
        await client.query('BEGIN');
        await client.query('LOCK TABLE kumon.status_master IN SHARE ROW EXCLUSIVE MODE');
        const checked = await client.query(findSql);
        if (checked.rows[0]) {
            const result = existingStatus(checked.rows[0]);
            await client.query('COMMIT');
            return result;
        }
        const archive = await backup();
        if (!archive?.filename || !(archive.sizeBytes > 0)) throw httpError(500, 'ยังไม่เพิ่ม FRGH เพราะยืนยันไฟล์สำรองข้อมูลไม่ได้');
        const result = await client.query(`INSERT INTO kumon.status_master(status_id,status_code,status_name,status_group)
            SELECT COALESCE(MAX(status_id),0)+1,'FRGH','Free Registration (Half Month)',2 FROM kumon.status_master
            RETURNING status_id`);
        await client.query('COMMIT');
        return { ready: true, added: true, statusId: Number(result.rows[0].status_id), backupFilename: archive.filename };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

let preparation;
export function startSpecialStatusPreparation(options) {
    if (!preparation) preparation = ensureFrghStatus(options).catch(error => ({ ready: false, error: `เตรียมรหัส FRGH ไม่สำเร็จ: ${error.message}` }));
    return preparation;
}
export async function waitForSpecialStatusPreparation() {
    return preparation ? await preparation : null;
}
