import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { KSIS_AT_URL, readKsisAtInspection } from '../services/ksisAtEntry.js';

pool.query = () => assert.fail('Real DB forbidden'); pool.connect = () => assert.fail('Real DB forbidden');
const record = { ID: 100, 'รหัสคุมอง': '', 'ชื่อจริง': 'เด็ก', 'นามสกุล': 'จำลอง', 'วันเกิด': '01/01/2020', Subject: 'ME',
    TestType: 'AT', DateTest: '10/10/2026', LevelTest: 'C', Time: 5, Score: 80, Group: 1 };
const pupil = { key: 'class-1', studentKey: 'student-1', subject: 'ME', kumonId: '', fullName: 'เด็ก จำลอง', birthDate: '01/01/2020', tests: [] };
function page(students = [pupil]) {
    const document = { context: 'ชื่อศูนย์ TEST ประจำเดือน Oct - 2026', subjectLabel: 'Math', page: 2, modalOpen: false, hiddenDirty: false, students };
    return { url: () => KSIS_AT_URL, waitForFunction: async () => {}, evaluate: async () => structuredClone(document),
        route: async () => {}, unroute: async () => {}, locator: () => assert.fail('Never navigate/filter or save on page 2') };
}
const scope = { period: { month: 10, year: 2026 }, subject: 'ME', enrollmentId: 100 };
test('AT read-only inspection accepts an ID-less enrollment only after unique name/DOB/subject matching', async () => {
    const result = await readKsisAtInspection(page(), [record], scope);
    assert.equal(result.readOnly, true); assert.equal(result.refreshed, false);
    assert.equal(result.name, pupil.fullName); assert.equal(result.enrollmentId, 100);
    assert.equal(result.kumonId, ''); assert.equal(result.comparisons[0].persisted, false);
    for (const Status1 of ['N', 'EO', 'IT']) {
        const temporary = { ...record, Status1, 'รหัสคุมอง': '7642650000001' };
        const other = { ...temporary, ID: 101, 'ชื่อจริง': 'คนอื่น', 'วันเกิด': '02/01/2020' };
        const inspected = await readKsisAtInspection(page(), [temporary, other], scope);
        assert.equal(inspected.name, pupil.fullName, `${Status1}: a repeated temporary ID must not select a different record`);
        assert.equal(inspected.enrollmentId, 100);
    }
});
test('AT ID-less inspection rejects ambiguous, missing and conflicting identities rather than picking a child', async () => {
    for (const [records, pupils, request] of [
        [[record, { ...record, ID: 101 }], [pupil], scope],
        [[record], [pupil, { ...pupil, key: 'other-class', studentKey: 'other-student' }], scope],
        [[record], [{ ...pupil, birthDate: '02/01/2020' }], scope],
        [[record], [pupil], { ...scope, enrollmentId: 999 }],
        [[record], [pupil], { ...scope, subject: 'EFL' }]
    ]) await assert.rejects(readKsisAtInspection(page(pupils), records, request), { statusCode: 409 });
});
