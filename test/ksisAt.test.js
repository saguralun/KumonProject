import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planKsisAt, isBlankKsisAt, sameKsisAt, selectConfirmedKsisAt, validateKsisAtPayload, validateKsisAtSave, applyKsisAt, previewKsisAt } from '../services/ksisAtEntry.js';

const period = { month: 10, year: 2026 };
const record = (override = {}) => ({ ID: 100, StudentId: 10, 'รหัสคุมอง': '7642650000001', 'ชื่อจริง': 'เด็ก', 'นามสกุล': 'ทดสอบ', 'วันเกิด': '01/01/2020', Subject: 'ME', Status1: 'C',
    TestType: 'AT', DateTest: '10/10/2569', LevelTest: 'C', Time: 70, MaxTime: 30, Score: 0, Group: 2, ...override });
const field = (value = '', options = []) => ({ value, writable: true, options: options.map((label) => ({ label, value: `string:${label}` })) });
const blank = (override = {}) => ({ key: 'guid-class-0', subject: 'ME', dirty: false, date: field(), level: field('', ['C', 'D', 'E']), time: field(), score: field(), group: field('', ['G1', 'G2']), passed: false, notes: '', error: '', ...override });
const document = (tests = [blank()]) => ({ context: 'ชื่อศูนย์ TEST ประจำเดือน Oct - 2026', subjectLabel: 'Math', page: 1, modalOpen: false, editable: true,
    students: [{ key: 'guid-class-0', studentKey: 'guid', kumonId: '7642650000001', fullName: 'เด็ก ทดสอบ', birthDate: '01/01/2020', subject: 'ME', tests }] });

test('AT plans only the selected subject and AT slots, preserves score zero and time above nominal max, always passed', () => {
    const records = [record({ TestType1: 'DT', LevelTest1: 'D', TestType2: 'AT', LevelTest2: 'E', DateTest2: '20/10/2026', Time2: 10, Score2: 88, Group2: 1 }), record({ ID: 101, Subject: 'EFL' })];
    const rows = planKsisAt(records, document(), period, 'ME');
    assert.equal(rows.length, 2); assert.deepEqual(rows.map((row) => row.outcome), ['ready', 'ready']);
    assert.deepEqual(rows[0].desired, { date: '2026-10-10', level: 'C', time: 70, score: 0, group: 2, passed: true });
    assert.equal(rows[1].desired.level, 'E');
});

test('AT recognizes exact existing results, blocks conflicting or duplicate same date/level, never overwrites', () => {
    const stored = blank({ date: field('10/10/2026'), level: field('C'), time: field('70'), score: field('0'), group: field('G2'), passed: true, notes: 'preserve notes' });
    assert.equal(sameKsisAt(stored, { date: '2026-10-10', level: 'C', time: 70, score: 0, group: 2, passed: true }), true);
    assert.equal(planKsisAt([record()], document([stored]), period, 'ME')[0].outcome, 'existing');
    assert.equal(planKsisAt([record({ Score: 80 })], document([stored]), period, 'ME')[0].outcome, 'review');
    assert.equal(planKsisAt([record()], document([stored, stored]), period, 'ME')[0].outcome, 'review');
    assert.equal(isBlankKsisAt(stored), false);
});

test('AT follows the same 21-to-20 reporting period as Report, including prior-month tests and year rollover', () => {
    for (const date of ['21/09/2026', '30/09/2026', '01/10/2026', '20/10/2026']) {
        assert.equal(planKsisAt([record({ DateTest: date })], document(), period, 'ME')[0].outcome, 'ready', date);
    }
    for (const date of ['20/09/2026', '21/10/2026']) {
        assert.equal(planKsisAt([record({ DateTest: date })], document(), period, 'ME')[0].outcome, 'review', date);
    }
    const january = { ...document(), context: 'ชื่อศูนย์ TEST ประจำเดือน Jan - 2027' };
    assert.equal(planKsisAt([record({ DateTest: '21/12/2026' })], january, { month: 1, year: 2027 }, 'ME')[0].outcome, 'ready');
    assert.equal(planKsisAt([record({ DateTest: '20/01/2027' })], january, { month: 1, year: 2027 }, 'ME')[0].outcome, 'ready');
    assert.equal(planKsisAt([record({ DateTest: '21/01/2027' })], january, { month: 1, year: 2027 }, 'ME')[0].outcome, 'review');
});

