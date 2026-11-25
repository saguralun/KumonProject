import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000 };
async function fixture(embedded) {
  const subjects = ['ME', 'EFL', 'TRP'].map((code, i) => ({ id: i + 1, code, name: code }));
  const statuses = [{ id: 1, code: 'N', group: 1, name: 'New' }, { id: 2, code: 'EO', group: 1, name: 'Enrolling Other' },
    ...['F', 'P', 'H', 'FS', 'FSH', 'FRG', 'FRGH'].map((code, i) => ({ id: i + 10, code, group: 2, name: code }))];
  const enrollment = { enrollmentId: 90, subjectId: 1, subjectCode: 'ME', currentLevelMasterId: 1, currentLevelCode: 'A', startingWorksheetMasterId: 1,
    enStartDate: '2026-11-21', currentStatusGroup1Id: 1, statusGroup1Code: 'N', statusGroup1Name: 'New', statusCode: 'N', canDeleteEnrollment: true };
  const students = [{ studentId: 512, displayName: 'First child', firstName: 'First', lastName: 'child', prefixId: 1, matchedEnrollmentId: 90, enrollments: [enrollment] },
    { studentId: 90, displayName: 'Second child', firstName: 'Second', lastName: 'child', prefixId: 1, enrollments: [{ ...enrollment, enrollmentId: 730 }] },
    { studentId: 904, displayName: 'Prefix child', enrollments: [{ ...enrollment, enrollmentId: 915 }] },
    { studentId: 8, displayName: 'Phone match child', mobile: '0901234567', enrollments: [] }];
  const masters = { subjects, statuses, prefixes: [{ id: 1, name: 'ด.ช.' }], genders: [], grades: [], schedules: [], studentHints: {}, addressRows: [], dtMasters: [],
    levels: subjects.map(s => ({ id: s.id, subjectId: s.id, code: 'A', type: 1 })), worksheets: subjects.map(s => ({ id: s.id, levelMasterId: s.id, worksheetNo: 1 })) };
  return controlFixture('student-manager', async (req, res) => {
    if (req.path === '/students/masters') res.json({ masters });
    else if (req.path === '/students/search') res.json({ rows: students.map(student => ({ ...student, matchedEnrollmentId: req.query.query === '90' && student.studentId === 512 ? 90 : null })) });
    else if (/^\/students\/(512|90)$/.test(req.path)) {
      const student = students.find(s => s.studentId === Number(req.path.split('/').at(-1)));
      if (req.method === 'PUT') Object.assign(student, req.body);
      res.json({ student, enrollments: student.enrollments });
    } else return false;
    return true;
  }, { embedded });
}

