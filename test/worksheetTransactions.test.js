import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { saveWorksheetEntries, deleteWorksheetEntry, updateWorksheetEntryDate } from '../services/worksheetService.js';

const payload = { enrollmentId: 1, receiveDate: '2026-10-23', patternCode: 'daily10', mainWorksheetNos: [101] };
const enrollment = { enrollment_id: 1, student_id: 1, current_level_master_id: 1, current_level_code: 'C', subject_code: 'ME', status_code: 'C' };
const stored = { worksheet_used_id: 1, enrollment_id: 1, worksheet_master_id: 99, level_master_id: 1, level_code: 'C',
    actual_worksheet_no: 101, worksheet_date: '2026-10-23', cpws: true, is_stock_processed: false };

function mockStore(t, { failSummary = false } = {}) {
    let held = 0, committed = 0, rolledBack = 0, summaryReads = 0;
    const queries = [];
    const read = (sql) => {
        if (sql.includes('FROM kumon.enrollment e')) return { rows: [enrollment] };
        if (sql.includes('WHERE level_master_id = $1')) return { rows: [{ worksheet_master_id: 99, level_master_id: 1, worksheet_no: 101 }] };
        throw new Error(`Unexpected pool read: ${sql}`);
    };
    t.mock.method(pool, 'query', async (sql) => {
        assert.equal(held, 0, 'A transaction must never request another pooled connection');
        return read(sql);
    });
    t.mock.method(pool, 'connect', async () => {
        held++;
        return { release() { held--; }, async query(sql) {
            queries.push(sql);
            if (sql === 'COMMIT') { committed++; return { rows: [] }; }
            if (sql === 'ROLLBACK') { rolledBack++; return { rows: [] }; }
            if (sql.includes('FROM kumon.enrollment e')) return { rows: [enrollment] };
            if (sql.includes('INSERT INTO kumon.worksheet_used') || sql.includes('WITH inserted AS')) return { rows: [stored] };
            if (sql.includes('FOR UPDATE')) return { rows: [stored] };
            if (sql.includes('can_complete_ws_level')) {
                summaryReads++;
                if (failSummary) throw new Error('summary failed');
                return { rows: [{}] };
            }
            return { rows: [], rowCount: 1 };
        } };
    });
    return { queries, get held() { return held; }, get committed() { return committed; }, get rolledBack() { return rolledBack; }, get summaryReads() { return summaryReads; } };
}

test('WS saves compute all response summaries on their transaction connection before committing', async (t) => {
    const db = mockStore(t);
    const result = await saveWorksheetEntries(payload);
    assert.equal(result.records.length, 1); assert.equal(db.committed, 1); assert.equal(db.held, 0); assert.equal(db.summaryReads, 1);
    assert.equal(db.queries.at(-1), 'COMMIT'); assert.equal(db.rolledBack, 0);
});

test('A WS summary failure rolls back the insert rather than reporting failure after data has already committed', async (t) => {
    const db = mockStore(t, { failSummary: true });
    await assert.rejects(saveWorksheetEntries(payload), /summary failed/);
    assert.equal(db.committed, 0); assert.equal(db.rolledBack, 1); assert.equal(db.held, 0);
});

test('Ten concurrent WS saves complete without acquiring extra connections while holding all ten', async (t) => {
    const db = mockStore(t);
    const results = await Promise.all(Array.from({ length: 10 }, () => saveWorksheetEntries(payload)));
    assert.equal(results.length, 10); assert.equal(db.committed, 10); assert.equal(db.held, 0);
});

test('WS deletion and date correction also read their response state before commit on the same connection', async (t) => {
    const db = mockStore(t);
    await deleteWorksheetEntry({ enrollmentId: 1, worksheetUsedId: 1 });
    await updateWorksheetEntryDate({ enrollmentId: 1, worksheetUsedId: 1, worksheetDate: '2026-10-24' });
    assert.equal(db.committed, 2); assert.equal(db.summaryReads, 2); assert.equal(db.held, 0);
});
