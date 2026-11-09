import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) test(`Student directory status and subject panels remain read-only while switching filters/subjects (${embedded ? 'desktop' : 'browser'})`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000
}, async () => {
    const subjects = ['ME', 'EFL', 'TRP'].map((code, index) => ({ id: index + 1, code, name: code }));
    const enrollments = subjects.map(s => ({ enrollmentId: s.id * 10, subjectId: s.id, subjectCode: s.code,
        currentLevelMasterId: s.id, currentLevelCode: 'A', enStartDate: '2020-01-01',
        currentStatusGroup1Id: s.id === 2 ? 2 : 1, statusGroup1Code: s.id === 2 ? 'A' : 'C', statusGroup1Name: s.id === 2 ? 'Absent' : 'Continue' }));
    const student = { studentId: 1, displayName: 'นักเรียน ตัวอย่าง (น้องทดสอบ)', firstName: 'นักเรียน', lastName: 'ตัวอย่าง', prefixId: 1,
        enrollments: enrollments.map(e => ({ ...e, statusCode: e.statusGroup1Code, absenceSinceMonth: e.subjectCode === 'EFL' ? 9 : null, absenceSinceYear: e.subjectCode === 'EFL' ? 2025 : null })) };
    const masters = { subjects, prefixes: [{ id: 1, name: 'ด.ช.' }], genders: [], grades: [],
        statuses: [{ id: 1, group: 1, code: 'C', name: 'Continue' }, { id: 2, group: 1, code: 'A', name: 'Absent' }],
        levels: subjects.map(s => ({ id: s.id, subjectId: s.id, code: 'A', type: 1 })), worksheets: [], schedules: [], dtMasters: [], studentHints: {}, addressRows: [] };
    const f = await controlFixture('student-manager', async (req, res) => {
        if (req.path === '/students/masters') res.json({ success: true, masters });
        else if (req.path === '/students/search') res.json({ success: true, rows: [student, { studentId: 2, displayName: '<script>Bad name</script>', enrollments: [{ subjectCode: 'ME', statusCode: 'A' }] }, { studentId: 3, displayName: 'ยังไม่มีวิชา', enrollments: [] }] });
        else if (req.path === '/students/1') res.json({ success: true, student, enrollments });
        else return false;
        return true;
    }, { embedded });
    try {
        const { page } = f;
        await page.locator('[data-student-id="1"]').click();
        await page.waitForFunction(() => document.querySelector('.enrollment-panel').dataset.subject === 'ME');
        const badges = page.locator('[data-student-id="1"] .directory-status');
        assert.equal(await badges.count(), 3);
        assert.match((await badges.allTextContents()).join(' '), /ME · C.*EFL · A.*TRP · C/);
        assert.equal(await page.locator('[data-student-id="2"] .student-item-name').innerText(), '<script>Bad name</script>');
        assert.match(await page.locator('[data-student-id="2"] .directory-status').innerText(), /ไม่ทราบงวดที่ออก/);
        assert.match(await page.locator('[data-student-id="3"]').innerText(), /ยังไม่มีวิชา/);
        assert.equal(await page.locator('[data-student-id="1"]').getAttribute('data-directory-tone'), 'mixed');
        assert.equal(await page.locator('[data-student-id="2"]').getAttribute('data-directory-tone'), 'inactive');
        // Use a friendly sample name in the visual mock after the escaping assertion.
        await page.locator('[data-student-id="2"] .student-item-name').evaluate(el => { el.textContent = 'นักเรียน ตัวอย่าง (น้องสอง)'; });
        for (const [width, height] of [[1600, 1000], [1024, 768], [390, 844]]) {
            await page.setViewportSize({ width, height });
            for (const [code, tint] of [['ME', 'rgb(234, 249, 255)'], ['EFL', 'rgb(255, 247, 237)'], ['TRP', 'rgb(236, 253, 245)']]) {
                await page.locator(`#enrollmentTabs [data-subject="${code}"]`).click();
                await page.waitForFunction(subject => document.querySelector('.enrollment-panel').dataset.subject === subject, code);
                const panel = page.locator('.enrollment-panel');
                assert.equal(await panel.evaluate(el => getComputedStyle(el).backgroundColor), tint);
                assert.equal(await page.locator('#enrollmentForm [name=subjectId]').inputValue(), String(subjects.find(s => s.code === code).id));
                assert.equal(await page.locator('#enrollmentAbsentButton').isDisabled(), code === 'EFL');
                assert.equal(await page.locator('#enrollmentResumeButton').isDisabled(), code !== 'EFL');
                const active = page.locator('#enrollmentTabs .active');
                assert.equal(await active.getAttribute('aria-pressed'), 'true');
                assert.equal(await active.locator('.enrollment-status').innerText(), code === 'EFL' ? 'A' : 'C');
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            }
            await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-student-cues-${embedded ? 'desktop' : 'browser'}-${width}.png`), fullPage: true });
        }
        await page.setViewportSize({ width: 1600, height: 1000 });
        for (const filter of ['absent', 'active', 'kc', 'new', 'all']) {
            const response = page.waitForResponse(r => r.url().includes(`/api/students/search?`) && new URL(r.url()).searchParams.get('status') === filter);
            await page.locator('#statusFilter').selectOption(filter); await response;
            assert.equal(await page.locator('.enrollment-panel').getAttribute('data-subject'), 'TRP');
        }
        assert.deepEqual(f.writes(), []); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});
