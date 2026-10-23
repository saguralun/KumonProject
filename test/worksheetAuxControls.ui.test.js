import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) test(`CD confirmations and history controls cannot duplicate a request or mix another student's response (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
  let fail = true, releaseCd, releaseHistory;
  const summary = { billingMonth: 10, billingYear: 2026, usedDays: 1, cpwsRecords: 1 };
  const enrollments = [1, 2].map(enrollmentId => ({ enrollmentId, subjectCode: enrollmentId === 1 ? 'EFL' : 'ME', studentName: `Fixture ${enrollmentId}`, currentLevelMasterId: enrollmentId, currentLevelCode: 'C', statusName: 'Continue' }));
  const context = id => ({ enrollment: enrollments[id - 1], studentEnrollments: enrollments, defaults: { patternCode: 'daily10', receiveDate: '2026-10-20', mainWorksheetNo: 101 }, patterns: [{ code: 'daily10', shortLabel: '10/day', suffixes: [1], dayOffsets: [0] }], worksheetOptions: { main: [{ worksheetNo: 101 }], zun: [] }, history: [], worksheetMonthSummary: summary, cdState: { availableCds: id === 1 ? [{ cdMasterId: 55, cdNo: 1 }] : [], receivedCdMasterIds: [], receivedCds: [] } });
  const f = await controlFixture('worksheet', async (req, res) => {
    const match = req.path.match(/enrollments\/(\d+)\/context/);
    if (match) { res.json(context(Number(match[1]))); return true; }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (req.path.includes('/enrollments/1/history')) {
      await new Promise(resolve => { releaseHistory = resolve; });
      res.json({ success: true, history: [{ worksheetUsedId: 999, worksheetType: 'WS', worksheetDate: '2026-10-20', worksheetLabel: 'OLD-FIXTURE', isStockProcessed: false }], worksheetMonthSummary: summary }); return true;
    }
    if (req.path === '/worksheet/cd/receive') {
      assert.deepEqual(req.body, { enrollmentId: 1, cdMasterId: 55, cdDate: '2026-10-20', cpcd: true });
      if (fail) res.status(503).json({ success: false, error: 'Fixture CD failed' });
      else { await new Promise(resolve => { releaseCd = resolve; }); res.json({ success: true, cdUsedId: 100, cdMasterId: 55, cdNo: 1, cpcd: true, inserted: true }); }
      return true;
    }
  }, { embedded });
  const load = id => f.page.evaluate(async id => { await (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(id); }, id);
  try {
    const { page } = f; await load(1); await page.locator('#receiveCd:enabled').waitFor();
    await page.locator('#receiveCd').click(); await f.choose(false); await f.choose(false); assert.equal(f.writes().length, 0);
    await page.locator('#receiveCd').click(); await f.choose(true);
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture CD failed'));
    assert.equal(await page.locator('#receiveCd').isEnabled(), true);
    fail = false; await page.locator('#receiveCd').click(); await f.choose(true);
    await page.locator('#receiveCd').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(f.writes().length, 2); await load(2); releaseCd();
    await page.waitForTimeout(80); assert.match(await page.locator('#studentSearch').inputValue(), /^#2 /);
    assert.equal(await page.locator('#receiveCd').isDisabled(), true);
    await load(1); await page.locator('#historyLimit').selectOption('50');
    while (!releaseHistory) await new Promise(resolve => setTimeout(resolve, 10));
    await load(2); releaseHistory(); await page.waitForTimeout(80);
    assert.doesNotMatch(await page.locator('#historyTableWrap').innerText(), /OLD-FIXTURE/);
    assert.deepEqual(f.errors, []);
  } finally { releaseCd?.(); releaseHistory?.(); await f.close(); }
});
