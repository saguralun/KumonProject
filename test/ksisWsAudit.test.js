import assert from "node:assert/strict";
import { test } from "node:test";
import { compareKsisWs, isKsisAuditReadRequest } from "../services/ksisWsAudit.js";

const record = (extra = {}) => ({ "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ", "วันเกิด": "01/01/2020",
    Subject: "ME", CurrentLevel: "C90", WksUsed: 8, Status1: "C", ...extra });
const site = (extra = {}) => ({ key: "one", kumonId: "7642650000001", fullName: "ตัวอย่าง ทดสอบ", birthDate: "01/01/2020", subject: "ME",
    level: { value: "C" }, worksheet: { value: "90" }, used: { value: "8" }, status: { value: "C" }, ...extra });
const docs = (rows) => [{ page: 1, rows }];

test('WS audit compares ID-less special statuses by exact name and DOB without conflating different children', () => {
    const records = ['R', 'IT', 'N', 'EO'].map((Status1, index) => record({ ID: index + 1, StudentId: index + 100, 'รหัสคุมอง': '', 'ชื่อจริง': `ตัวอย่าง${index}`, Status1 }));
    const website = records.map((row, index) => site({ key: `new-${index}`, studentKey: `header:${index}`, kumonId: '', fullName: `${row['ชื่อจริง']} ทดสอบ`, status: { value: row.Status1 } }));
    const good = compareKsisWs(records, docs(website));
    assert.equal(good.counts.matched, 4); assert.equal(good.counts.missing_report, 0);
    assert.equal(new Set(good.rows.map((row) => row.key)).size, 4);
    assert.ok(good.rows.every((row) => row.matchMethod === 'name_birth_date'));
    const bad = compareKsisWs(records, docs(website.map((row, index) => index === 0 ? { ...row, used: { value: '0' } } : row)));
    assert.equal(bad.counts.mismatch, 1); assert.equal(bad.counts.matched, 3);
    const duplicate = compareKsisWs(records, docs([...website, { ...website[0], key: 'duplicate', studentKey: 'header:2' }]));
    assert.equal(duplicate.rows[0].outcome, 'review');
    assert.match(duplicate.rows[0].reason, /ซ้ำใน KSIS/);
});

test('Native audit allows only observed read POST endpoints, never arbitrary Get names or saves', () => {
    const url = 'https://kao.ksis.kumon.com/kth/api/reportb/GetReportBDetailEntryListPageByCriteria';
    assert.equal(isKsisAuditReadRequest('POST', url, 'xhr'), true);
    for (const value of [url + '?x=1', url.replace('GetReportBDetailEntryListPageByCriteria', 'SaveReportBDetailEntryEditItemBatch'), url.replace('GetReportBDetailEntryListPageByCriteria', 'GetOtherData'), url.replace('kao.ksis.kumon.com', 'evil.example')]) assert.equal(isKsisAuditReadRequest('POST', value, 'xhr'), false);
    assert.equal(isKsisAuditReadRequest('PUT', url, 'xhr'), false);
    assert.equal(isKsisAuditReadRequest('POST', url, 'document'), false);
});

test("WS audit independently compares level, packet endpoint, used and ST1 and does not mutate inputs", () => {
    const records = [record()]; const documents = docs([site()]); const before = JSON.stringify({ records, documents });
    const good = compareKsisWs(records, documents);
    assert.equal(good.counts.matched, 1);
    const bad = compareKsisWs(records, docs([site({ level: { value: "D" }, worksheet: { value: "81" }, used: { value: "9" }, status: { value: "N" } })]));
    assert.deepEqual(bad.rows[0].differences.map((row) => row.field), ["level", "worksheet", "used", "status"]);
    assert.equal(bad.counts.mismatch, 1);
    assert.equal(JSON.stringify({ records, documents }), before);
    assert.equal(compareKsisWs([record({ IsKc: true, WksUsed: 99 })], docs([site({ used: { value: "1" } })])).counts.matched, 1);
});

test("WS audit skips A/OT from either source without converting stored statuses and isolates ambiguous matches", () => {
    assert.equal(compareKsisWs([record({ Status1: "A" })], docs([site()])).counts.skipped, 1);
    assert.equal(compareKsisWs([record()], docs([site({ status: { value: "A" } })])).counts.skipped, 1);
    for (const [records, documents] of [[ [record()], docs([site({ birthDate: "02/01/2020" })]) ],
        [ [record(), record()], docs([site()]) ], [ [record()], docs([site(), site({ key: 'another' })]) ],
        [ [record({ CurrentLevel: "" })], docs([site()]) ], [ [record({ CurrentLevel: "C81" })], docs([site()]) ],
        [ [record({ "รหัสคุมอง": "123" })], docs([site()]) ]]) {
        const result = compareKsisWs(records, documents);
        assert.equal(result.counts.matched, 0); assert.ok(result.counts.review > 0);
    }
});

