import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { updateDeliveryOrderItemQuantity } from '../services/stockReceiveService.js';

pool.query = () => assert.fail('Real DB forbidden');
pool.connect = () => assert.fail('Real DB forbidden');

test('A stale DO editor cannot overwrite a concurrent addition, but a freshly reviewed quantity can save', async t => {
    let quantity = 15, commits = 0, rollbacks = 0;
    t.mock.method(pool, 'connect', async () => ({ release() {}, async query(sql, p = []) {
        if (sql.includes('FROM kumon.stock_do')) return { rows: [{ stock_do_id: 1, is_stock_processed: false }] };
        if (sql.includes('SELECT stock_receive_id')) return { rows: [{ stock_receive_id: 2, quantity }] };
        if (sql.startsWith('UPDATE')) quantity = p[0];
        if (sql === 'COMMIT') commits++;
        if (sql === 'ROLLBACK') rollbacks++;
        return { rows: [], rowCount: 1 };
    } }));
    await assert.rejects(updateDeliveryOrderItemQuantity(1, 2, 12, 10), { statusCode: 409 });
    assert.equal(quantity, 15); assert.equal(commits, 0); assert.equal(rollbacks, 1);
    await updateDeliveryOrderItemQuantity(1, 2, 12, 15);
    assert.equal(quantity, 12); assert.equal(commits, 1);
});

test('A legacy zero quantity can be corrected without weakening validation of the new amount', async t => {
    let quantity = 0;
    t.mock.method(pool, 'connect', async () => ({ release() {}, async query(sql, p = []) {
        if (sql.includes('FROM kumon.stock_do')) return { rows: [{ stock_do_id: 1, is_stock_processed: false }] };
        if (sql.includes('SELECT stock_receive_id')) return { rows: [{ stock_receive_id: 2, quantity }] };
        if (sql.startsWith('UPDATE')) quantity = p[0];
        return { rows: [], rowCount: 1 };
    } }));
    await updateDeliveryOrderItemQuantity(1, 2, 5, 0);
    assert.equal(quantity, 5);
    await assert.rejects(updateDeliveryOrderItemQuantity(1, 2, 0, 5), { statusCode: 400 });
    for (const invalid of [null, '', true, []]) {
        await assert.rejects(updateDeliveryOrderItemQuantity(1, 2, 6, invalid), { statusCode: 400 });
    }
    assert.equal(quantity, 5);
});
