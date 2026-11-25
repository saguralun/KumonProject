import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import productionPool from '../config/db.js';
import { createDeliveryOrder } from '../services/stockReceiveService.js';
import { createStockReceiveRetryStore } from '../services/stockReceiveRetry.js';

productionPool.query = () => assert.fail('Production pool.query is poisoned');
productionPool.connect = () => assert.fail('Production pool.connect is poisoned');

async function fixture(t, type = 'ws') {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kumon-do-retry-'));
    t.after(async () => {
        const relative = path.relative(os.tmpdir(), directory);
        assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
        await fs.rm(directory, { recursive: true, force: true });
    });
    const store = createStockReceiveRetryStore({ directory });
    const actor = 'account:fixture-only';
    const { epoch } = await store.getScope(actor);
    const context = (other = {}) => ({ actor, operationKey: `${epoch}:${randomBytes(16).toString('hex')}`, store, ...other });
    const payload = { type, doNo: 'SYNTHETIC-RETRY-ONLY', outDate: '2026-11-24', receiveDate: '2026-11-24', items: [{ masterId: 901, quantity: 10 }] };
    const db = { header: null, quantity: 0, commits: 0, rollbacks: 0, connections: 0, released: 0, missingMaster: null, loseCommitReply: false };
    t.mock.method(productionPool, 'query', async sql => {
        assert.match(sql, /SELECT stock_type_code, stock_type_id FROM kumon.stock_type_master/);
        return { rows: [{ stock_type_code: 'WS', stock_type_id: 1 }, { stock_type_code: 'CD', stock_type_id: 2 }] };
    });
    t.mock.method(productionPool, 'connect', async () => {
        db.connections++;
        let snapshot, committed = false;
        return { release() { db.released++; }, async query(sql, p = []) {
            sql = sql.replace(/\s+/g, ' ').trim();
            if (sql === 'BEGIN') { snapshot = structuredClone({ header: db.header, quantity: db.quantity }); return { rows: [] }; }
            if (sql === 'COMMIT') {
                db.commits++; committed = true;
                if (db.loseCommitReply) throw Error('Synthetic lost COMMIT acknowledgement');
                return { rows: [] };
            }
            if (sql === 'ROLLBACK') { db.rollbacks++; if (!committed) Object.assign(db, snapshot); return { rows: [] }; }
            if (sql.startsWith('SELECT stock_do_id, is_stock_processed')) return { rows: db.header ? [structuredClone(db.header)] : [] };
            if (sql.startsWith('INSERT INTO kumon.stock_do')) {
                db.header = { stock_do_id: 701, is_stock_processed: false };
                return { rows: [{ stock_do_id: 701 }] };
            }
            if (sql.startsWith('SELECT MIN(stm.stock_type_code)')) return { rows: [{ stock_type_code: type.toUpperCase() }] };
            if (/^SELECT 1 FROM kumon\.(worksheet_master|cd_master)/.test(sql)) return { rows: p[0] === db.missingMaster ? [] : [{}] };
            if (sql.startsWith('UPDATE kumon.stock_receive SET quantity = quantity +')) {
                const existed = db.quantity > 0;
                if (existed) db.quantity += p[0];
                return { rows: [], rowCount: existed ? 1 : 0 };
            }
            if (sql.startsWith('INSERT INTO kumon.stock_receive')) { db.quantity += p[3]; return { rows: [], rowCount: 1 }; }
            assert.fail(`Unsupported fixture SQL: ${sql}`);
        } };
    });
    return { directory, store, context, payload, db, save: (retry, value = payload) => createDeliveryOrder(type, value, retry) };
}

for (const type of ['ws', 'cd']) {
    test(`${type}: concurrent identical requests and lost-response retries add ten only once; restart returns original result`, async t => {
        const f = await fixture(t, type), retry = f.context();
        const results = await Promise.all(Array.from({ length: 6 }, () => f.save(retry)));
        assert.equal(f.db.quantity, 10); assert.equal(f.db.commits, 1); assert.equal(f.db.connections, 1);
        for (const result of results) assert.deepEqual(result, { type, doId: 701, doNo: f.payload.doNo, appended: false });
        // Reconstruct all journal state, as another process would after restart.
        const restarted = createStockReceiveRetryStore({ directory: f.directory });
        assert.deepEqual(await restarted.getScope(retry.actor), await f.store.getScope(retry.actor));
        f.db.header.is_stock_processed = true;
        assert.deepEqual(await f.save({ ...retry, store: restarted }), results[0]);
        assert.equal(f.db.connections, 1, 'Replay must not query or mutate current DO state');
        f.db.header.is_stock_processed = false;
        const appended = await f.save(f.context({ store: restarted }));
        assert.equal(appended.appended, true); assert.equal(f.db.quantity, 20); assert.equal(f.db.commits, 2);
        assert.equal(f.db.released, 2);
    });
}

