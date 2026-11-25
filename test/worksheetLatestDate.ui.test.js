import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) test(`WS history keeps new entries visible while Main/Zun progress follows Receive Date (${embedded ? 'desktop' : 'browser'})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000
}, async () => {
  const summary = { billingMonth: 11, billingYear: 2026, usedDays: 2, cpwsRecords: 2 };
  const row = (id, date, number, level = 100, cpws = true) => ({
    worksheetUsedId: id, enrollmentId: 1, worksheetMasterId: number, actualWorksheetNo: number,
    worksheetDate: date, levelMasterId: level, levelCode: level === 99 ? 'ZI' : 'D',
    worksheetType: level === 99 ? 'ZUN' : 'WS', worksheetLabel: `${level === 99 ? 'ZI' : 'D'}${number}`,
    packetWorksheetNo: number, cpws, isStockProcessed: false
  });
  let history = [row(6, '2026-12-20', 191, 100, false), row(5, '2026-10-20', 81, 99),
    row(4, '2026-11-20', 21, 99), row(3, '2026-10-20', 151), row(2, '2026-11-20', 121), row(1, '2026-10-20', 131)];
  const context = () => ({
    enrollment: { enrollmentId: 1, subjectCode: 'ME', studentName: 'Receive Date fixture', currentLevelMasterId: 100,
      currentLevelCode: 'D', currentZunLevelMasterId: 99, currentZunLevelCode: 'ZI' },
    studentEnrollments: [], defaults: { receiveDate: '2026-10-20', patternCode: 'daily10', mainWorksheetNo: 121 },
    patterns: [{ code: 'daily10', shortLabel: '10/day', manualCount: 1, suffixes: [1], dayOffsets: [0] }],
    worksheetOptions: { main: [{ worksheetNo: 121 }], zun: [{ worksheetNo: 21 }] },
    history, worksheetMonthSummary: summary
    // Omit server progress to exercise the browser's history fallback.
  });
  const f = await controlFixture('worksheet', async (req, res) => {
    if (req.path.endsWith('/context')) { res.json(context()); return true; }
    if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
    if (req.path === '/worksheet/entries') {
      assert.equal(req.method, 'POST'); assert.equal(req.body.enrollmentId, 1);
      const saved = row(7, '0092-03-20', 191);
      history = [saved, ...history];
      res.json({ success: true, records: [saved], nextReceiveDate: '2026-11-21' }); return true;
    }
    return false;
  }, { embedded });
  try {
    const { page } = f;
    const load = async () => {
      await page.evaluate(async () => (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(1));
      await page.waitForFunction(() => document.activeElement?.matches('[data-ws-input][data-kind=main]'));
    };
    await load();
    assert.equal(await page.locator('#worksheetProgressValue').innerText(), '130');
    await page.locator('[data-progress-kind="zun"]').click();
    assert.equal(await page.locator('#worksheetProgressValue').innerText(), '30');
    await page.locator('[data-progress-kind="main"]').click();
    await page.locator('#saveButton').click();
    await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('บันทึก 1 รายการแล้ว'));
    assert.equal(await page.locator('.history-table [data-delete-history-id]').first().getAttribute('data-delete-history-id'), '7');
    assert.equal(await page.locator('[data-edit-history-date-id="7"]').inputValue(), '0092-03-20');
    assert.equal(await page.locator('#worksheetProgressValue').innerText(), '130');
    await page.reload(); await load();
    assert.equal(await page.locator('.history-table [data-delete-history-id]').first().getAttribute('data-delete-history-id'), '7');
    assert.equal(await page.locator('#worksheetProgressValue').innerText(), '130');
    history = [row(8, '2026-11-20', 31), ...history];
    await load();
    assert.equal(await page.locator('#worksheetProgressValue').innerText(), '40');
    assert.equal(await page.locator('.history-table [data-delete-history-id]').first().getAttribute('data-delete-history-id'), '8');
    await page.locator('[data-progress-kind="zun"]').click();
    assert.equal(await page.locator('#worksheetProgressValue').innerText(), '30');
    assert.equal(f.writes().length, 1); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
