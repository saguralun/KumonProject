import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 60000 };
const summary = { billingMonth: 11, billingYear: 2026, usedDays: 1, cpwsRecords: 1 };
const student = id => ({ enrollmentId: id, subjectCode: 'ME', studentName: `WS fixture ${id}`,
  currentLevelMasterId: 100, currentLevelCode: 'C', currentZunLevelMasterId: 99, currentZunLevelCode: 'ZI' });
const entry = (id, date = '2026-11-20', number = 101) => ({ worksheetUsedId: id, enrollmentId: 1,
  worksheetMasterId: number, actualWorksheetNo: number, worksheetDate: date, levelMasterId: 100,
  levelCode: 'C', worksheetType: 'WS', worksheetLabel: `C${number}`, packetWorksheetNo: number,
  cpws: true, isStockProcessed: false });
function context(id = 1, history = []) {
  return { enrollment: student(id), studentEnrollments: [],
    defaults: { receiveDate: '2026-11-20', patternCode: 'daily10', mainWorksheetNo: 101, zunWorksheetNo: 1 },
    patterns: [
      { code: 'daily10', shortLabel: '10/day', manualCount: 1, suffixes: [1], dayOffsets: [0] },
      { code: 'daily20', shortLabel: '20/day', manualCount: 2, suffixes: [1, 1], dayOffsets: [0, 0] }
    ],
    worksheetOptions: {
      main: Array.from({ length: 20 }, (_, i) => ({ worksheetNo: i * 10 + 1 })),
      zun: Array.from({ length: 10 }, (_, i) => ({ worksheetNo: i * 10 + 1 }))
    }, history, worksheetMonthSummary: summary };
}
async function load(page, id = 1) {
  await page.evaluate(async id => (await import('/js/worksheet/worksheet.js')).loadEnrollmentContext(id), id);
  await page.waitForFunction(() => document.activeElement?.matches('[data-ws-input][data-kind=main]'));
}

