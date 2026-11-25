import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { httpError } from './httpError.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const uncertain = () => httpError(409, 'ยังยืนยันผลบันทึก DO ไม่ได้ กรุณาตรวจ DO ก่อนเริ่มรายการใหม่ ห้ามเพิ่มซ้ำโดยไม่ตรวจสอบ');

// No DB/file atomic commit exists. Persist intent before touching SQL, then
// persist the result before replying. An interrupted intent is NEVER rerun:
// the narrow commit/journal crash window requires manual DO reconciliation.
// Keep this directory with the database; do not rotate it as disposable logs.
export function createStockReceiveRetryStore({ directory }) {
    const inFlight = new Map();
    let scopePromise;

    async function writeSynced(filename, value) {
        const file = await fs.open(filename, 'wx', 0o600);
        try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
        finally { await file.close(); }
    }

    async function namespace() {
        if (!scopePromise) {
            scopePromise = (async () => {
                await fs.mkdir(directory, { recursive: true });
                const filename = path.join(directory, 'scope.json');
                try { await writeSynced(filename, { epoch: randomUUID() }); }
                catch (error) { if (error.code !== 'EEXIST') throw error; }
                const { epoch } = JSON.parse(await fs.readFile(filename, 'utf8'));
                if (!/^[\da-f-]{36}$/i.test(epoch)) throw new Error('Invalid DO retry journal scope');
                return epoch;
            })();
        }
        return scopePromise;
    }

    async function getScope(actor) {
        if (!actor) throw httpError(401, 'กรุณาเข้าสู่ระบบก่อนบันทึก DO');
        return { epoch: await namespace(), actor: digest(String(actor)) };
    }

    async function execute(operationKey, receipt, run) {
        const operationDir = path.join(directory, operationKey.split(':')[1]);
        let claimed = false;
        try { await fs.mkdir(operationDir); claimed = true; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (!claimed) {
            let original, completed;
            try {
                original = JSON.parse(await fs.readFile(path.join(operationDir, 'intent.json'), 'utf8'));
                if (original.actor !== receipt.actor || original.payload !== receipt.payload) throw uncertain();
                completed = JSON.parse(await fs.readFile(path.join(operationDir, 'result.json'), 'utf8'));
            } catch { throw uncertain(); }
            if (completed.success === true && completed.result?.doId) return completed.result;
            if (completed.success === false && completed.retrySafe === true) {
                const error = httpError(completed.statusCode, completed.error);
                error.stockReceiveRetrySafe = true;
                throw error;
            }
            throw uncertain();
        }
        await writeSynced(path.join(operationDir, 'intent.json'), receipt);
        let completed;
        try {
            completed = { success: true, result: await run() };
        } catch (error) {
            if (error.stockReceiveOutcomeUnknown) throw uncertain();
            completed = { success: false, retrySafe: true, statusCode: error.statusCode || 500, error: error.message };
        }
        // Exclusive claim owns this directory. Readers see either a complete
        // result or unresolved intent, never a partially written result.
        try {
            const temporary = path.join(operationDir, `${randomUUID()}.tmp`);
            await writeSynced(temporary, completed);
            await fs.rename(temporary, path.join(operationDir, 'result.json'));
        } catch { throw uncertain(); }
        if (completed.success) return completed.result;
        const error = httpError(completed.statusCode, completed.error);
        error.stockReceiveRetrySafe = true;
        throw error;
    }

    async function run(type, payload, { actor, operationKey }, work) {
        const scope = await getScope(actor);
        if (typeof operationKey !== 'string' || !/^[\da-f-]{36}:[\da-f]{32}$/i.test(operationKey)) {
            throw httpError(400, 'ไม่พบรหัสการบันทึก DO กรุณาโหลดหน้าใหม่');
        }
        if (!operationKey.startsWith(`${scope.epoch}:`)) throw uncertain();
        const receipt = { actor: scope.actor, payload: digest(JSON.stringify([type, payload?.doNo,
            payload?.outDate, payload?.receiveDate, Array.isArray(payload?.items)
                ? payload.items.map(item => [item?.masterId, item?.quantity]) : payload?.items])) };
        const existing = inFlight.get(operationKey);
        if (existing) {
            if (existing.actor !== receipt.actor || existing.payload !== receipt.payload) throw uncertain();
            return existing.result;
        }
        const current = { ...receipt };
        current.result = execute(operationKey, receipt, work);
        inFlight.set(operationKey, current);
        try { return await current.result; }
        finally { inFlight.delete(operationKey); }
    }

    return { getScope, run };
}

// Lazy: importing a service/test never creates runtime state or reads .env.
let defaultStore;
function store() {
    return defaultStore ||= createStockReceiveRetryStore({ directory: path.resolve(
        process.env.STOCK_RECEIVE_RETRY_DIR || path.join(process.env.BACKUP_DIR || path.join(process.cwd(), 'backups'), 'stock-receive-retries')) });
}
export const getStockReceiveRetryScope = actor => store().getScope(actor);
export const runStockReceiveOperation = (type, payload, retry, work) => (retry.store || store()).run(type, payload, retry, work);
