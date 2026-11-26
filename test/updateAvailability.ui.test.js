import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';
import os from 'node:os';
import path from 'node:path';

for (const embedded of [false, true]) {
  test(`New updates appear while login and workspace stay open (${embedded ? 'Electron' : 'browser'})`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000
  }, async () => {
    for (const pageName of ['login', 'opening-schedule']) {
      let current = true, offline = false, checks = 0;
      const fixture = await controlFixture(pageName, (req, res) => {
        if (req.path === '/system/opening-schedules') {
          res.json({ success: true, weekdays: [], schedulesByWeekday: [], summary: { weekdays: 0, slots: 0, activeSlots: 0, inactiveSlots: 0 } });
          return true;
        }
        if (req.path !== '/system/update-check') return false;
        checks++;
        res.status(offline ? 503 : 200).json(offline ? { checked: false } : { checked: true, upToDate: current, remoteMessage: 'Fixture new version' });
        return true;
      }, { embedded });
      try {
        const { page } = fixture;
        if (!embedded) await page.setViewportSize({ width: 390, height: 844 });
        await page.clock.install();
        const initialCheck = page.waitForResponse(response => response.url().includes('/api/system/update-check'));
        await page.reload(); await initialCheck;
        await page.waitForFunction(() => document.querySelector('#loginUpdateButton, #authUpdateButton'));
        const notice = page.locator(pageName === 'login' ? '#updateBanner' : '#authUpdateButton');
        assert.equal(await notice.evaluate(element => element.classList.contains('hidden')), true);
        if (pageName !== 'login') {
          assert.equal(await page.locator('.app-menu-toggle').evaluate(element => element.classList.contains('app-menu-has-update')), false);
          assert.doesNotMatch(await page.locator('.app-menu-toggle').getAttribute('aria-label'), /มีอัปเดต/);
        }
        current = false;
        await page.clock.runFor(5 * 60000);
        await page.waitForFunction(selector => !document.querySelector(selector).classList.contains('hidden'), pageName === 'login' ? '#updateBanner' : '#authUpdateButton');
        assert.ok(checks >= 2); assert.equal(fixture.writes().length, 0);
        if (pageName !== 'login') assert.equal(await page.locator('#statusLine').evaluate(element => element.classList.contains('is-error')), false);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-update-anytime-${pageName}-${embedded ? 'electron' : 'browser'}.png`), fullPage: true });
        if (pageName !== 'login') {
          assert.equal(await page.locator('.app-menu-toggle').evaluate(element => element.classList.contains('app-menu-has-update')), true);
          const badge = await page.locator('.app-menu-toggle').evaluate(element => {
            const style = getComputedStyle(element, '::before');
            return { content: style.content, background: style.backgroundColor, width: parseFloat(style.minWidth), height: parseFloat(style.height), events: style.pointerEvents };
          });
          assert.match(badge.content, /ใหม่/); assert.equal(badge.background, 'rgb(220, 38, 38)');
          assert.ok(badge.width >= 25 && badge.height >= 18); assert.equal(badge.events, 'none');
          assert.match(await page.locator('.app-menu-toggle').getAttribute('aria-label'), /^เปิดเมนู.*มีอัปเดต/);
          const bounds = await page.locator('.app-menu-toggle').boundingBox();
          await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-menu-update-badge-${embedded ? 'electron' : 'browser'}.png`),
            clip: { x: Math.max(0, bounds.x - 8), y: Math.max(0, bounds.y - 8), width: bounds.width + 24, height: bounds.height + 20 } });
          await page.locator('.app-menu-toggle').click();
          assert.equal(await page.locator('.app-menu-panel').getAttribute('aria-hidden'), 'false');
          assert.match(await page.locator('.app-menu-toggle').getAttribute('aria-label'), /^ปิดเมนู.*มีอัปเดต/);
          assert.equal(fixture.writes().length, 0);
        }
        await page.locator(pageName === 'login' ? '#loginUpdateButton' : '#authUpdateButton').click();
        await fixture.choose(false); assert.equal(fixture.writes().length, 0);
        await page.waitForFunction(() => !document.getElementById('appActionDialog'));
        offline = true;
        await page.clock.runFor(5 * 60000);
        await page.locator('#updateCheckStatus[data-stale="true"]').waitFor({ state: 'attached' });
        assert.match(await page.locator('#updateCheckMessage').textContent(), /ตรวจเวอร์ชันไม่ได้.*ตรวจสำเร็จล่าสุด/);
        if (pageName !== 'login') {
          assert.equal(await page.locator('#updateCheckMessage').isVisible(), false);
          assert.equal(await page.locator('#updateCheckToast').isVisible(), false, 'Background checks must stay quiet');
        }
        assert.equal(await notice.evaluate(element => element.classList.contains('hidden')), false);
        if (pageName !== 'login') assert.equal(await page.locator('.app-menu-toggle').evaluate(element => element.classList.contains('app-menu-has-update')), true);
        offline = false; current = true;
        await page.locator('#updateCheckRetry').click();
        await page.waitForFunction(selector => document.querySelector(selector).classList.contains('hidden'), pageName === 'login' ? '#updateBanner' : '#authUpdateButton');
        if (pageName !== 'login') {
          const toggle = page.locator('.app-menu-toggle');
          assert.equal(await toggle.evaluate(element => element.classList.contains('app-menu-has-update')), false);
          assert.doesNotMatch(await toggle.getAttribute('aria-label'), /มีอัปเดต/);
          await page.locator('.app-menu-close').click();
          assert.equal(await toggle.getAttribute('aria-label'), 'เปิดเมนู');
        }
        assert.equal(fixture.writes().length, 0); assert.deepEqual(fixture.errors, []);
      } finally { await fixture.close(); }
    }
  });
}

for (const embedded of [false, true]) test(`Offline first launch explains unknown version and retry never installs (${embedded ? 'desktop' : 'browser'})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000
}, async () => {
  let offline = true;
  const f = await controlFixture('login', (req, res) => {
    if (req.path !== '/system/update-check') return false;
    res.status(offline ? 503 : 200).json(offline ? { checked: false } : { checked: true, upToDate: false, remoteMessage: 'Fixture version' }); return true;
  }, { embedded });
  try {
    const { page } = f;
    await page.locator('#updateCheckStatus[data-stale="true"]').waitFor();
    assert.match(await page.locator('#updateCheckMessage').innerText(), /ตรวจเวอร์ชันไม่ได้.*ยังไม่เคยตรวจสำเร็จ/);
    await page.locator('#adminForm [name=username]').fill('synthetic-user');
    offline = false; await page.locator('#updateCheckRetry').click();
    await page.waitForFunction(() => document.getElementById('updateCheckStatus').dataset.stale === 'false' && !document.getElementById('updateBanner').classList.contains('hidden'));
    assert.equal(await page.locator('#adminForm [name=username]').inputValue(), 'synthetic-user');
    assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
