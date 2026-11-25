import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000 };
const row = { worksheetUsedId: 10, enrollmentId: 1, worksheetMasterId: 101, actualWorksheetNo: 101,
  worksheetDate: '2026-11-20', levelMasterId: 1, levelCode: 'A', worksheetType: 'WS', packetWorksheetNo: 101,
  worksheetLabel: 'A101', cpws: true, isStockProcessed: false };
const summary = { billingMonth: 11, billingYear: 2026, usedDays: 1, cpwsRecords: 1 };
function context(entry) {
  return { enrollment: { enrollmentId: 1, subjectCode: 'ME', studentName: 'Date fixture', currentLevelMasterId: 1, currentLevelCode: 'A' },
    studentEnrollments: [], defaults: { receiveDate: '2026-11-20', patternCode: 'daily10', mainWorksheetNo: 101 },
    patterns: [{ code: 'daily10', shortLabel: '10/day', manualCount: 1, suffixes: [1], dayOffsets: [0] }],
    worksheetOptions: { main: [{ worksheetNo: 101 }], zun: [] }, history: [entry, { ...entry, worksheetUsedId: 11, isStockProcessed: true }], worksheetMonthSummary: summary };
}

for (const embedded of [false, true]) test(`Progress separates missing data from behind pace and keeps filter totals honest (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
  const student = { enrollmentId: 1, studentId: 1, name: 'On pace', gradeClass: 'ป.1', levelCode: 'A', levelPosition: 1.5, percent: 50, gradeSyncStatus: { code: 'KSIS', gapMonths: 1 } };
  const f = await controlFixture('progress-chart', async (req, res) => {
    if (req.path !== '/progress-chart') return false;
    res.json({ subjectCode: req.query.subject, grades: ['ป.1', 'ป.2'], levels: ['6A', 'A'], referenceLines: [],
      students: [student, { ...student, enrollmentId: 2, name: 'Behind pace', gradeSyncStatus: null },
        { ...student, enrollmentId: 3, name: 'No grade', gradeClass: null, gradeSyncStatus: null },
        { ...student, enrollmentId: 4, name: 'No reference', gradeClass: 'มหาวิทยาลัย', gradeSyncStatus: null }],
      unplottedStudents: [{ ...student, enrollmentId: 5, name: 'No level', levelCode: 'UNKNOWN', gradeClass: 'ป.2', gradeSyncStatus: null }] }); return true;
  }, { embedded });
  try {
    const { page } = f;
    await page.locator('.student-dot').first().waitFor();
    assert.equal(await page.locator('.student-dot').count(), 2);
    assert.equal(await page.locator('#summaryCards .summary-card').nth(1).locator('strong').innerText(), '5');
    assert.match(await page.locator('#assessmentSummary').innerText(), /ประเมินได้ 2.*5/);
    await page.locator('#unassessedStudents summary').click();
    const details = await page.locator('#unassessedStudents').innerText();
    for (const text of ['No grade', 'No reference', 'No level', 'ยังไม่มีชั้นเรียน', 'ไม่มีเกณฑ์เทียบ', 'ไม่มีเลเวลนี้']) assert.ok(details.includes(text), text);
    assert.match(await page.locator('#assessmentSummary').innerText(), /ยังไม่ทันชั้นเรียน.*1/s);
    await page.locator('#gradeFilter [data-grade="ป.1"]').click();
    assert.match(await page.locator('#assessmentSummary').innerText(), /ประเมินได้ 0.*1/);
    assert.equal(await page.locator('.student-dot').count(), 0);
    await page.locator('#gradeFilterNone').click();
    assert.match(await page.locator('#assessmentSummary').innerText(), /ประเมินได้ 0.*0/);
    await page.locator('#gradeFilterAll').click();
    assert.equal(await page.locator('.student-dot').count(), 2);
    for (const width of [1366, 1024]) {
      await page.setViewportSize({ width, height: 768 });
      assert.ok(await page.locator('#assessmentSummary').isVisible());
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (embedded) await page.screenshot({ path: `logs/four-point-progress-${width}.png`, fullPage: true });
    }
    assert.deepEqual(f.writes(), []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const embedded of [false, true]) test(`WS date drafts survive Tab and redraw, support explicit save, cancel and retry (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
  let entry = { ...row }, fail = true;
  const f = await controlFixture('worksheet', async (req, res) => {
    if (req.path.endsWith('/context')) res.json(context(entry));
    else if (req.path.endsWith('/worksheet-summary')) res.json({ worksheetMonthSummary: summary });
    else if (req.path.endsWith('/history')) res.json({ history: context(entry).history, worksheetMonthSummary: summary });
    else if (req.path === '/worksheet/entries/10/date') {
      assert.equal(req.method, 'PATCH'); assert.deepEqual(req.body, { enrollmentId: 1, worksheetDate: '2026-11-19' });
      if (fail) res.status(503).json({ error: 'Synthetic date failure' });
      else { entry = { ...entry, worksheetDate: req.body.worksheetDate }; res.json({ entry }); }
    } else return false;
    return true;
  }, { embedded });
  try {
    const { page } = f;
    await page.evaluate(async () => (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(1));
    const input = page.locator('[data-edit-history-date-id="10"]');
    await page.waitForFunction(() => document.activeElement?.matches('[data-ws-input]'));
    assert.equal(await page.locator('[data-edit-history-date-id="11"]').count(), 0);
    await input.fill('2026-11-19'); await input.press('Tab'); await input.evaluate(el => el.blur());
    assert.equal(await input.inputValue(), '2026-11-19');
    assert.match(await input.locator('xpath=..').innerText(), /ยังไม่บันทึก.*20\/11\/2569/s);
    const redraw = page.waitForResponse(r => r.url().includes('/history?'));
    await page.locator('#historyLimit').selectOption('100'); await redraw;
    assert.equal(await input.inputValue(), '2026-11-19');
    await page.locator('[data-save-history-date-id="10"]').click();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Synthetic date failure'));
    assert.equal(await input.inputValue(), '2026-11-19');
    fail = false; await input.press('Enter');
    await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'แก้วันที่แล้ว');
    assert.equal(await page.locator('[data-save-history-date-id="10"]').isVisible(), false);
    await input.fill('2026-11-18'); await input.press('Escape');
    assert.equal(await input.inputValue(), '2026-11-19');
    await input.fill('2026-11-18'); await page.locator('[data-cancel-history-date-id="10"]').click();
    assert.equal(await input.inputValue(), '2026-11-19');
    await input.fill(''); await page.locator('[data-save-history-date-id="10"]').click();
    assert.equal(await input.evaluate(el => el.validity.valueMissing), true);
    assert.equal(f.writes().length, 2);
    await input.press('Escape');
    for (const width of [1366, 1024]) {
      await page.setViewportSize({ width, height: 768 });
      await input.fill('2026-11-18'); await input.evaluate(el => el.blur());
      const save = page.locator('[data-save-history-date-id="10"]');
      await save.scrollIntoViewIfNeeded(); assert.equal(await save.isVisible(), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (embedded) await page.screenshot({ path: `logs/four-point-ws-date-${width}.png`, fullPage: true });
      await page.locator('[data-cancel-history-date-id="10"]').click();
    }
    assert.equal(f.writes().length, 2); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

for (const embedded of [false, true]) test(`WS date drafts guard selection and survive failed context loads without writing (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
  let rejectContext = true;
  const f = await controlFixture('worksheet', async (req, res) => {
    if (req.path.endsWith('/context')) {
      const id = Number(req.path.split('/')[3]);
      if (id === 2 && rejectContext) { res.status(503).json({ error: 'Synthetic context failure' }); return true; }
      const data = context({ ...row, worksheetUsedId: id * 10 });
      data.enrollment = { ...data.enrollment, enrollmentId: id, studentName: `Child ${id}` };
      data.studentEnrollments = [1, 2].map(enrollmentId => ({ ...data.enrollment, enrollmentId, subjectCode: enrollmentId === 1 ? 'ME' : 'EFL' }));
      res.json(data); return true;
    }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ worksheetMonthSummary: summary }); return true; }
    return false;
  }, { embedded });
  const beforeUnload = () => f.page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented;
  });
  try {
    const { page } = f;
    await page.evaluate(async () => (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(1));
    await page.waitForFunction(() => document.activeElement?.matches('[data-ws-input]'));
    const input = page.locator('[data-edit-history-date-id="10"]');
    assert.equal(await beforeUnload(), false);
    await input.fill('2026-11-19'); await input.evaluate(el => el.blur());
    assert.equal(await beforeUnload(), true);
    await page.locator('#studentSubjectSelect').selectOption('2'); await f.choose(false);
    await page.waitForFunction(() => !document.getElementById('appActionDialog'));
    assert.equal(await input.inputValue(), '2026-11-19');
    assert.equal(await page.locator('#studentSubjectSelect').inputValue(), '1');
    assert.equal(f.requests.some(req => req.path.includes('/enrollments/2/context')), false);
    await page.locator('#studentSubjectSelect').selectOption('2'); await f.choose(true);
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Synthetic context failure'));
    assert.equal(await input.inputValue(), '2026-11-19');
    assert.equal(await beforeUnload(), true);
    rejectContext = false;
    await page.locator('#studentSubjectSelect').selectOption('2'); await f.choose(true);
    await page.waitForFunction(() => document.getElementById('studentSearch').value.startsWith('#2 '));
    assert.equal(await page.locator('[data-edit-history-date-id="20"]').inputValue(), '2026-11-20');
    assert.equal(await beforeUnload(), false);
    assert.deepEqual(f.writes(), []); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