test('The same student in multiple subjects or repeated on adjacent pages is not a duplicate identity', () => {
    const records = ['ME', 'EFL'].map((Subject) => record({ Subject }));
    const me = site(); const efl = site({ key: 'efl', subject: 'EFL' });
    const documents = [{ page: 1, rows: [me, efl] }, { page: 2, rows: [{ ...me }, { ...efl }] }];
    const before = JSON.stringify({ records, documents });
    const result = compareKsisWs(records, documents, { scope: 'all' });
    assert.equal(result.counts.matched, 2); assert.equal(result.counts.review, 0);
    assert.equal(result.rows.length, 2); assert.equal(result.repeatedRows, 2);
    assert.equal(JSON.stringify({ records, documents }), before);
});

test('Blank subject placeholders do not shadow real enrollment data or inflate missing-report counts', () => {
    const blank = (extra = {}) => site({ level: { value: '' }, worksheet: { value: '' }, used: { value: '' }, status: { value: '' }, ...extra });
    const documents = [{ page: 1, rows: [blank(), blank({ subject: 'EFL', key: 'efl' })] }, { page: 2, rows: [site()] }];
    const result = compareKsisWs([record()], documents, { scope: 'all' });
    assert.equal(result.counts.matched, 1); assert.equal(result.counts.review, 0); assert.equal(result.counts.missing_report, 0);
    assert.equal(result.ignoredBlankRows, 2); assert.equal(result.rows[0].page, 2);
    assert.equal(compareKsisWs([record()], docs([blank()]), { scope: 'all' }).counts.missing_ksis, 1);
    // A zero value or a warning is evidence of data, not an empty placeholder.
    for (const row of [blank({ used: { value: '0' } }), blank({ validationError: 'ต้องตรวจ' })]) {
        const result = compareKsisWs([], docs([row]), { scope: 'all' });
        assert.equal(result.ignoredBlankRows, 0); assert.equal(result.counts.missing_report, 1);
    }
});

test('Different enrollment row IDs or conflicting data remain reviewable, even for the same student', () => {
    for (const other of [site({ key: 'different-enrollment' }), site({ used: { value: '9' } }), site({ birthDate: '02/01/2020' })]) {
        const result = compareKsisWs([record()], [{ page: 1, rows: [site()] }, { page: 2, rows: [other] }], { scope: 'all' });
        assert.equal(result.counts.matched, 0); assert.equal(result.counts.review, 1); assert.equal(result.repeatedRows, 0);
        assert.match(result.rows[0].reason, /หลายแถวที่มีข้อมูล/);
        assert.doesNotMatch(result.rows[0].reason, /รหัส.*ซ้ำ/);
    }
});

test('OT is skipped like A even without worksheet data, including KSIS-only rows, and inputs are unchanged', () => {
    const absent = record({ Status1: 'OT', CurrentLevel: '', WksUsed: 0 });
    const actual = site({ level: { value: 'D' }, worksheet: { value: '170' }, used: { value: '' }, status: { value: 'OT' } });
    const before = JSON.stringify({ absent, actual });
    for (const [records, documents] of [[[absent], docs([actual])], [[record()], docs([actual])], [[], docs([actual])]]) {
        const result = compareKsisWs(records, documents, { scope: 'all' });
        assert.equal(result.counts.skipped, 1); assert.equal(result.counts.review, 0); assert.equal(result.counts.mismatch, 0);
        assert.match(result.rows[0].reason, /A\/OT/);
    }
    assert.equal(JSON.stringify({ absent, actual }), before);
});

test("WS audit separates off-page, missing KSIS, missing Report and subjects without guessing matches by name", () => {
    const records = [record(), record({ Subject: "EFL" }), record({ "รหัสคุมอง": "7642650000002" })];
    const documents = docs([site(), site({ kumonId: "7642650000003", subject: "TRP" })]);
    const current = compareKsisWs(records, documents);
    assert.equal(current.counts.matched, 1); assert.equal(current.outsidePage, 2); assert.equal(current.counts.missing_report, 1);
    const all = compareKsisWs(records, documents, { scope: "all" });
    assert.equal(all.counts.missing_ksis, 2); assert.equal(all.outsidePage, 0);
    const me = compareKsisWs(records, documents, { subject: "ME", scope: "all" });
    assert.equal(me.counts.missing_report, 0); assert.equal(me.counts.missing_ksis, 1);
    assert.throws(() => compareKsisWs(records, documents, { subject: "bad" }), { statusCode: 400 });
});
