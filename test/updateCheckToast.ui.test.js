import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) test(`Menu update check stays compact and reports only manual results for five seconds (${embedded ? 'desktop' : 'browser'})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 40000
}, async () => {
  let current = true, offline = false, checks = 0, release, requestStarted;
  const f = await controlFixture('opening-schedule', async (req, res) => {
    if (req.path === '/system/opening-schedules') {
      res.json({ success: true, weekdays: [], schedulesByWeekday: [], summary: { weekdays: 0, slots: 0, activeSlots: 0, inactiveSlots: 0 } }); return true;
    }
    if (req.path !== '/system/update-check') return false;
    checks++;
    if (release) { requestStarted?.(); await new Promise(resolve => { release = resolve; }); }
    res.status(offline ? 503 : 200).json(offline ? { checked: false } : { checked: true, upToDate: current, remoteMessage: 'Fixture version' }); return true;
  }, { embedded });
  try {
    const { page } = f;
    await page.clock.install();
    await page.locator('#updateCheckStatus[data-stale="false"]').waitFor({ state: 'attached' });
    await page.locator('.app-menu-toggle').click();
    const button = page.getByRole('button', { name: 'ตรวจสอบอัปเดต', exact: true });
    const toast = page.locator('#updateCheckToast');
    assert.equal(await page.locator('#updateCheckMessage').isVisible(), false);
    assert.equal(await toast.isVisible(), false);
    const logoutBox = await page.locator('#authLogoutButton').boundingBox(), checkBox = await button.boundingBox();
    assert.ok(Math.abs(logoutBox.y - checkBox.y) < 2, 'Both actions share one row');
    const initial = checks;
    const started = new Promise(resolve => { requestStarted = resolve; });
    release = true;
    await button.click(); await page.waitForFunction(() => document.getElementById('updateCheckRetry').disabled);
    await started;
    assert.equal(checks, initial + 1); assert.equal(await toast.isVisible(), false);
    await page.locator('#authLogoutButton').focus();
    release(); release = null;
    await toast.waitFor(); assert.match(await toast.innerText(), /ตรวจสอบแล้ว.*รุ่นล่าสุด/);
    assert.equal(await page.locator('#authLogoutButton').evaluate(element => element === document.activeElement), true, 'Toast must not steal focus');
    assert.equal(await page.locator('#authUpdateButton').isVisible(), false);
    await page.clock.runFor(4000); assert.equal(await toast.isVisible(), true);
    await page.clock.runFor(1000); assert.equal(await toast.isVisible(), false);
    current = false; await button.click(); await toast.waitFor();
    assert.match(await toast.innerText(), /ตรวจสอบแล้ว.*มีอัปเดต/);
    assert.equal(await page.locator('.app-menu-toggle').evaluate(element => element.classList.contains('app-menu-has-update')), true);
    await page.clock.runFor(3000);
    offline = true; await button.click(); await page.waitForFunction(() => document.getElementById('updateCheckToast').dataset.error === 'true');
    assert.match(await toast.innerText(), /ตรวจสอบอัปเดตไม่ได้/);
    await page.clock.runFor(2000); assert.equal(await toast.isVisible(), true, 'Old notification timer cannot dismiss the new result');
    await page.locator('.app-menu-close').click(); assert.equal(await toast.isVisible(), true, 'Toast is outside the menu');
    await page.clock.runFor(3000); assert.equal(await toast.isVisible(), false);
    await page.clock.runFor(5 * 60000); assert.equal(await toast.isVisible(), false, 'Background retries stay quiet');
    for (const [width, height] of [[1366, 768], [1024, 768]]) {
      await page.setViewportSize({ width, height }); await page.locator('.app-menu-toggle').click();
      offline = false; await button.click(); await toast.waitFor();
      const box = await toast.boundingBox(); assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height);
      await page.screenshot({ path: path.resolve(`logs/update-check-toast-${embedded ? 'desktop' : 'browser'}-${width}.png`) });
      await page.locator('.app-menu-close').click();
    }
    assert.equal(await page.locator('#statusLine').evaluate(element => element.classList.contains('is-error')), false);
    assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
  } finally { if (typeof release === 'function') release(); await f.close(); }
});
