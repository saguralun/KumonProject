import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareKsisAt, isKsisAtAuditReadRequest } from '../services/ksisAtAudit.js';

const options = { month: 10, year: 2026, subject: 'EFL', scope: 'all' };
const record = (changes = {}) => ({ ID: 1, StudentId: 10, Subject: 'EFL', 'รหัสคุมอง': '7642650255596',
    'ชื่อจริง': 'เด็ก', 'นามสกุล': 'ทดสอบ', 'วันเกิด': '01/01/2019', Status1: 'C',
    TestType: 'AT', DateTest: '15/10/2026', LevelTest: '7A', Time: 4, Score: 96, Group: 1, ...changes });
const field = (value) => ({ value: String(value), code: '' });
const result = (changes = {}) => ({ key: 'test1', date: field('15/10/2026'), level: field('7A'), time: field(4), score: field(96),
    group: { value: 'G1', code: '1' }, passed: true, dirty: false, error: '', notes: '', ...changes });
const student = (changes = {}) => ({ studentKey: 'student1', kumonId: '7642650255596', fullName: 'เด็ก ทดสอบ', birthDate: '01/01/2019',
    subject: 'EFL', tests: [result()], ...changes });
const doc = (students = [student()], page = 1) => ({ page, students });

test('AT audit compares all six fields, handles three report slots, counts blanks and prior-period tests separately', () => {
    const records = [record({ TestType1: 'AT', DateTest1: '21/09/2026', LevelTest1: '6A', Time1: 3, Score1: 100, Group1: 1,
        TestType2: 'AT', DateTest2: '20/10/2026', LevelTest2: '5A', Time2: 5, Score2: 99, Group2: 2 })];
    const tests = [result(), result({ key: 'test2', date: field('21/09/2026'), level: field('6A'), time: field(3), score: field(100) }),
        result({ key: 'test3', date: field('20/10/2026'), level: field('5A'), time: field(5), score: field(99), group: { value: 'G2', code: '2' } }),
        result({ key: 'old', date: field('20/09/2026') }), result({ key: 'later', date: field('21/10/2026') }),
        result({ key: 'blank', date: field(''), level: field(''), time: field(''), score: field(''), group: field(''), passed: false })];
    const audit = compareKsisAt(records, [doc([student({ tests })])], options);
    assert.equal(audit.counts.matched, 3); assert.equal(audit.rows.length, 3); assert.equal(audit.ignoredBlankRows, 1); assert.equal(audit.outsidePeriod, 2);
    assert.equal(audit.range.start, '2026-09-21'); assert.equal(audit.range.end, '2026-10-21');
    for (const [fieldName, value] of [['time', field(8)], ['score', field(80)], ['group', { value: 'G2', code: '2' }], ['passed', false]]) {
        const audit = compareKsisAt([record()], [doc([student({ tests: [result({ [fieldName]: value })] })])], options);
        assert.equal(audit.counts.mismatch, 1); assert.equal(audit.rows[0].differences[0].field, fieldName);
    }
});

test('AT audit distinguishes missing events, extras, DOB conflicts and duplicate test rows without conflating subjects', () => {
    const missing = compareKsisAt([record()], [doc([student({ tests: [] })])], options);
    assert.equal(missing.counts.missing_ksis, 1);
    const differentDate = compareKsisAt([record()], [doc([student({ tests: [result({ date: field('16/10/2026') })] })])], options);
    assert.equal(differentDate.counts.missing_ksis, 1); assert.equal(differentDate.counts.missing_report, 1);
    const dob = compareKsisAt([record()], [doc([student({ birthDate: '02/01/2019' })])], options);
    assert.equal(dob.counts.review, 1); assert.equal(dob.counts.matched, 0);
    const duplicate = compareKsisAt([record()], [doc([student({ tests: [result(), result({ key: 'test2' })] })])], options);
    assert.equal(duplicate.counts.review, 1); assert.match(duplicate.rows[0].reason, /หลายแถว/);
    const docs = [doc(), doc([student({ tests: [result()] })], 2)];
    const dedup = compareKsisAt([record(), record({ ID: 2, Subject: 'ME' })], docs, options);
    assert.equal(dedup.counts.matched, 1); assert.equal(dedup.rows.length, 1);
    const dirty = compareKsisAt([record()], [doc([student({ tests: [result({ dirty: true })] })])], options);
    assert.equal(dirty.counts.review, 1);
});

test('AT audit supports read-only no-ID identity matches and flags ambiguity and invalid Report values', () => {
    const local = record({ 'รหัสคุมอง': '', Status1: 'N' }), site = student({ kumonId: '' });
    const audit = compareKsisAt([local], [doc([site])], options);
    assert.equal(audit.counts.matched, 1); assert.equal(audit.rows[0].matchMethod, 'name_birth_date');
    assert.equal(compareKsisAt([local], [doc([site, { ...site, studentKey: 'other' }])], options).counts.review, 1);
    assert.equal(compareKsisAt([record({ Score: '' })], [doc()], options).counts.review, 1);
    assert.equal(compareKsisAt([record({ DateTest: '20/09/2026' })], [doc()], options).counts.review, 1);
    const outside = compareKsisAt([record()], [doc([])], { ...options, scope: 'current' });
    assert.equal(outside.outsidePage, 1); assert.equal(outside.rows.length, 0);
    assert.equal(compareKsisAt([record()], [doc([])], options).counts.missing_ksis, 1);
});

test('AT audit allowlist accepts only observed read POSTs and never a save or arbitrary POST', () => {
    const root = 'https://kao.ksis.kumon.com/kth/api/reportb/';
    assert.equal(isKsisAtAuditReadRequest('POST', `${root}GetReportBTestResultEntryListPageByCriteria`, 'xhr'), true);
    assert.equal(isKsisAtAuditReadRequest('POST', `${root}GetReportBTestResultErrorCount`, 'fetch'), true);
    for (const [method, url, type] of [['POST', `${root}SaveReportBTestResultEntryEditItemBatch`, 'xhr'], ['POST', `${root}Other`, 'xhr'],
        ['POST', `${root}GetReportBTestResultEntryListPageByCriteria`, 'document'], ['DELETE', `${root}Other`, 'fetch']]) assert.equal(isKsisAtAuditReadRequest(method, url, type), false);
    assert.throws(() => compareKsisAt([], [], { ...options, subject: 'ALL' }), { statusCode: 400 });
});
