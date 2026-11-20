import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) test(`Used N/EO date and special-status corrections survive save/reload without unlocking other initial fields (${embedded ? 'desktop' : 'browser'})`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000
}, async () => {
    const subjects = ['ME', 'EFL', 'TRP'].map((code, index) => ({ id: index + 1, code, name: code }));
    const student = { studentId: 1, displayName: 'แก้วันเริ่ม ทดสอบ', firstName: 'แก้วันเริ่ม', lastName: 'ทดสอบ', prefixId: 1 };
    const rows = subjects.map((s, index) => ({ enrollmentId: s.id * 10, subjectId: s.id, subjectCode: s.code,
        currentLevelMasterId: s.id, currentLevelCode: 'A', startingWorksheetMasterId: s.id * 10,
        enStartDate: '2026-11-01', canDeleteEnrollment: false, currentStatusGroup1Id: index + 1,
        statusGroup1Code: ['N', 'EO', 'C'][index], statusGroup1Name: ['New', 'Enrolling Other', 'Continue'][index], currentStatusGroup2Id: null }));
    const masters = { subjects, prefixes: [{ id: 1, name: 'ด.ช.' }], genders: [], grades: [], schedules: [], studentHints: {}, addressRows: [],
        statuses: [{ id: 1, code: 'N', group: 1 }, { id: 2, code: 'EO', group: 1 }, { id: 3, code: 'C', group: 1 },
            { id: 9, code: 'F', group: 2 }, { id: 11, code: 'H', group: 2 }, { id: 12, code: 'FS', group: 2 }, { id: 13, code: 'FSH', group: 2 },
            { id: 14, code: 'FRG', group: 2 }, { id: 15, code: 'FRGH', group: 2 }],
        levels: subjects.map(s => ({ id: s.id, subjectId: s.id, code: 'A', type: 1 })),
        worksheets: subjects.map(s => ({ id: s.id * 10, levelMasterId: s.id, worksheetNo: 1 })) };
    let rejectNext = true;
    const f = await controlFixture('student-manager', async (req, res) => {
        if (req.path === '/students/masters') res.json({ success: true, masters });
        else if (req.path === '/students/search') res.json({ success: true, rows: [student] });
        else if (req.path === '/students/1') res.json({ success: true, student, enrollments: rows });
        else if (req.method === 'PUT' && /^\/students\/1\/enrollments\/(10|20)$/.test(req.path)) {
            const id = Number(req.path.split('/').at(-1)), index = rows.findIndex(row => row.enrollmentId === id);
            for (const key of ['subjectId', 'startingWorksheetMasterId', 'currentStatusGroup1Id']) assert.equal(Number(req.body[key]), rows[index][key]);
            if (rejectNext) { rejectNext = false; res.status(409).json({ success: false, error: 'Fixture correction failed' }); return true; }
            rows[index] = { ...rows[index], ...req.body, enrollmentId: id };
            res.json({ success: true, enrollmentId: id, profile: { student, enrollments: rows } });
        } else return false;
        return true;
    }, { embedded });
    try {
        const { page } = f, form = page.locator('#enrollmentForm');
        await page.locator('[data-student-id="1"]').click();
        for (const id of [10, 20]) {
            await page.locator(`[data-enrollment-id="${id}"]`).click();
            await page.waitForFunction(id => document.querySelector('#enrollmentForm [name=enrollmentId]').value === String(id), id);
            for (const name of ['subjectId', 'startingWorksheetMasterId', 'currentStatusGroup1Id']) assert.equal(await form.locator(`[name=${name}]`).isDisabled(), true);
            assert.equal(await form.locator('[name=enStartDate]').isEnabled(), true);
            assert.equal(await form.locator('[name=currentStatusGroup2Id]').isEnabled(), true);
            assert.equal(await page.locator('#deleteEnrollmentButton').isVisible(), false);
            await form.locator('[name=currentStatusGroup2Id]').selectOption('15');
            assert.equal(await form.locator('[name=enStartDate]').inputValue(),'2026-11-11');
            await form.locator('[name=currentStatusGroup2Id]').selectOption('');
            await form.locator('[name=enStartDate]').fill('2026-11-15');
            assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '11');
            if (id === 10) {
                await page.locator('#saveEnrollmentButton').click();
                await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture correction failed'));
                assert.equal(await form.locator('[name=enStartDate]').inputValue(), '2026-11-15');
                assert.equal(await form.locator('[name=currentStatusGroup2Id]').isEnabled(), true);
            }
            await form.locator('[name=currentStatusGroup2Id]').selectOption('12');
            await form.locator('[name=enStartDate]').fill('2026-11-16');
            assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '13');
            await form.locator('[name=enStartDate]').fill('2026-11-21');
            assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '12');
            await form.locator('[name=currentStatusGroup2Id]').selectOption('11');
            assert.equal(await form.locator('[name=enStartDate]').inputValue(), '2026-11-11');
            await form.locator('[name=currentStatusGroup2Id]').selectOption('9');
            await form.locator('[name=enStartDate]').fill('2026-11-17');
            assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '9');
            await form.locator('[name=currentStatusGroup2Id]').selectOption('15');
            await form.locator('[name=enStartDate]').fill('2026-11-21');
            assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(),'14');
            await form.locator('[name=enStartDate]').fill('2026-11-15');
            assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(),'15');
            await form.locator('[name=currentStatusGroup2Id]').selectOption('9');
            await form.locator('[name=enStartDate]').fill('2026-11-17');
            await page.locator('#saveEnrollmentButton').click();
            await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('บันทึก enrollment แล้ว') && !document.getElementById('saveEnrollmentButton').disabled);
            await page.reload(); await page.locator('[data-student-id="1"]').click();
            await page.locator(`[data-enrollment-id="${id}"]`).click();
            assert.equal(await form.locator('[name=enStartDate]').inputValue(), '2026-11-17');
            assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '9');
        }
        await page.locator('[data-enrollment-id="30"]').click();
        assert.equal(await form.locator('[name=currentStatusGroup2Id]').isDisabled(), true);
        await page.locator('[data-enrollment-id="10"]').click();
        assert.equal(await form.locator('[name=currentStatusGroup2Id]').isEnabled(), true);
        rows[0].statusGroup1Code = 'C'; rows[0].currentStatusGroup1Id = 3;
        await page.reload(); await page.locator('[data-student-id="1"]').click();
        assert.equal(await form.locator('[name=currentStatusGroup2Id]').isDisabled(), true);
        assert.equal(f.writes().length, 3); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

