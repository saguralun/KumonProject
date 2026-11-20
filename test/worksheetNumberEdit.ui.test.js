import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import os from 'node:os';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 };
async function waitForSignal(signal) {
  let timer;
  try { await Promise.race([signal, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Fixture edit did not start')), 5000); })]); }
  finally { clearTimeout(timer); }
}
const summary = { billingMonth: 10, billingYear: 2026, usedDays: 1, cpwsRecords: 1 };
const original = id => ({ worksheetUsedId: id * 10, enrollmentId: id, worksheetMasterId: 101, actualWorksheetNo: 101,
  worksheetDate: '2026-10-20', levelMasterId: 100, levelCode: 'C', worksheetType: 'WS', packetWorksheetNo: 101,
  worksheetLabel: 'C101', cpws: true, isStockProcessed: false });
function context(id, row) {
  return { enrollment: { enrollmentId: id, subjectCode: 'ME', studentName: `Student ${id}`, currentLevelMasterId: 100, currentLevelCode: 'C' },
    studentEnrollments: [], defaults: { receiveDate: '2026-10-20', patternCode: 'daily10', mainWorksheetNo: 101 },
    patterns: [{ code: 'daily10', shortLabel: '10/day', manualCount: 1, suffixes: [1], dayOffsets: [0] }],
    worksheetOptions: { main: [{ worksheetNo: 101 }], zun: [] }, history: [row, { ...row, worksheetUsedId: id * 10 + 1, worksheetLabel: 'C151', actualWorksheetNo: 151, isStockProcessed: true }], worksheetMonthSummary: summary };
}
const load = async (page, id = 1) => {
  await page.evaluate(async id => (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(id), id);
  await page.waitForFunction(() => document.activeElement?.matches('[data-ws-input][data-kind=main]'));
};

for (const embedded of [false, true]) test(`WS number editing supports Enter, cancel, validation, retry and reload with processed rows locked (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
  let row = original(1), fail = true, release, started;
  const pending = new Promise(resolve => { started = resolve; });
  const f = await controlFixture('worksheet', async (req, res) => {
    if (req.path.endsWith('/context')) { res.json(context(1, row)); return true; }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (req.path.endsWith('/history')) { res.json({ success: true, history: context(1, row).history, worksheetMonthSummary: summary }); return true; }
    if (req.path === '/worksheet/entries/10/number') {
      assert.equal(req.method, 'PATCH');
      assert.deepEqual(req.body, { enrollmentId: 1, worksheetNo: 26, expectedWorksheetMasterId: 101, expectedActualWorksheetNo: 101 });
      if (fail) res.status(503).json({ success: false, error: 'Fixture WS correction failed' });
      else {
        started(); await new Promise(resolve => { release = resolve; });
        row = { ...row, actualWorksheetNo: 26, worksheetMasterId: 21, packetWorksheetNo: 21, worksheetLabel: 'C26' };
        res.json({ success: true, entry: row, worksheetProgress: { main: { actualWorksheetNo: 26, displayWorksheetNo: 26, maxWorksheetNo: 200, percent: 13 } } });
      }
      return true;
    }
    return false;
  }, { embedded });
  try {
    const { page } = f; await load(page);
    const input = page.locator('[data-edit-history-number-id="10"]');
    assert.equal(await page.locator('[data-edit-history-number-id="11"]').count(), 0);
    await input.fill('26'); await input.press('Escape'); assert.equal(await input.inputValue(), '101');
    await input.fill('26'); await input.press('Tab'); assert.equal(await input.inputValue(), '101');
    await input.fill('201'); await input.press('Enter'); assert.equal(f.writes().length, 0);
    await input.fill('26'); await input.press('Enter');
    await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'Fixture WS correction failed');
    assert.equal(await input.inputValue(), '101'); assert.equal(await input.isEnabled(), true);
    fail = false; await input.fill('26'); await input.press('Enter'); await waitForSignal(pending);
    await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(f.writes().length, 2); assert.equal(await page.locator('#saveButton').isDisabled(), true);
    assert.equal(await page.locator('[data-edit-history-date-id="10"]').isDisabled(), true);
    assert.equal(await page.locator('[data-delete-history-id="10"]').isDisabled(), true);
    release();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'แก้เลข WS แล้ว');
    assert.equal(await input.inputValue(), '26'); assert.equal(await input.isEnabled(), true);
    assert.equal(await input.locator('xpath=ancestor::tr').locator('td').nth(5).innerText(), '21');
    assert.equal(await page.locator('[data-edit-history-date-id="10"]').inputValue(), '2026-10-20');
    assert.equal(await page.evaluate(async () => (await import('/js/worksheet/worksheetState.js')).state.context.worksheetProgress.main.actualWorksheetNo), 26);
    await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-ws-number-edit-${embedded ? 'desktop' : 'browser'}.png`), fullPage: true });
    await page.reload(); await load(page);
    assert.equal(await input.inputValue(), '26'); assert.equal(f.writes().length, 2); assert.deepEqual(f.errors, []);
  } finally { release?.(); await f.close(); }
});

