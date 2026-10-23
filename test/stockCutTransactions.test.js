import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { processPendingDates } from '../services/stockCutService.js';

function mockStock(t, { initial = 10, lateInsert = false } = {}) {
    let stock = initial, gate = Promise.resolve(), commits = 0;
    const rows = [{ id: 1, processed: false, physical: true }, { id: 2, processed: false, physical: true }, { id: 3, processed: false, physical: true }, { id: 4, processed: false, physical: false }];
    t.mock.method(pool, 'query', async (sql) => {
        assert.match(sql, /stock_type_master/);
        return { rows: [{ stock_type_code: 'WS', stock_type_id: 1 }, { stock_type_code: 'CD', stock_type_id: 2 }] };
    });
    t.mock.method(pool, 'connect', async () => {
        let unlock = () => {};
        return { release() { unlock(); }, async query(sql, params = []) {
            if (sql.includes('FOR UPDATE')) {
                const preceding = gate; gate = new Promise((resolve) => { unlock = resolve; }); await preceding;
                const result = rows.filter((row) => !row.processed).map((row) => ({ worksheet_used_id: row.id, cd_used_id: row.id }));
                if (lateInsert && !rows.some((row) => row.id === 5)) rows.push({ id: 5, processed: false, physical: true });
                return { rows: result };
            }
            if (sql.includes('AS quantity')) {
                assert.match(sql, /(?:worksheet_used_id|cd_used_id) = ANY\(\$2::int\[\]\)/);
                const count = rows.filter((row) => !row.processed && row.physical && params[1].includes(row.id)).length;
                return { rows: count ? [{ master_id: 99, quantity: count }] : [] };
            }
            if (sql.includes('pending_count')) return { rows: [{ pending_count: rows.filter((row) => !row.processed && params[1].includes(row.id)).length }] };
            if (sql.includes('INSERT INTO kumon.stock')) {
                assert.match(sql, /VALUES \(\$1, \$2, -\$3::integer\)/);
                stock = stock == null ? -params[2] : stock - params[2];
            }
            if (sql.includes('SET is_stock_processed = TRUE')) {
                let count = 0;
                for (const row of rows) if (!row.processed && params[1].includes(row.id)) { row.processed = true; count++; }
                return { rowCount: count };
            }
            if (sql === 'COMMIT') commits++;
            return { rows: [], rowCount: 0 };
        } };
    });
    return { rows, get stock() { return stock; }, get commits() { return commits; } };
}

test('First cut of an item with no stock row creates a negative balance, not positive stock', async (t) => {
    const db = mockStock(t, { initial: null });
    const result = await processPendingDates('ws', ['2026-10-23']);
    assert.equal(db.stock, -3); assert.equal(result.recordsProcessed, 4);
});

test('Concurrent WS cuts serialize and deduct the same usage rows only once', async (t) => {
    const db = mockStock(t);
    const results = await Promise.allSettled([processPendingDates('ws', ['2026-10-23']), processPendingDates('ws', ['2026-10-23'])]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(results.find((result) => result.status === 'rejected').reason.statusCode, 404);
    assert.equal(db.stock, 7); assert.equal(db.commits, 1);
});

test('Rows inserted after the cut snapshot are neither deducted nor marked processed', async (t) => {
    const db = mockStock(t, { lateInsert: true });
    await processPendingDates('ws', ['2026-10-23']);
    assert.equal(db.stock, 7); assert.equal(db.rows.find((row) => row.id === 5).processed, false);
});

test('CD cuts retain their row locking and fake usage does not deduct stock', async (t) => {
    const db = mockStock(t);
    await processPendingDates('cd', ['2026-10-23']);
    assert.equal(db.stock, 7); assert.equal(db.rows.every((row) => row.processed), true);
});
