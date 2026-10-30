import assert from 'node:assert/strict';
import { test } from 'node:test';
import productionPool from '../config/db.js';
import { createDeliveryOrder, processDeliveryOrder } from '../services/stockReceiveService.js';

productionPool.query = () => assert.fail('Production pool.query is poisoned');
productionPool.connect = () => assert.fail('Production pool.connect is poisoned');

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('Appending a pending DO holds the parent lock until its lines commit, so Process credits all quantities', async t => {
    const appendPaused = deferred(), resumeAppend = deferred(), processRead = deferred();
    let tail = Promise.resolve(), clients = 0, quantity = 2, stock = 0, processed = false;
    t.mock.method(productionPool, 'query', async () => ({ rows: [{ stock_type_code: 'WS', stock_type_id: 1 }, { stock_type_code: 'CD', stock_type_id: 2 }] }));
    t.mock.method(productionPool, 'connect', async () => {
        const id = ++clients;
        let unlock;
        const release = () => { unlock?.(); unlock = undefined; };
        async function lock() {
            const previous = tail;
            const next = deferred(); tail = next.promise;
            await previous; unlock = next.resolve;
        }
        return { release, async query(sql, p = []) {
            if (sql.includes('FROM kumon.stock_do') && sql.includes('SELECT stock_do_id')) {
                if (sql.includes('FOR UPDATE')) await lock();
                return { rows: [{ stock_do_id: 1, do_no: 'fixture', is_stock_processed: processed }] };
            }
            if (sql.includes('MIN(stm.stock_type_code)')) return { rows: [{ stock_type_code: 'WS' }] };
            if (sql.includes('SELECT 1 FROM kumon.worksheet_master')) {
                appendPaused.resolve(); await resumeAppend.promise; return { rows: [{}] };
            }
            if (sql.includes('SELECT stock_type_id, master_id, quantity')) {
                processRead.resolve(); return { rows: [{ stock_type_id: 1, master_id: 99, quantity }] };
            }
            if (sql.includes('SET quantity = quantity + $1')) quantity += p[0];
            if (sql.includes('INSERT INTO kumon.stock (')) stock += p[2];
            if (sql.includes('SET is_stock_processed = TRUE')) processed = true;
            if (sql === 'COMMIT' || sql === 'ROLLBACK') release();
            return { rows: [], rowCount: 1 };
        } };
    });
    const append = createDeliveryOrder('ws', { doNo: 'fixture', outDate: '2026-10-30', items: [{ masterId: 99, quantity: 3 }] });
    await appendPaused.promise;
    const process = processDeliveryOrder(1);
    try {
        const earlyRead = await Promise.race([processRead.promise.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 30))]);
        assert.equal(earlyRead, false, 'Process must not read the old lines while Append owns the parent');
    } finally { resumeAppend.resolve(); }
    await Promise.all([append, process]);
    assert.equal(quantity, 5); assert.equal(stock, 5); assert.equal(processed, true);
});

test('An append that finds the DO already processed rejects before changing any lines', async t => {
    let wrote = false, rolledBack = false;
    t.mock.method(productionPool, 'query', async () => ({ rows: [{ stock_type_code: 'WS', stock_type_id: 1 }, { stock_type_code: 'CD', stock_type_id: 2 }] }));
    t.mock.method(productionPool, 'connect', async () => ({ release() {}, async query(sql) {
        if (sql.includes('SELECT stock_do_id')) return { rows: [{ stock_do_id: 1, is_stock_processed: true }] };
        if (/INSERT INTO|UPDATE kumon.stock_receive/.test(sql)) wrote = true;
        if (sql === 'ROLLBACK') rolledBack = true;
        return { rows: [] };
    } }));
    await assert.rejects(createDeliveryOrder('ws', { doNo: 'fixture', outDate: '2026-10-30', items: [{ masterId: 99, quantity: 3 }] }), { statusCode: 409 });
    assert.equal(wrote, false); assert.equal(rolledBack, true);
});