for (const embedded of [false, true]) for (const reject of [false, true]) test(`A late WS number ${reject ? 'failure' : 'success'} cannot overwrite another student (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
  let release, signal;
  const started = new Promise(resolve => { signal = resolve; });
  const f = await controlFixture('worksheet', async (req, res) => {
    const match = req.path.match(/enrollments\/(\d+)\/context/);
    if (match) { const id = Number(match[1]); res.json(context(id, original(id))); return true; }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (req.path === '/worksheet/entries/10/number') {
      signal(); await new Promise(resolve => { release = resolve; });
      if (reject) res.status(409).json({ success: false, error: 'OLD number failure' });
      else res.json({ success: true, entry: { ...original(1), actualWorksheetNo: 26 }, worksheetProgress: { owner: 'OLD' } });
      return true;
    }
    return false;
  }, { embedded });
  try {
    const { page } = f; await load(page);
    const input = page.locator('[data-edit-history-number-id="10"]');
    await input.fill('26'); await input.press('Enter'); await waitForSignal(started);
    await load(page, 2);
    const status = await page.locator('#statusLine').innerText();
    const response = page.waitForResponse(r => r.url().endsWith('/entries/10/number'));
    release(); await (await response).finished();
    await page.waitForFunction(async () => !(await import('/js/worksheet/worksheetState.js')).state.pendingHistoryEdits.has(1));
    assert.equal(await page.locator('[data-edit-history-number-id="20"]').inputValue(), '101');
    assert.equal(await page.locator('#studentSearch').inputValue(), '#2 Student 2');
    assert.equal(await page.locator('#statusLine').innerText(), status);
    assert.equal(f.requests.some(r => r.path === '/worksheet/enrollments/2/history'), false);
    assert.equal(f.writes().length, 1); assert.deepEqual(f.errors, []);
  } finally { release?.(); await f.close(); }
});

test('A saved WS correction stays visible if history reload fails and does not invite a duplicate save', ui, async () => {
  const f = await controlFixture('worksheet', async (req, res) => {
    if (req.path.endsWith('/context')) { res.json(context(1, original(1))); return true; }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (req.path.endsWith('/history')) { res.status(503).json({ success: false, error: 'Fixture history unavailable' }); return true; }
    if (req.path === '/worksheet/entries/10/number') { res.json({ success: true, entry: { ...original(1), actualWorksheetNo: 26, packetWorksheetNo: 21, worksheetMasterId: 21 } }); return true; }
    return false;
  });
  try {
    const { page } = f; await load(page);
    const input = page.locator('[data-edit-history-number-id="10"]');
    await input.fill('26'); await input.press('Enter');
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('แก้เลข WS แล้ว แต่โหลดประวัติใหม่ไม่สำเร็จ'));
    assert.equal(await input.inputValue(), '26'); assert.equal(await input.isEnabled(), true);
    assert.equal(f.writes().length, 1); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
