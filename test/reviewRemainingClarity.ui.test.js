import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';
import { reviewWorksheetFixture } from './support/reviewWorksheetFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000 };
for (const embedded of [false, true]) {
  test(`WS number draft survives Tab, redraw and rejection without changing the date draft (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    const f = await reviewWorksheetFixture(embedded);
    try {
      const { page } = f; await f.load();
      const input = page.locator('[data-edit-history-number-id="10"]'), date = page.locator('[data-edit-history-date-id="10"]');
      await input.fill('26'); await input.press('Tab');
      assert.equal(await input.inputValue(), '26');
      assert.match(await input.locator('xpath=ancestor::td').innerText(), /ยังไม่บันทึก.*101/s);
      const redraw = page.waitForResponse(r => r.url().includes('/history?'));
      await page.locator('#historyLimit').selectOption('100'); await redraw;
      assert.equal(await input.inputValue(), '26'); assert.equal(f.writes().length, 0);
      await date.fill('2026-11-19'); await date.evaluate(el => el.blur());
      await page.locator('[data-save-history-number-id="10"]').click();
      await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Synthetic number rejection'));
      assert.equal(await input.inputValue(), '26'); assert.equal(await date.inputValue(), '2026-11-19');
      f.config.rejectNumber = false; await input.press('Enter');
      await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'แก้เลข WS แล้ว');
      assert.equal(await input.inputValue(), '26'); assert.equal(await date.inputValue(), '2026-11-19');
      assert.equal(await page.locator('[data-save-history-number-id="10"]').isVisible(), false);
      await input.fill('27'); await input.press('Escape'); assert.equal(await input.inputValue(), '26');
      await input.fill('27'); await page.locator('[data-cancel-history-number-id="10"]').click(); assert.equal(await input.inputValue(), '26');
      assert.equal(await page.locator('[data-edit-history-number-id="11"]').count(), 0);
      assert.deepEqual(f.writes().map(r => r.path), ['/worksheet/entries/10/number', '/worksheet/entries/10/number']);
      assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`AT blocked controls explain requirements, KC and date effects without changing defaults (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    const f = await reviewWorksheetFixture(embedded);
    try {
      const { page } = f; await f.load();
      assert.equal(await page.locator('#completeWsLevel').isVisible(), true);
      assert.equal(await page.locator('#completeWsLevel').isDisabled(), true);
      assert.match(await page.locator('#completionHint').innerText(), /191/);
      await page.locator('[data-progress-kind=zun]').click();
      assert.equal(await page.locator('#completeZunLevel').isVisible(), true);
      assert.equal(await page.locator('#completeZunLevel').isDisabled(), true);
      assert.match(await page.locator('#completionHint').innerText(), /91/);
      await f.load(2);
      assert.equal(await page.locator('#completeWsLevel').isEnabled(), true);
      assert.match(await page.locator('#completionHint').innerText(), /KC/);
      await page.locator('#completeWsLevel').click();
      assert.equal(await page.locator('#atDate').inputValue(), '2026-11-20');
      assert.match(await page.locator('#atDateHelp').innerText(), /Receive Date/);
      assert.match(await page.locator('#atEffectHint').innerText(), /ระดับปัจจุบันทันที/);
      assert.equal(await page.locator('[data-at-pass=true]').evaluate(el => el.classList.contains('active')), true);
      await page.locator('[data-at-pass=false]').click();
      assert.doesNotMatch(await page.locator('#atEffectHint').innerText(), /เปลี่ยนระดับปัจจุบันทันที/);
      await page.locator('#atCancel').click();
      assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`Role delete counts inactive accounts and keeps genuinely unused roles deletable (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    let roles = [{ role_code: 'admin', role_name: 'Admin', is_system: true },
      { role_code: 'inactive-only', role_name: 'Inactive role', is_system: false, active_user_count: 0, inactive_user_count: 1, total_user_count: 1 },
      { role_code: 'unused', role_name: 'Unused role', is_system: false, active_user_count: 0, inactive_user_count: 0, total_user_count: 0 }];
    const f = await controlFixture('users', async (req, res) => {
      if (req.path === '/users') res.json({ users: [{ user_id: 22, username: 'fixture-inactive', display_name: 'Inactive account', role: 'inactive-only', is_active: false }] });
      else if (req.path === '/roles') res.json({ roles, permissions: [], grants: [] });
      else if (req.path === '/roles/unused' && req.method === 'DELETE') { roles = roles.filter(row => row.role_code !== 'unused'); res.json({ success: true }); }
      else return false;
      return true;
    }, { embedded });
    try {
      const { page } = f, blocked = page.locator('.matrix-delete-role[data-role-code="inactive-only"]'), allowed = page.locator('.matrix-delete-role[data-role-code="unused"]');
      await blocked.waitFor();
      assert.equal(await blocked.isDisabled(), true);
      assert.match(await blocked.getAttribute('title'), /ปิดใช้งาน 1/);
      assert.match(await blocked.locator('xpath=ancestor::th').innerText(), /ใช้งาน 0.*ปิดใช้งาน 1/s);
      assert.equal(await allowed.isEnabled(), true);
      await allowed.click(); await f.choose(false);
      await page.waitForFunction(() => !document.getElementById('appActionDialog'));
      assert.equal(f.writes().length, 0);
      await allowed.click(); await f.choose(true);
      await allowed.waitFor({ state: 'detached' });
      assert.deepEqual(f.writes().map(r => r.path), ['/roles/unused']); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