test('A key is bound to the exact submitted fields and actor, including while in flight and after restart', async t => {
    const f = await fixture(t), retry = f.context();
    await f.save(retry);
    for (const payload of [
        { ...f.payload, doNo: 'OTHER' }, { ...f.payload, outDate: '2026-11-23' },
        { ...f.payload, receiveDate: '2026-11-23' }, { ...f.payload, items: [{ masterId: 901, quantity: 11 }] },
        { ...f.payload, items: [{ masterId: 901, quantity: '10' }] }
    ]) await assert.rejects(f.save(retry, payload), { statusCode: 409 });
    await assert.rejects(createDeliveryOrder('cd', f.payload, retry), { statusCode: 409 });
    const store = createStockReceiveRetryStore({ directory: f.directory });
    await assert.rejects(f.save({ ...retry, actor: 'account:other', store }), { statusCode: 409 });
    assert.equal(f.db.connections, 1); assert.equal(f.db.quantity, 10);
});

test('Validation failures and transaction rollback preserve quantities and permit a corrected new operation', async t => {
    const f = await fixture(t), invalid = f.context();
    await assert.rejects(f.save(invalid, { ...f.payload, items: [{ masterId: 901, quantity: 0 }] }), { statusCode: 400, stockReceiveRetrySafe: true });
    assert.equal(f.db.connections, 0);
    f.db.missingMaster = 902;
    const failed = f.context(), twoLines = { ...f.payload, items: [...f.payload.items, { masterId: 902, quantity: 5 }] };
    await assert.rejects(f.save(failed, twoLines), { statusCode: 400, stockReceiveRetrySafe: true });
    assert.equal(f.db.quantity, 0); assert.equal(f.db.header, null); assert.equal(f.db.commits, 0); assert.equal(f.db.rollbacks, 1);
    await assert.rejects(f.save({ ...failed, store: createStockReceiveRetryStore({ directory: f.directory }) }, twoLines), { statusCode: 400, stockReceiveRetrySafe: true });
    assert.equal(f.db.connections, 1, 'Rejected operation is replayed without rerunning SQL');
    f.db.missingMaster = null;
    await f.save(f.context()); assert.equal(f.db.quantity, 10); assert.equal(f.db.commits, 1);
});

test('Lost COMMIT acknowledgement leaves durable unresolved intent and never repeats SQL', async t => {
    const f = await fixture(t), retry = f.context(); f.db.loseCommitReply = true;
    await assert.rejects(f.save(retry), { statusCode: 409 });
    assert.equal(f.db.quantity, 10); assert.equal(f.db.commits, 1);
    await assert.rejects(f.save({ ...retry, store: createStockReceiveRetryStore({ directory: f.directory }) }), { statusCode: 409 });
    assert.equal(f.db.connections, 1); assert.equal(f.db.quantity, 10);
});

test('Failure to persist result after commit blocks replay across restart', async t => {
    const f = await fixture(t), retry = f.context();
    const rename = t.mock.method(fs, 'rename', async () => { throw Error('Synthetic full journal disk'); });
    await assert.rejects(f.save(retry), { statusCode: 409 }); rename.mock.restore();
    await assert.rejects(f.save({ ...retry, store: createStockReceiveRetryStore({ directory: f.directory }) }), { statusCode: 409 });
    assert.equal(f.db.quantity, 10); assert.equal(f.db.connections, 1);
});

test('Journal unavailable or incomplete before SQL blocks the write; stale scope and missing keys fail closed', async t => {
    const f = await fixture(t), retry = f.context();
    await fs.mkdir(path.join(f.directory, retry.operationKey.split(':')[1]));
    await assert.rejects(f.save(retry), { statusCode: 409 });
    await assert.rejects(f.save(f.context({ operationKey: `${randomUUID()}:${randomBytes(16).toString('hex')}` })), { statusCode: 409 });
    await assert.rejects(f.save(f.context({ operationKey: undefined })), { statusCode: 400 });
    await assert.rejects(f.save(f.context({ actor: null })), { statusCode: 401 });
    assert.equal(f.db.connections, 0);
});

test('Independent journal instances competing for a key cannot both execute it', async t => {
    const f = await fixture(t), retry = f.context();
    const second = createStockReceiveRetryStore({ directory: f.directory });
    const results = await Promise.allSettled([f.save(retry), f.save({ ...retry, store: second })]);
    assert.ok(results.some(result => result.status === 'fulfilled'));
    for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.statusCode, 409);
    assert.equal(f.db.quantity, 10); assert.equal(f.db.commits, 1);
    assert.equal((await f.save({ ...retry, store: second })).doId, 701);
});

test('A fresh Node process replays the persisted service result without executing work', async t => {
    const f = await fixture(t), retry = f.context();
    const expected = await f.save(retry);
    const code = `
        import { createStockReceiveRetryStore } from './services/stockReceiveRetry.js';
        const [directory, operationKey, actor, serialized] = process.argv.slice(1);
        const store = createStockReceiveRetryStore({ directory });
        const value = await store.run('ws', JSON.parse(serialized), { actor, operationKey },
            () => { throw Error('Restart must not run additive work'); });
        process.stdout.write(JSON.stringify(value));
    `;
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code,
        f.directory, retry.operationKey, retry.actor, JSON.stringify(f.payload)], { windowsHide: true, timeout: 10000 });
    assert.deepEqual(JSON.parse(stdout), expected);
    assert.equal(f.db.quantity, 10); assert.equal(f.db.connections, 1);
});