test('AT refuses wrong month, subject, dirty data, modal, locked report, invalid options and invalid report values', () => {
    for (const [key, value] of [['subjectLabel', 'English EFL'], ['context', 'ชื่อศูนย์ TEST ประจำเดือน Sep - 2026'], ['modalOpen', true], ['editable', false]]) {
        assert.throws(() => planKsisAt([record()], { ...document(), [key]: value }, period, 'ME'), { statusCode: 409 });
    }
    assert.throws(() => planKsisAt([record()], document([blank({ dirty: true })]), period, 'ME'), { statusCode: 409 });
    assert.throws(() => planKsisAt([record()], document(), period, 'ALL'), { statusCode: 400 });
    for (const override of [{ Time: '' }, { Time: 1000 }, { Score: -1 }, { Score: '' }, { Group: 0 }, { DateTest: '30/02/2026' }, { DateTest: '01/09/2026' }, { LevelTest: 'X' }]) {
        assert.equal(planKsisAt([record(override)], document(), period, 'ME')[0].outcome, 'review');
    }
});

test('AT handles multiple tests per pupil without a false duplicate identity, and requires confirmations for no-ID matches', () => {
    const multi = document([blank(), blank({ key: 'guid-class-1' }), blank({ key: 'guid-class-2' })]);
    assert.equal(planKsisAt([record()], multi, period, 'ME')[0].outcome, 'ready');
    const site = document(); site.students[0].kumonId = '';
    const rows = planKsisAt([record({ 'รหัสคุมอง': '', Status1: 'N' })], site, period, 'ME');
    assert.equal(rows[0].requiresIdentityConfirmation, true); assert.equal(rows[0].outcome, 'ready');
    assert.deepEqual(selectConfirmedKsisAt(rows), []);
    assert.equal(selectConfirmedKsisAt(rows, [rows[0].id]).length, 1);
    assert.throws(() => selectConfirmedKsisAt(rows, ['wrong']), { statusCode: 400 });
    assert.throws(() => selectConfirmedKsisAt(rows, [rows[0].id, rows[0].id]), { statusCode: 400 });
    site.students[0].birthDate = '02/01/2020';
    assert.equal(planKsisAt([record({ 'รหัสคุมอง': '', Status1: 'EO' })], site, period, 'ME')[0].outcome, 'review');
});

test('AT blocks duplicate source test events, partial existing rows, and mismatched DOB', () => {
    const row = record({ TestType1: 'AT', DateTest1: '10/10/2026', LevelTest1: 'C', Time1: 70, Score1: 0, Group1: 2 });
    assert.equal(planKsisAt([row], document(), period, 'ME').every((row) => row.outcome === 'review'), true);
    assert.equal(planKsisAt([record()], document([blank({ date: field('10/10/2026') })]), period, 'ME')[0].outcome, 'review');
    assert.equal(planKsisAt([record({ 'วันเกิด': '02/01/2020' })], document(), period, 'ME')[0].outcome, 'review');
});

test('AT writes are exactly one verified new AT row; HTTP 200 with conflict is not success', async () => {
    const expected = { key: 'guid-class-0', desired: { date: '2026-10-10', time: 70, score: 0 }, levelCode: 'C', groupCode: '2' };
    const payload = { studentGuid: 'guid', classId: 'class', testRowId: 0, testTypeCd: 'AT', testGuid: '', testDate: '10/10/2026', testCd: 'C', testTime: 70, testScore1: 0, atGroupCd: '2', testResultFlg: true, notes: '' };
    assert.equal(validateKsisAtPayload([payload], expected), true);
    for (const override of [{ testGuid: 'existing' }, { studentGuid: 'other' }, { testRowId: 1 }, { testDate: '01/09/2026' }, { testTypeCd: 'DT' }, { testTime: 30 }, { testScore1: 1 }, { testResultFlg: false }, { notes: 'unexpected' }]) assert.equal(validateKsisAtPayload([{ ...payload, ...override }], expected), false);
    assert.equal(validateKsisAtPayload([payload, payload], expected), false);
    const reply = { studentGuid: 'guid', classId: 'class', testRowId: 0, testGuid: 'saved-guid', lockVersion: 1, saveResult: 0, error: '', errorCodeType: 0 };
    assert.equal(validateKsisAtSave([reply], expected), true);
    for (const override of [{ saveResult: -1 }, { error: 'invalid' }, { errorCodeType: 1 }, { testGuid: '' }, { lockVersion: 0 }, { studentGuid: 'other' }]) assert.equal(validateKsisAtSave([{ ...reply, ...override }], expected), false);
    assert.equal(validateKsisAtSave({ success: true }, expected), false);
    await assert.rejects(applyKsisAt({ userId: 1, confirmSave: false }), { statusCode: 400 });
    await assert.rejects(applyKsisAt({ userId: 1, confirmSave: true, previewId: 'stale' }), { statusCode: 409 });
    await assert.rejects(previewKsisAt({ userId: 1, subject: 'ALL' }), { statusCode: 400 });
});
