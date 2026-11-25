import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) test(`Student and enrollment edits survive saving the other form, with explicit discard on selection (${embedded ? 'desktop' : 'browser'})`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 40000
}, async () => {
    const students = [1, 2].map(studentId => ({ studentId, displayName: `Fixture ${studentId}`, firstName: `First${studentId}`, lastName: 'Only', prefixId: 1 }));
    const subjects = [{ id: 1, code: 'ME', name: 'Math' }, { id: 2, code: 'EFL', name: 'English' }];
    const enrollments = subjects.map(s => ({ enrollmentId: s.id * 10, subjectId: s.id, subjectCode: s.code, currentLevelMasterId: s.id,
        currentLevelCode: 'A', startingWorksheetMasterId: s.id, enStartDate: '2026-11-01', canDeleteEnrollment: true,
        currentStatusGroup1Id: 1, statusGroup1Code: 'N', statusGroup1Name: 'New', remark: '' }));
    const masters = { subjects, prefixes: [{ id: 1, name: 'Mr' }], genders: [], grades: [], schedules: [], studentHints: {}, addressRows: [], dtMasters: [],
        statuses: [{ id: 1, code: 'N', group: 1, name: 'New' }, { id: 11, code: 'H', group: 2, name: 'Half month' }],
        levels: [...subjects.map(s => ({ id: s.id, subjectId: s.id, code: 'A', type: 1 })), { id: 3, subjectId: 1, code: 'B', type: 1 }],
        worksheets: [...subjects.map(s => ({ id: s.id, levelMasterId: s.id, worksheetNo: 1 })), { id: 31, levelMasterId: 3, worksheetNo: 1 }] };
    const f = await controlFixture('student-manager', async (req, res) => {
        if (req.path.endsWith('/masters')) res.json({ masters });
        else if (req.path.endsWith('/search')) res.json({ rows: students });
        else if (/^\/students\/[12]$/.test(req.path)) {
            const student = students[Number(req.path.split('/').at(-1)) - 1];
            if (req.method === 'PUT') Object.assign(student, req.body);
            res.json({ student, enrollments: student.studentId === 1 ? enrollments : [] });
        } else if (req.method === 'PUT' && req.path.includes('/enrollments/')) {
            const id = Number(req.path.split('/').at(-1)); Object.assign(enrollments.find(e => e.enrollmentId === id), req.body, { enrollmentId: id });
            res.json({ enrollmentId: id, profile: { student: students[0], enrollments } });
        } else return false;
        return true;
    }, { embedded });
    try {
        const { page } = f;
        await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '10' && !document.getElementById('saveStudentButton').disabled);
        const firstName = page.locator('#studentForm [name=firstName]'), remark = page.locator('#enrollmentForm [name=remark]');
        await page.locator('#enrollmentForm details summary').click();
        await firstName.fill('Unsaved student'); await remark.fill('Saved enrollment');
        await page.locator('#saveEnrollmentButton').click();
        await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'บันทึก enrollment แล้ว');
        assert.equal(await firstName.inputValue(), 'Unsaved student', 'Saving Enrollment must not discard Student edits');
        assert.equal(students[0].firstName, 'First1', 'The other form must not be auto-saved');
        await remark.fill('Unsaved enrollment');
        await page.locator('#enrollmentForm [name=currentLevelMasterId]').selectOption('3');
        await page.locator('#enrollmentForm [name=startingWorksheetMasterId]').selectOption('31');
        await page.locator('#enrollmentForm [name=enStartDate]').fill('2026-11-14');
        await page.locator('#enrollmentForm [name=isKumonConnect]').check();
        await page.locator('#saveStudentButton').click();
        await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'บันทึก student แล้ว');
        assert.equal(await remark.inputValue(), 'Unsaved enrollment', 'Saving Student must not discard Enrollment edits');
        assert.equal(await page.locator('#enrollmentForm [name=currentLevelMasterId]').inputValue(), '3');
        assert.equal(await page.locator('#enrollmentForm [name=startingWorksheetMasterId]').inputValue(), '31');
        assert.equal(await page.locator('#enrollmentForm [name=enStartDate]').inputValue(), '2026-11-14');
        assert.equal(await page.locator('#enrollmentForm [name=currentStatusGroup2Id]').inputValue(), '11');
        assert.equal(await page.locator('#enrollmentForm [name=isKumonConnect]').isChecked(), true);
        assert.equal(Number(enrollments[0].currentLevelMasterId), 1, 'Other-form save must not write draft enrollment fields');
        await page.locator('[data-enrollment-id="20"]').click(); await f.choose(false);
        assert.equal(await remark.inputValue(), 'Unsaved enrollment');
        await page.locator('[data-enrollment-id="10"]').click();
        assert.equal(await page.locator('#appActionDialog').count(), 0, 'Same subject keeps edits without prompting');
        await page.locator('[data-student-id="2"]').click(); await f.choose(false);
        assert.equal(await remark.inputValue(), 'Unsaved enrollment');
        await page.locator('[data-enrollment-id="20"]').click(); await f.choose(true);
        await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '20');
        assert.equal(await remark.inputValue(), '');
        assert.equal(f.writes().length, 2); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});