for (const embedded of [false, true]) {
  const surface = embedded ? 'desktop fixture' : 'browser';
  test(`WS search Tab/Enter/Space, arrow/Enter and mouse each load exactly one context (${surface})`, ui, async () => {
    const f = await controlFixture('worksheet', async (req, res) => {
      if (req.path === '/worksheet/search') { res.json({ success: true, rows: [student(1), student(2)] }); return true; }
      const match = req.path.match(/enrollments\/(\d+)\/context$/);
      if (match) { res.json(context(Number(match[1]))); return true; }
      if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
      return false;
    }, { embedded });
    try {
      const { page } = f, search = page.locator('#studentSearch');
      const contextRequests = () => f.requests.filter(r => r.path.endsWith('/context')).length;
      for (const activation of ['Enter', 'Space', 'mouse', 'arrow']) {
        await page.reload();
        await page.waitForFunction(() => document.activeElement?.id === 'studentSearch');
        await search.fill('WS fixture');
        await page.locator('#searchResults .result-item').last().waitFor();
        const before = contextRequests();
        if (activation === 'mouse') {
          await page.locator('#searchResults .result-item').last().click();
        } else if (activation === 'arrow') {
          await search.press('ArrowDown'); await search.press('Enter');
        } else {
          await search.press('Tab'); await page.keyboard.press('Tab');
          assert.equal(await page.locator('#searchResults .result-item').last().evaluate(el => el === document.activeElement), true);
          await page.keyboard.press(activation);
        }
        await page.waitForFunction(() => document.getElementById('studentSearch').value.startsWith('#2 ')
          && document.activeElement?.matches('[data-ws-input][data-kind=main]'));
        // A rendered frame after mouseup also flushes any later native click.
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.equal(contextRequests(), before + 1, `${activation} must select once`);
        assert.equal(await page.locator('#searchResults').evaluate(el => el.classList.contains('hidden')), true);
      }
      assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  for (const historyFails of [false, true]) {
    test(`WS date edit rejects, retries and remains usable after history ${historyFails ? '503' : 'success'} (${surface})`, ui, async () => {
      let rows = [entry(11, '2026-10-20', 111), entry(10)], rejectPatch = true, rejectHistory = historyFails;
      const f = await controlFixture('worksheet', async (req, res) => {
        if (req.path.endsWith('/context')) { res.json(context(1, rows)); return true; }
        if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
        if (req.path.endsWith('/history')) {
          if (rejectHistory) res.status(503).json({ success: false, error: 'Fixture history unavailable' });
          else res.json({ success: true, history: rows, worksheetMonthSummary: summary });
          return true;
        }
        if (req.path === '/worksheet/entries/10/date') {
          assert.equal(req.method, 'PATCH');
          assert.deepEqual(req.body, { enrollmentId: 1, worksheetDate: '2026-11-21' });
          if (rejectPatch) res.status(503).json({ success: false, error: 'Fixture date rejected' });
          else {
            rows = rows.map(row => row.worksheetUsedId === 10 ? { ...row, worksheetDate: req.body.worksheetDate } : row);
            res.json({ success: true, entry: rows[1] });
          }
          return true;
        }
        if (req.path === '/worksheet/entries/10/number') {
          assert.equal(req.method, 'PATCH'); assert.equal(req.body.worksheetNo, 26);
          rows = rows.map(row => row.worksheetUsedId === 10
            ? { ...row, actualWorksheetNo: 26, worksheetMasterId: 21, packetWorksheetNo: 21, worksheetLabel: 'C26' } : row);
          res.json({ success: true, entry: rows[1] }); return true;
        }
        return false;
      }, { embedded });
      try {
        const { page } = f; await load(page);
        const date = page.locator('[data-edit-history-date-id="10"]');
        await date.fill('2026-11-21'); await date.press('Escape'); assert.equal(await date.inputValue(), '2026-11-20');
        await date.focus(); await date.fill('2026-11-21');
        // Native date controls may Tab between date segments before blurring.
        for (let i = 0; i < 4 && await date.evaluate(el => el === document.activeElement); i++) await page.keyboard.press('Tab');
        assert.equal(await date.inputValue(), '2026-11-21', 'Tab retains the date draft without saving');
        assert.equal(f.writes().length, 0);
        await date.fill('2026-11-21'); await date.press('Enter');
        await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'Fixture date rejected');
        assert.equal(await date.inputValue(), '2026-11-21', 'A rejected save keeps the draft for retry'); assert.equal(await date.isEnabled(), true);
        rejectPatch = false;
        await date.fill('2026-11-21'); await date.press('Enter');
        await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('แก้วันที่แล้ว'));
        assert.equal(await date.isEnabled(), true, 'Successful PATCH followed by history failure must unlock date');
        assert.equal(await date.inputValue(), '2026-11-21');
        if (historyFails) {
          assert.match(await page.locator('#statusLine').innerText(), /แต่โหลดประวัติใหม่ไม่สำเร็จ/);
          assert.equal(await page.locator('#statusLine').evaluate(el => el.classList.contains('is-success')), false);
        } else assert.equal(await page.locator('#statusLine').innerText(), 'แก้วันที่แล้ว');
        assert.deepEqual(await page.locator('[data-delete-history-id]').evaluateAll(els => els.map(el => el.dataset.deleteHistoryId)), ['11', '10']);
        await date.press('Enter');
        assert.equal(f.writes().length, 2, 'Re-entering persisted date must not repeat PATCH');
        // Editing the WS number after the failure exercises the formerly blocked flow.
        rejectHistory = false;
        const number = page.locator('[data-edit-history-number-id="10"]');
        await number.fill('26'); await number.press('Enter');
        await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'แก้เลข WS แล้ว');
        assert.equal(await number.inputValue(), '26'); assert.equal(await date.inputValue(), '2026-11-21');
        await page.reload(); await load(page);
        assert.equal(await date.inputValue(), '2026-11-21');
        assert.equal(await number.inputValue(), '26');
        assert.equal(f.writes().length, 3); assert.deepEqual(f.errors, []);
      } finally { await f.close(); }
    });
  }

  test(`WS daily20 leaves optional Zun blank, blocks half pairs and saves complete pairs (${surface})`, ui, async () => {
    const f = await controlFixture('worksheet', async (req, res) => {
      if (req.path.endsWith('/context')) { res.json(context()); return true; }
      if (req.path.endsWith('/worksheet-summary')) { res.json({ success: true, worksheetMonthSummary: summary }); return true; }
      if (req.path === '/worksheet/entries') {
        assert.equal(req.method, 'POST'); assert.equal(req.body.patternCode, 'daily20');
        assert.deepEqual(req.body.mainWorksheetNos, ['101', '111']);
        const selected = req.body.zunWorksheetNos.filter(Boolean);
        assert.ok(selected.length === 0 || selected.length === 2, 'Service requires blank or complete optional Zun');
        const records = [entry(20), entry(21, '2026-11-20', 111), ...selected.map((number, i) => ({
          ...entry(22 + i, req.body.receiveDate, Number(number)), worksheetType: 'ZUN',
          levelMasterId: 99, levelCode: 'ZI', worksheetLabel: `ZI${number}`
        }))];
        res.json({ success: true, records, nextReceiveDate: '2026-11-21' }); return true;
      }
      return false;
    }, { embedded });
    try {
      const { page } = f; await load(page);
      const zun = page.locator('[data-ws-input][data-kind="zun"]');
      const labels = () => page.locator('#previewList .preview-label').allTextContents();
      const values = () => zun.evaluateAll(els => els.map(el => el.value));
      assert.deepEqual(await values(), ['']);
      await page.locator('[data-pattern="daily20"]').click();
      assert.deepEqual(await values(), ['', ''], 'Changing pattern must not invent a half-filled optional Zun');
      assert.deepEqual(await labels(), ['C101', 'C111']); assert.equal(await page.locator('#saveButton').isEnabled(), true);
      await page.locator('#saveButton').click();
      await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('บันทึก 2 รายการแล้ว'));
      assert.equal(f.writes().length, 1);
      for (const [first, second] of [['1', ''], ['', '11']]) {
        await zun.nth(0).selectOption(first); await zun.nth(1).selectOption(second);
        assert.equal(await page.locator('#saveButton').isDisabled(), true, 'Either half pair must block Save');
        assert.ok((await labels()).every(label => !label.startsWith('ZI')), 'Preview must not advertise a half Zun pair');
        await zun.nth(1).focus(); await zun.nth(1).press('Enter');
        assert.equal(f.writes().length, 1, 'Keyboard shortcut must respect incomplete-pair validation');
      }
      await zun.nth(0).selectOption('1'); await zun.nth(1).selectOption('11');
      assert.deepEqual(await labels(), ['C101', 'C111', 'ZI1', 'ZI11']);
      assert.equal(await page.locator('#saveButton').isEnabled(), true);
      await zun.nth(1).focus(); await zun.nth(1).press('Enter');
      await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('บันทึก 4 รายการแล้ว'));
      assert.equal(f.writes().length, 2);
      assert.deepEqual(f.writes().map(r => r.body.zunWorksheetNos), [['', ''], ['1', '11']]);
      // Returning to daily10 retains the first optional value and its normal save behavior.
      await page.locator('[data-pattern="daily10"]').click();
      assert.deepEqual(await values(), ['1']);
      assert.deepEqual(await labels(), ['C101', 'ZI1']);
      assert.equal(await page.locator('#saveButton').isEnabled(), true);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
