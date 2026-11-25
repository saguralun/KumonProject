import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { createDeliveryOrder } from '../services/stockReceiveService.js';
pool.query = () => assert.fail('Real DB forbidden');
pool.connect = () => assert.fail('Real DB forbidden');

for (const type of ['ws', 'cd']) test(`${type}: append with different dates must not silently add quantities to the existing DO`, async t => {
    let added = 0, commits = 0, originalReceiveDate = '2026-11-20';
    t.mock.method(pool, 'query', async () => ({ rows: [{ stock_type_code: 'WS', stock_type_id: 1 }, { stock_type_code: 'CD', stock_type_id: 2 }] }));
    t.mock.method(pool, 'connect', async () => ({ release() {}, async query(sql, p = []) {
        if (sql.includes('FROM kumon.stock_do')) return { rows: [{ stock_do_id: 1, is_stock_processed: false, out_date: '2026-11-20', receive_date: originalReceiveDate }] };
        if (sql.includes('SELECT MIN')) return { rows: [{ stock_type_code: type.toUpperCase() }] };
        if (sql.includes('SET quantity = quantity +')) { added += p[0]; return { rows: [], rowCount: 1 }; }
        if (sql === 'COMMIT') commits++;
        return { rows: [{}], rowCount: 1 };
    } }));
    const payload = { doNo: 'FIXTURE-DATES', outDate: '2026-11-20', receiveDate: '2026-11-20', items: [{ masterId: 1, quantity: 5 }] };
    for (const key of ['outDate', 'receiveDate']) {
        await assert.rejects(createDeliveryOrder(type, { ...payload, [key]: '2026-11-21' }), error => error.statusCode === 409 && /วันที่/.test(error.message));
        assert.equal(added, 0); assert.equal(commits, 0);
    }
    assert.equal((await createDeliveryOrder(type, payload)).appended, true);
    assert.equal(added, 5); assert.equal(commits, 1);
    originalReceiveDate = '2026-11-21';
    const legacy = { ...payload }; delete legacy.receiveDate;
    assert.equal((await createDeliveryOrder(type, legacy)).appended, true, 'Omitted receiveDate must not pretend to change the existing header');
    assert.equal(added, 10); assert.equal(commits, 2);
});
