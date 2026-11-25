import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDeliveryOrder, processDeliveryOrder, updateDeliveryOrderItemQuantity } from '../../services/stockReceiveService.js';
import { createStockReceiveRetryStore } from '../../services/stockReceiveRetry.js';

// Parent must call ONLY after verifying the disposable PostgreSQL cluster and
// redirecting both productionPool.query/connect to it. No DDL or auth/session writes.
// Usage: await t.test('DO retry SQL safety', () => assertStockReceiveRetryDatabaseSafety(database));
export async function assertStockReceiveRetryDatabaseSafety(database) {
    const identity = (await database.query(`SELECT current_user AS owner,
        current_setting('data_directory') AS directory`)).rows[0];
    assert.equal(identity.owner, 'kumondb_isolated_test', 'Refuse any non-fixture database');
    assert.match(identity.directory, /kumondb-isolated-pg-/);
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kumon-do-retry-pg-'));
    const prefix = `retry-sql-${randomUUID()}`;
    const actor = `account:${prefix}`;
    const store = createStockReceiveRetryStore({ directory });
    const { epoch } = await store.getScope(actor);
    const context = (journal = store) => ({ actor, store: journal,
        operationKey: `${epoch}:${randomBytes(16).toString('hex')}` });
    try {
        for (const type of ['ws', 'cd']) {
            const table = type === 'ws' ? 'worksheet_master' : 'cd_master';
            const column = `${table}_id`;
            const masterId = (await database.query(`SELECT ${column} AS id FROM kumon.${table} ORDER BY ${column} LIMIT 1`)).rows[0]?.id;
            assert.ok(masterId, `${type} fixture master must exist`);
            const stockTypeId = (await database.query('SELECT stock_type_id FROM kumon.stock_type_master WHERE stock_type_code=$1', [type.toUpperCase()])).rows[0].stock_type_id;
            const before = (await database.query('SELECT quantity, updated_at FROM kumon.stock WHERE stock_type_id=$1 AND master_id=$2', [stockTypeId, masterId])).rows[0];
            const doNo = `${prefix}-${type}`;
            const payload = { doNo, outDate: '2026-11-24', receiveDate: '2026-11-24', items: [{ masterId, quantity: 10 }] };
            let doId;
            try {
                const retry = context();
                const results = await Promise.all(Array.from({ length: 4 }, () => createDeliveryOrder(type, payload, retry)));
                doId = results[0].doId;
                for (const result of results) assert.deepEqual(result, results[0]);
                assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.stock_do WHERE do_no=$1', [doNo])).rows[0].n, 1);
                const total = async () => Number((await database.query('SELECT SUM(quantity) AS n FROM kumon.stock_receive WHERE stock_do_id=$1', [doId])).rows[0].n);
                assert.equal(await total(), 10);
                const restarted = createStockReceiveRetryStore({ directory });
                assert.deepEqual(await createDeliveryOrder(type, payload, { ...retry, store: restarted }), results[0]);
                assert.equal(await total(), 10);
                await assert.rejects(createDeliveryOrder(type, { ...payload, items: [{ masterId, quantity: 11 }] }, { ...retry, store: restarted }), { statusCode: 409 });
                await assert.rejects(createDeliveryOrder(type, payload, { ...retry, actor: 'account:another-fixture', store: restarted }), { statusCode: 409 });
                await createDeliveryOrder(type, payload, context(restarted));
                assert.equal(await total(), 20, 'Equal quantities with a fresh key are an intentional append');
                const receiveId = (await database.query('SELECT stock_receive_id FROM kumon.stock_receive WHERE stock_do_id=$1', [doId])).rows[0].stock_receive_id;
                await assert.rejects(updateDeliveryOrderItemQuantity(doId, receiveId, 12, 10), { statusCode: 409 });
                assert.equal(await total(), 20, 'A stale editor must not overwrite the intentional append');
                await updateDeliveryOrderItemQuantity(doId, receiveId, 12, 20);
                assert.equal(await total(), 12);
                await updateDeliveryOrderItemQuantity(doId, receiveId, 20, 12);
                const missingId = (await database.query(`SELECT COALESCE(MAX(${column}),0)+1 AS id FROM kumon.${table}`)).rows[0].id;
                await assert.rejects(createDeliveryOrder(type, { ...payload, items: [
                    { masterId, quantity: 10 }, { masterId: missingId, quantity: 1 }
                ] }, context(restarted)), { statusCode: 400, stockReceiveRetrySafe: true });
                assert.equal(await total(), 20, 'The first valid line must roll back with the invalid second line');
                const processed = await Promise.allSettled([processDeliveryOrder(doId), processDeliveryOrder(doId)]);
                assert.equal(processed.filter(result => result.status === 'fulfilled').length, 1);
                assert.equal(processed.find(result => result.status === 'rejected').reason.statusCode, 409);
                const stock = async () => Number((await database.query('SELECT quantity FROM kumon.stock WHERE stock_type_id=$1 AND master_id=$2', [stockTypeId, masterId])).rows[0].quantity);
                assert.equal(await stock(), Number(before?.quantity || 0) + 20);
                assert.deepEqual(await createDeliveryOrder(type, payload, { ...retry, store: createStockReceiveRetryStore({ directory }) }), results[0]);
                assert.equal(await total(), 20); assert.equal(await stock(), Number(before?.quantity || 0) + 20);
                await assert.rejects(createDeliveryOrder(type, payload, context()), { statusCode: 409, stockReceiveRetrySafe: true });
            } finally {
                // Remove only this helper's DO, and restore the pre-helper balance.
                await database.query('DELETE FROM kumon.stock_receive WHERE stock_do_id IN (SELECT stock_do_id FROM kumon.stock_do WHERE do_no=$1)', [doNo]);
                await database.query('DELETE FROM kumon.stock_do WHERE do_no=$1', [doNo]);
                if (before) await database.query('UPDATE kumon.stock SET quantity=$3, updated_at=$4 WHERE stock_type_id=$1 AND master_id=$2', [stockTypeId, masterId, before.quantity, before.updated_at]);
                else await database.query('DELETE FROM kumon.stock WHERE stock_type_id=$1 AND master_id=$2', [stockTypeId, masterId]);
            }
        }
    } finally {
        const relative = path.relative(os.tmpdir(), directory);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
        await fs.rm(directory, { recursive: true, force: true });
    }
}
