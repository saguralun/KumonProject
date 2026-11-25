import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeDate, normalizeNullableDate, assertIsoDate } from '../services/dateHelpers.js';
import { createStockTypeResolver } from '../services/stockTypeResolver.js';
import {
    clean, nullable, masterKey, previewKey, parseDateToAd, parsePositiveInteger,
    parseMonth, parseYear, parseBoolean, parseLevelCode, sortedLevelCodes,
    issueList, countIssueMaps, validationItem, hasValidationErrors
} from '../migration/migrationValueHelpers.js';

test('Service dates retain local calendar fields and distinct form/stock empty values', () => {
    const local = new Date(2026, 10, 23, 0, 5);
    assert.equal(normalizeDate(local), '2026-11-23');
    assert.equal(normalizeNullableDate(local), '2026-11-23');
    assert.equal(normalizeDate('2026-11-23T23:55:00Z'), '2026-11-23');
    for (const value of [null, undefined, '', false, 0]) {
        assert.equal(normalizeDate(value), '');
        assert.equal(normalizeNullableDate(value), null);
    }
    assert.equal(normalizeDate(20261123), '');
    assert.equal(normalizeNullableDate(20261123), '20261123');
    assert.equal(assertIsoDate(local, 'วันที่'), '2026-11-23');
    assert.throws(() => assertIsoDate('23/11/2026', 'วันที่'), { statusCode: 400, message: 'วันที่ ไม่ถูกต้อง' });
});

test('Migration text keys, date eras and validation results preserve import contracts', () => {
    assert.equal(clean('\uFEFF  ไทย\tTest\n name '), 'ไทย Test name');
    assert.equal(nullable('  '), null);
    assert.equal(masterKey(' ME ', null, 'A'), 'me||a');
    assert.equal(previewKey(' ME ', null, 'A'), 'me||a');
    for (const [source, expected] of [
        ['29/02/2567', '2024-02-29'], ['1-1-70', '1970-01-01'],
        ['1/1/69 08:15:30', '2069-01-01'], ['23/11/2026', '2026-11-23']
    ]) assert.deepEqual(parseDateToAd(source, 'Date'), { value: expected, error: null });
    assert.deepEqual(parseDateToAd('29/02/2025', 'Date'), { value: null, error: 'Date is invalid: 29/02/2025' });
    assert.deepEqual(parseDateToAd('', 'Date'), { value: null, error: 'Date is required.' });
    assert.deepEqual(parseDateToAd('2026-11-23', 'Date'), { value: null, error: 'Date must use dd/mm/yyyy: 2026-11-23' });
    assert.deepEqual(parsePositiveInteger('001', 'Qty'), { value: 1, error: null });
    for (const value of ['0', '-1', '1.5', '9007199254740992']) assert.ok(parsePositiveInteger(value, 'Qty').error);
    assert.deepEqual(parseMonth('13', 'Month'), { value: 13, error: 'Month must be 1-12: 13' });
    assert.deepEqual(parseYear('2026', 'Year'), { value: 2026, error: null });
    assert.ok(parseYear('2569', 'Year').error);
    for (const value of ['TRUE', ' yes ', '1']) assert.deepEqual(parseBoolean(value, 'Flag'), { value: true, error: null });
    for (const value of ['FALSE', ' no ', '0']) assert.deepEqual(parseBoolean(value, 'Flag'), { value: false, error: null });
    assert.deepEqual(parseBoolean('', 'Flag'), { value: null, error: 'Flag must be TRUE or FALSE: (blank)' });
    const levels = sortedLevelCodes(['A', 'ZI', 'ZII', '6A'].map(level_code => ({ level_code })));
    assert.deepEqual(parseLevelCode(' zii21 ', levels), { levelCode: 'ZII', error: null });
    assert.equal(parseLevelCode('XYZ', levels).levelCode, null);
});

test('Migration issue summaries retain counts, ordering and error/warning precedence', () => {
    const issues = new Map([['a', { value: 'A', count: 1 }], ['b', { value: 'B', count: 3 }]]);
    assert.deepEqual(issueList(issues).map(row => row.value), ['B', 'A']);
    assert.deepEqual(countIssueMaps({ date: issues, number: new Map() }), { date: 4, number: 0 });
    assert.deepEqual(validationItem('Rows', 2, 3), { label: 'Rows', status: 'ERROR', errors: 2 });
    assert.deepEqual(validationItem('Rows', 0, 3), { label: 'Rows', status: 'WARNING', errors: 0, warnings: 3 });
    assert.equal(hasValidationErrors({ validation: [validationItem('Rows', 0, 3)] }), false);
    assert.equal(hasValidationErrors({ validation: [validationItem('Rows', 2)] }), true);
});

test('Stock resolvers retain separate configs/caches and reject invalid types before querying', async () => {
    const calls = [];
    const pool = { query: async sql => {
        calls.push(sql);
        return { rows: [{ stock_type_code: 'WS', stock_type_id: 1 }, { stock_type_code: 'CD', stock_type_id: 2 }] };
    } };
    const receive = createStockTypeResolver({ pool, schema: 'kumon', itemTypes: { ws: { stockTypeCode: 'WS', masterTable: 'worksheet_master' } } });
    const cut = createStockTypeResolver({ pool, schema: 'kumon', itemTypes: { ws: { stockTypeCode: 'WS', usedTable: 'worksheet_used' } } });
    await assert.rejects(receive('at'), { statusCode: 400 });
    assert.equal(calls.length, 0);
    assert.deepEqual(await receive(' WS '), { type: 'ws', stockTypeId: 1, stockTypeCode: 'WS', masterTable: 'worksheet_master' });
    await receive('ws');
    assert.equal(calls.length, 1);
    assert.equal((await cut('ws')).usedTable, 'worksheet_used');
    assert.equal(calls.length, 2);
    const missing = createStockTypeResolver({ pool: { query: async () => ({ rows: [] }) }, schema: 'kumon', itemTypes: { cd: { stockTypeCode: 'CD' } } });
    await assert.rejects(missing('cd'), { statusCode: 500, message: 'ไม่พบ stock_type_master สำหรับ CD' });
});