for (const embedded of [false, true]) test(`Student results distinguish Student ID, subject Enrollment ID and exact versus prefix matches (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
  const f = await fixture(embedded);
  try {
    const { page } = f;
    const result = page.waitForResponse(r => r.url().includes('/students/search?query=90&'));
    await page.locator('#studentSearch').fill('90'); await result;
    await page.waitForFunction(() => document.querySelector('[data-student-id="512"] .student-item-match'));
    const first = page.locator('[data-student-id="512"]');
    assert.match(await first.innerText(), /Student ID #512/);
    assert.match(await first.innerText(), /ME.*Enrollment #90/);
    assert.match(await first.locator('.student-item-match').innerText(), /ตรงกับ Enrollment/);
    assert.match(await page.locator('[data-student-id="90"] .student-item-match').innerText(), /ตรงกับ Student ID/);
    assert.match(await page.locator('[data-student-id="904"] .student-item-match').innerText(), /ขึ้นต้นด้วย 90/);
    assert.equal(await page.locator('[data-student-id="8"] .student-item-match').count(), 0);
    if (embedded) await page.screenshot({ path: 'logs/four-point-student-ids.png', fullPage: true });
    await first.click();
    await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '90');
    assert.equal(await page.locator('.directory-status').first().isVisible(), true);
    const named = page.waitForResponse(r => r.url().includes('/students/search?query=First&'));
    await page.locator('#studentSearch').fill('First'); await named;
    await page.waitForFunction(() => !document.querySelector('.student-item-match'));
    assert.deepEqual(f.writes(), []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const embedded of [false, true]) test(`Half Month notice survives saving Student and clears when changing owner or reopening Add Subject (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
  const f = await fixture(embedded);
  try {
    const { page } = f;
    await page.locator('[data-student-id="512"]').click();
    await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '90');
    const form = page.locator('#enrollmentForm');
    await form.locator('[name=currentStatusGroup2Id]').selectOption('16');
    assert.equal(await form.locator('[data-half-month-note]').isVisible(), true);
    await page.locator('#studentForm [name=firstName]').fill('Changed fixture');
    await page.locator('#saveStudentButton').click();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'บันทึก student แล้ว');
    assert.equal(await form.locator('[name=enStartDate]').inputValue(), '2026-11-11');
    assert.match(await form.locator('[data-half-month-note]').innerText(), /21\/11\/2569.*11\/11\/2569/s);
    await page.locator('[data-student-id="90"]').click(); await f.choose(false);
    await page.waitForFunction(() => !document.getElementById('appActionDialog'));
    assert.equal(await form.locator('[data-half-month-note]').isVisible(), true);
    await page.locator('[data-student-id="90"]').click(); await f.choose(true);
    await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '730');
    assert.equal(await form.locator('[data-half-month-note]').isVisible(), false);
    await page.locator('#newEnrollmentButton').click();
    const add = page.locator('#addEnrollmentForm');
    await add.locator('[name=enStartDate]').fill('2026-11-21');
    await add.locator('[name=currentStatusGroup2Id]').selectOption('16');
    assert.equal(await add.locator('[data-half-month-note]').isVisible(), true);
    await add.locator('[name=subjectId]').selectOption('3');
    assert.equal(await add.locator('[data-half-month-note]').isVisible(), false);
    await add.locator('[name=enStartDate]').fill('2026-11-21');
    await add.locator('[name=currentStatusGroup2Id]').selectOption('16');
    await page.locator('#addEnrollmentCancel').click();
    assert.equal(await page.locator('#appActionDialog').count(), 0, 'Keep the existing explicit Cancel behavior without adding a confirmation');
    await page.locator('#newEnrollmentButton').click();
    assert.equal(await add.locator('[data-half-month-note]').isVisible(), false);
    assert.equal(f.writes().length, 1); assert.equal(f.writes()[0].path, '/students/512');
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const embedded of [false, true]) test(`Half Month explains existing automatic alignment in both forms, clears stale notices and never saves implicitly (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
  const f = await fixture(embedded);
  try {
    const { page } = f;
    await page.locator('[data-student-id="512"]').click();
    await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '90');
    for (const formId of ['enrollmentForm', 'addEnrollmentForm']) {
      if (formId === 'addEnrollmentForm') await page.locator('#newEnrollmentButton').click();
      const form = page.locator(`#${formId}`), date = form.locator('[name=enStartDate]'), status = form.locator('[name=currentStatusGroup2Id]');
      for (const [code, id] of [['H', '12'], ['FSH', '14'], ['FRGH', '16']]) {
        await status.selectOption(''); await date.fill('2026-11-21'); await status.selectOption(id);
        assert.equal(await date.inputValue(), '2026-11-11');
        const notice = form.locator('[data-half-month-note]');
        assert.match(await notice.innerText(), /21\/11\/2569.*11\/11\/2569/s);
        assert.ok((await notice.innerText()).includes(code));
        assert.match(await notice.innerText(), /11–20/);
        if (embedded && code === 'FRGH') await page.screenshot({ path: `logs/four-point-half-${formId}.png`, fullPage: true });
        await date.fill('2026-11-15');
        assert.equal(await notice.isVisible(), false);
        await status.selectOption(id); assert.equal(await date.inputValue(), '2026-11-15');
        assert.equal(await notice.isVisible(), false);
      }
      for (const id of ['10', '11']) {
        await status.selectOption(id); await date.fill('2026-11-21');
        assert.equal(await date.inputValue(), '2026-11-21');
        assert.equal(await status.inputValue(), id);
        assert.equal(await form.locator('[data-half-month-note]').isVisible(), false);
      }
    }
    assert.deepEqual(f.writes(), []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
