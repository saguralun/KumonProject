import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewWorksheetFixture } from './support/reviewWorksheetFixture.js';
import { controlFixture } from './support/controlFixture.js';
const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000 };

async function redraw(f) {
  const done = f.page.waitForResponse(r => r.url().includes('/history?'));
  await f.page.locator('#historyLimit').selectOption('100'); await done;
}

for (const embedded of [false, true]) {
  test(`A legacy number row without a master snapshot remains editable (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    const f = await reviewWorksheetFixture(embedded);
    try {
      f.config.transformContext = data => { delete data.history[0].worksheetMasterId; };
      await f.load();
      f.config.rejectNumber = false;
      const number = f.page.locator('[data-edit-history-number-id="10"]');
      await number.fill('26'); await number.press('Enter');
      await f.page.waitForFunction(() => document.getElementById('statusLine').textContent === 'แก้เลข WS แล้ว');
      assert.equal(await number.inputValue(), '26'); assert.equal(f.writes().length, 1);
      assert.equal(f.writes()[0].body.expectedActualWorksheetNo, 101);
      assert.equal(Object.hasOwn(f.writes()[0].body, 'expectedWorksheetMasterId'), false);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`WS number draft detects another machine's edit before writing and permits a reviewed retry (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    const f = await reviewWorksheetFixture(embedded);
    try {
      const { page } = f; await f.load();
      const number = page.locator('[data-edit-history-number-id="10"]');
      await number.fill('26'); await number.press('Tab');
      f.rows.set(1, { ...f.rows.get(1), actualWorksheetNo: 30, worksheetMasterId: 21, packetWorksheetNo: 21, worksheetLabel: 'A30' });
      await redraw(f);
      assert.equal(await number.inputValue(), '26');
      await page.locator('[data-save-history-number-id="10"]').click();
      assert.equal(f.writes().length, 0, 'A draft based on A101 must not silently use A30 as its expected value');
      assert.match(await page.locator('#statusLine').innerText(), /เปลี่ยนแล้ว|อีกเครื่อง/);
      assert.match(await number.locator('xpath=ancestor::td').innerText(), /30/);
      await number.fill(''); await number.fill('26');
      f.config.rejectNumber = false; await number.press('Enter');
      await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'แก้เลข WS แล้ว');
      assert.equal(f.writes().length, 1);
      assert.equal(f.writes()[0].body.expectedActualWorksheetNo, 30);
      assert.equal(f.writes()[0].body.expectedWorksheetMasterId, 21);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`Stock processing while dates and numbers are drafted keeps read-only drafts cancellable (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    const f = await reviewWorksheetFixture(embedded);
    try {
      const { page } = f; await f.load();
      await page.locator('[data-edit-history-number-id="10"]').fill('26');
      await page.locator('[data-edit-history-date-id="10"]').fill('2026-11-19');
      f.rows.set(1, { ...f.rows.get(1), isStockProcessed: true });
      await redraw(f);
      assert.equal(await page.locator('[data-edit-history-number-id="10"]').count(), 0);
      const cancelNumber = page.locator('[data-cancel-history-number-id="10"]');
      assert.equal(await cancelNumber.count(), 1);
      assert.match(await cancelNumber.locator('xpath=..').innerText(), /26.*ตัดสต็อกแล้ว/s);
      assert.equal(await page.locator('[data-save-history-number-id="10"]').count(), 0);
      await cancelNumber.click(); await page.locator('[data-cancel-history-date-id="10"]').click();
      assert.equal(await page.evaluate(async () => {
        const { state } = await import('/js/worksheet/worksheetState.js');
        return state.historyNumberDrafts.size + state.historyDateDrafts.size;
      }), 0);
      assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`Number and date drafts survive cancelled selection and a failed context load (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    const f = await reviewWorksheetFixture(embedded);
    try {
      const { page } = f; await f.load();
      const number = page.locator('[data-edit-history-number-id="10"]'), date = page.locator('[data-edit-history-date-id="10"]');
      await number.fill('26'); await date.fill('2026-11-19'); await date.evaluate(el => el.blur());
      const beforeUnload = () => page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; });
      assert.equal(await beforeUnload(), true);
      await page.locator('#studentSubjectSelect').selectOption('2'); await f.choose(false);
      await page.waitForFunction(() => !document.getElementById('appActionDialog'));
      assert.equal(await number.inputValue(), '26'); assert.equal(await date.inputValue(), '2026-11-19');
      f.config.rejectContext = true;
      await page.locator('#studentSubjectSelect').selectOption('2'); await f.choose(true);
      await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Synthetic context unavailable'));
      assert.equal(await number.inputValue(), '26'); assert.equal(await date.inputValue(), '2026-11-19');
      f.config.rejectContext = false;
      await page.locator('#studentSubjectSelect').selectOption('2'); await f.choose(true);
      await page.waitForFunction(() => document.getElementById('studentSearch').value.startsWith('#2 '));
      assert.equal(await page.locator('[data-edit-history-number-id="20"]').inputValue(), '101');
      assert.equal(await beforeUnload(), false);
      assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`Saving the date first preserves the number draft and its original packet snapshot (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    const f = await reviewWorksheetFixture(embedded);
    try {
      const { page } = f; await f.load();
      const number = page.locator('[data-edit-history-number-id="10"]'), date = page.locator('[data-edit-history-date-id="10"]');
      await number.fill('26'); await date.fill('2026-11-19');
      await page.locator('[data-save-history-date-id="10"]').click();
      await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'แก้วันที่แล้ว');
      assert.equal(await number.inputValue(), '26');
      if (embedded) await page.screenshot({ path: 'logs/remaining-number-date-drafts.png', fullPage: true });
      f.config.rejectNumber = false;
      await number.press('Enter');
      await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'แก้เลข WS แล้ว');
      assert.equal(await date.inputValue(), '2026-11-19');
      assert.equal(f.writes()[1].body.expectedActualWorksheetNo, 101);
      assert.equal(f.writes()[1].body.expectedWorksheetMasterId, 101);
      assert.equal(f.rows.get(1).cpws, true); assert.equal(f.rows.get(1).isStockProcessed, false);
      assert.equal(f.writes().length, 2); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`AT explanations cover unavailable masters, free-level prerequisites, busy controls and PC/tablet layouts (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    const f = await reviewWorksheetFixture(embedded);
    try {
      const { page } = f;
      for (const [free, next, ready, expected] of [[false, 2, false, /ไม่มีข้อมูล AT/], [true, 2, false, /191/], [true, null, false, /ไม่มีระดับถัดไป/], [true, 2, true, /พร้อมจบ Level/]]) {
        f.config.transformContext = data => {
          Object.assign(data.completionState.atCompletion, { hasAtMaster: false, canComplete: false, atMasterId: null });
          Object.assign(data.completionState.freeLevelCompletion, { isFreeCompletionLevel: free, canComplete: ready, nextLevelMasterId: next, hasWorksheet191: ready });
        };
        await f.load();
        assert.match(await page.locator('#completionHint').innerText(), expected);
        assert.equal(await page.locator('#completeWsLevel').isEnabled(), ready);
        if (!ready) {
          const button = await page.locator('#completeWsLevel').boundingBox(), ring = await page.locator('#worksheetProgressRing').boundingBox();
          assert.ok(button.y >= ring.y + ring.height - 1, 'Disabled AT action must not cover the progress values');
          assert.equal(await page.locator('#completeWsLevel').evaluate(el => getComputedStyle(el).opacity), '1');
          if (embedded && !free) await page.screenshot({ path: 'logs/remaining-completion-blocked.png', fullPage: true });
        }
        if (ready) { await page.locator('#completeWsLevel').click(); await f.choose(false); await page.waitForFunction(() => !document.getElementById('appActionDialog')); }
      }
      f.config.transformContext = null; await f.load(2);
      await page.evaluate(async () => { const { state } = await import('/js/worksheet/worksheetState.js'); state.isLoadingContext = true; (await import('/js/worksheet/worksheetPreview.js')).updateSecondaryActions(); });
      assert.equal(await page.locator('#completeWsLevel').isDisabled(), true);
      assert.match(await page.locator('#completionHint').innerText(), /กำลังโหลด/);
      await page.evaluate(async () => { const { state } = await import('/js/worksheet/worksheetState.js'); state.isLoadingContext = false; (await import('/js/worksheet/worksheetPreview.js')).updateSecondaryActions(); });
      assert.equal(await page.locator('#completeWsLevel').isEnabled(), true);
      for (const width of [1366, 1024]) {
        await page.setViewportSize({ width, height: 768 });
        assert.equal(await page.locator('#completionHint').isVisible(), true);
        assert.equal(await page.locator('#completeWsLevel').isVisible(), true);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        if (embedded) await page.screenshot({ path: `logs/remaining-completion-${width}.png`, fullPage: true });
      }
      await page.locator('#completeWsLevel').click();
      await page.locator('#atDate').fill('2026-10-20');
      assert.equal(await page.locator('#receiveDate').inputValue(), '2026-11-20');
      assert.match(await page.locator('#atEffectHint').innerText(), /ย้อนหลัง/);
      if (embedded) await page.screenshot({ path: 'logs/remaining-at-date-help.png', fullPage: true });
      assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`Role deletion handles older count payloads and re-reads a concurrent assignment after rejection (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    const roles = [{ role_code: 'admin', role_name: 'Admin', is_system: true },
      { role_code: 'legacy', role_name: 'Legacy inactive', is_system: false, active_user_count: 0 },
      { role_code: 'empty', role_name: 'Initially empty', is_system: false, active_user_count: 0, total_user_count: 0, inactive_user_count: 0 }];
    const accounts = [{ user_id: 22, username: 'fixture-inactive', role: 'legacy', is_active: false }];
    const f = await controlFixture('users', async (req, res) => {
      if (req.path === '/users') res.json({ users: accounts });
      else if (req.path === '/roles') res.json({ roles, permissions: [{ permission_key: 'page:stock', permission_label: 'Stock', nav_group: 'warehouse' }], grants: [] });
      else if (req.path === '/roles/empty' && req.method === 'DELETE') {
        Object.assign(roles[2], { total_user_count: 1, inactive_user_count: 1 });
        accounts.push({ user_id: 23, username: 'fixture-new-assignment', role: 'empty', is_active: false });
        res.status(409).json({ error: 'Synthetic role assigned on another machine' });
      } else return false;
      return true;
    }, { embedded });
    try {
      const { page } = f, legacy = page.locator('.matrix-delete-role[data-role-code=legacy]'), empty = page.locator('.matrix-delete-role[data-role-code=empty]');
      await legacy.waitFor(); assert.equal(await legacy.isDisabled(), true);
      await empty.click(); await f.choose(true);
      await page.waitForFunction(() => document.querySelector('.matrix-delete-role[data-role-code=empty]')?.disabled);
      assert.match(await page.locator('#statusLine').innerText(), /another machine/);
      assert.equal(await page.locator('input[data-role-code=empty]').isEnabled(), true);
      assert.equal(f.writes().length, 1);
      if (embedded) await page.screenshot({ path: 'logs/remaining-role-usage.png', fullPage: true });
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