for (const embedded of [false, true]) test(`Unused enrollments can be corrected, date status follows Start Date, using the existing schema through Add/Save/reload (${embedded ? 'desktop' : 'browser'})`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000
}, async () => {
    const subjects = ['ME', 'EFL', 'TRP'].map((code, index) => ({ id: index + 1, code, name: code }));
    const student = { studentId: 1, displayName: 'นักเรียน ทดสอบแก้ข้อมูล', firstName: 'นักเรียน', lastName: 'ทดสอบแก้ข้อมูล', prefixId: 1 };
    let rows = subjects.slice(0, 2).map(s => ({ enrollmentId: s.id * 10, subjectId: s.id, subjectCode: s.code, currentLevelMasterId: s.id,
        currentLevelCode: 'A', startingWorksheetMasterId: s.id * 10, enStartDate: '2026-11-01', canDeleteEnrollment: s.id === 1,
        currentStatusGroup1Id: s.id === 1 ? 1 : 3, statusGroup1Code: s.id === 1 ? 'N' : 'C', statusGroup1Name: 'Active', currentStatusGroup2Id: null }));
    const masters = { subjects, prefixes: [{ id: 1, name: 'ด.ช.' }], genders: [], grades: [],
        statuses: [{ id: 1, code: 'N', group: 1 }, { id: 2, code: 'EO', group: 1 }, { id: 3, code: 'C', group: 1 },
            { id: 9, code: 'F', group: 2 }, { id: 11, code: 'H', group: 2 }, { id: 12, code: 'FS', group: 2 }, { id: 13, code: 'FSH', group: 2 },
            { id: 14, code: 'FRG', group: 2 }, { id: 15, code: 'FRGH', group: 2 }],
        levels: [...subjects.map(s => ({ id: s.id, subjectId: s.id, code: 'A', type: 1 })), { id: 90, subjectId: 1, code: 'ZI', type: 2 }, { id: 91, subjectId: 1, code: 'ZII', type: 2 }],
        worksheets: subjects.map(s => ({ id: s.id * 10, levelMasterId: s.id, worksheetNo: 1 })),
        dtMasters: [{ id: 3, subjectId: 3, testLevel: 'A', maxScore: 100, maxTime: 30 }], dtResults: [{ dtMasterId: 3, worksheetMasterId: 30 }],
        schedules: [{ id: 1, weekdayCode: 'MON', weekdayName: 'Monday', startTime: '09:00', endTime: '09:30', isActive: true, label: 'Monday 09:00' }],
        studentHints: {}, addressRows: [] };
    let rejectSave = true;
    const f = await controlFixture('student-manager', async (req, res) => {
        if (req.path === '/students/masters') res.json({ success: true, masters });
        else if (req.path === '/students/search') res.json({ success: true, rows: [student] });
        else if (req.path === '/students/1') res.json({ success: true, student, enrollments: rows });
        else if (req.path === '/students/1/enrollments/10' && req.method === 'PUT') {
            assert.ok(['', '90', '91'].includes(req.body.currentZunLevelMasterId));
            if (rejectSave) { res.status(409).json({ success: false, error: 'Fixture save rejected' }); return true; }
            rows[0] = { ...rows[0], ...req.body, enrollmentId: 10, subjectCode: 'ME',
                currentZunLevelCode: masters.levels.find(level => String(level.id) === req.body.currentZunLevelMasterId)?.code || null };
            res.json({ success: true, profile: { student, enrollments: rows }, enrollmentId: 10 });
        } else if (req.path === '/students/1/enrollments' && req.method === 'POST') {
            assert.equal(req.body.currentZunLevelMasterId, '90');
            rows.push({ ...req.body, enrollmentId: 30, subjectId: 3, subjectCode: 'TRP', canDeleteEnrollment: true, statusGroup1Code: 'EO', currentZunLevelCode: 'ZI', currentLevelCode: 'A' });
            res.json({ success: true, profile: { student, enrollments: rows }, enrollmentId: 30 });
        } else return false;
        return true;
    }, { embedded });
    try {
        const { page } = f;
        await page.locator('[data-student-id="1"]').click();
        const form = page.locator('#enrollmentForm');
        await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '10');
        for (const name of ['subjectId', 'startingWorksheetMasterId', 'currentStatusGroup1Id', 'currentStatusGroup2Id', 'enStartDate']) {
            assert.equal(await form.locator(`[name=${name}]`).isEnabled(), true);
        }
        assert.deepEqual(await form.locator('[name=currentZunLevelMasterId] option').allTextContents(), ['No Zun', 'ZI', 'ZII']);
        await form.locator('[name=currentZunLevelMasterId]').selectOption('90');
        await form.locator('[name=enStartDate]').fill('2026-11-15');
        assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '11');
        await form.locator('[name=enStartDate]').fill('2026-11-21');
        assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '');
        await form.locator('[name=currentStatusGroup2Id]').selectOption('12');
        await form.locator('[name=enStartDate]').fill('2026-11-15');
        assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '13');
        await form.locator('[name=enStartDate]').fill('2026-11-21');
        assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '12');
        await form.locator('[name=currentStatusGroup2Id]').selectOption('9');
        await form.locator('[name=enStartDate]').fill('2026-11-15');
        assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '9');
        await page.locator('#saveEnrollmentButton').click();
        await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture save rejected'));
        assert.equal(await form.locator('[name=currentZunLevelMasterId]').inputValue(), '90');
        assert.equal(await form.locator('[name=enStartDate]').inputValue(), '2026-11-15');
        rejectSave = false;
        await page.locator('#saveEnrollmentButton').click();
        await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('บันทึก enrollment แล้ว'));
        await page.reload(); await page.locator('[data-student-id="1"]').click();
        await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=currentZunLevelMasterId]').value === '90');
        assert.equal(await form.locator('[name=currentZunLevelMasterId] option:checked').innerText(), 'ZI');
        await form.locator('[name=currentZunLevelMasterId]').selectOption('91');
        await page.locator('#saveEnrollmentButton').click();
        await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('บันทึก enrollment แล้ว') && !document.getElementById('saveEnrollmentButton').disabled);
        await page.reload(); await page.locator('[data-student-id="1"]').click();
        await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=currentZunLevelMasterId]').value === '91');
        assert.equal(await form.locator('[name=currentZunLevelMasterId] option:checked').innerText(), 'ZII');
        await form.locator('[name=currentZunLevelMasterId]').selectOption('');
        await page.locator('#saveEnrollmentButton').click();
        await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('บันทึก enrollment แล้ว') && !document.getElementById('saveEnrollmentButton').disabled);
        assert.equal(await form.locator('[name=currentZunLevelMasterId] option:checked').innerText(), 'No Zun');
        await page.locator('[data-enrollment-id="20"]').click();
        for (const name of ['subjectId', 'startingWorksheetMasterId', 'currentStatusGroup1Id', 'currentStatusGroup2Id']) {
            assert.equal(await form.locator(`[name=${name}]`).isDisabled(), true);
        }
        await page.locator('#newEnrollmentButton').click();
        const add = page.locator('#addEnrollmentForm');
        const startingDefault = await page.evaluate(() => {
            const date = new Date();
            return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-01`;
        });
        assert.equal(await add.locator('[name=enStartDate]').inputValue(), startingDefault);
        assert.equal(await add.locator('[name=dtDate]').inputValue(), startingDefault);
        assert.equal(await add.locator('[name=currentStatusGroup2Id]').inputValue(), '');
        await add.locator('[name=dtMasterId]').selectOption('3');
        await add.locator('[name=dtDate]').fill('2026-11-01');
        await add.locator('[name=enStartDate]').fill('2026-11-15');
        assert.equal(await add.locator('[name=currentStatusGroup2Id]').inputValue(),'11');
        await add.locator('[name=currentStatusGroup2Id]').selectOption('15');
        await add.locator('[name=score]').fill('90'); await add.locator('[name=usedTime]').fill('10');
        assert.deepEqual(await add.locator('[name=currentZunLevelMasterId] option').allTextContents(), ['No Zun', 'ZI', 'ZII']);
        await add.locator('[name=currentZunLevelMasterId]').selectOption('90');
        await add.locator('[name=openingDay1]').selectOption('MON'); await add.locator('[name=openingTime1]').selectOption('09:00');
        await page.locator('#addEnrollmentSave').click();
        await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '30');
        assert.equal(await form.locator('[name=currentZunLevelMasterId]').inputValue(), '90');
        assert.equal(await form.locator('[name=currentStatusGroup2Id]').inputValue(), '15');
        assert.equal(await form.locator('[name=enStartDate]').isEnabled(), true);
        assert.equal(f.writes().length, 5); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});
