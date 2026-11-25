import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { controlFixture } from './support/controlFixture.js';
import { worksheetModalFixture } from './support/worksheetModalFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 40000 };
for (const embedded of [false, true]) {
  const surface = embedded ? 'desktop' : 'browser';
  test(`WS Save explains disabled states and remains readable without changing eligibility (${surface})`, ui, async () => {
    const f = await worksheetModalFixture(embedded);
    try {
      const { page } = f;
      assert.match(await page.locator('#saveHint').innerText(), /เลือกเด็ก/);
      await f.load();
      await page.waitForFunction(() => !document.getElementById('saveButton').disabled);
      assert.match(await page.locator('#saveHint').innerText(), /พร้อมบันทึก/);
      const contrast = await page.locator('#saveButton').evaluate(el => {
        const rgb = s => [...s.matchAll(/[\d.]+/g)].slice(0, 3).map(m => Number(m[0]) / 255);
        const lum = values => values.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
        const style = getComputedStyle(el), a = lum(rgb(style.color)), b = lum(rgb(style.backgroundColor));
        return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      });
      assert.ok(contrast >= 4.5, `Save text contrast ${contrast}`);
      for (const [width, height] of [[1366, 768], [1024, 768]]) {
        await page.setViewportSize({ width, height });
        await page.locator('#saveHint').waitFor();
        assert.equal(await page.locator('#saveHint').count(), 1); assert.equal(await page.locator('#saveButton').count(), 1);
        for (const selector of ['#saveButton', '#saveHint', '#receiveDate', '[data-ws-input][data-kind=main]']) {
          const box = await page.locator(selector).first().boundingBox();
          assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, selector);
        }
        await page.screenshot({ path: path.resolve(`logs/round8-ws-${surface}-${width}.png`) });
      }
      await page.locator('#receiveDate').fill('');
      assert.equal(await page.locator('#saveButton').isDisabled(), true);
      assert.match(await page.locator('#saveHint').innerText(), /วันที่รับ/);
      assert.equal(await page.locator('#saveButton').getAttribute('aria-describedby'), 'saveHint');
      assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`KSIS groups include blocked/skipped/off-page rows and shared audit retains its scope (${surface})`, ui, async () => {
    const html = (await fs.readFile('public/ksis.html', 'utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    const f = await controlFixture('ui-review-fixture', (req, res) => {
      if (req.path !== '/ui-fixture') return false;
      res.type('html').send(html); return true;
    }, { embedded });
    try {
      const { page } = f;
      await page.goto(f.origin + '/api/ui-fixture');
      await page.addScriptTag({ url: f.origin + '/js/htmlUtil.js' });
      await page.evaluate(async () => {
        window.fixtureSubscriptions = {};
        const shared = { subscribe: (key, callback) => { window.fixtureSubscriptions[key] = callback; } };
        const base = { key: 'ready', name: 'Ready child', subject: 'ME', kumonId: '7642650000001', ready: true,
          before: { level: { value: 'A' }, worksheet: { value: 10 }, used: { value: 1 }, status: { value: 'C' } },
          desired: { level: 'A', worksheet: 20, used: 2, status: 'C' } };
        window.fixturePreview = { previewId: 'fixture', period: { month: 11, year: 2026 }, page: 1, subject: 'ALL', context: 'Fixture', rows: [base,
          { ...base, key: 'blocked', name: 'Blocked child', before: null, ready: false, reason: 'รูปแบบรหัสคุมองไม่ถูกต้อง' },
          { ...base, key: 'skip', name: 'Skipped child', ready: false, skipped: true, reason: 'ข้าม A' },
          { ...base, key: 'outside', name: 'Outside child', before: null, ready: false, outsidePage: true, reason: 'ไม่อยู่ในหน้าปัจจุบัน' }] };
        (await import('/js/reportKsisDraft.js')).setupKsisDraft({ shared, open() {}, getPeriod: () => ({ month: 11, year: 2026 }), setStatus() {} });
        (await import('/js/ksisAudit.js')).setupKsisAudit({ shared, getPeriod() {}, setStatus() {}, onStateChange() {} });
        window.fixtureSubscriptions.draft({ preview: window.fixturePreview, confirmed: [], subject: 'ALL' }, { active: true, busy: false });
        window.fixtureSubscriptions.audit({ subject: 'ME', result: { context: 'Fixture', scope: 'current', originalPage: 3, pagesRead: 1,
          period: { month: 11, year: 2026 }, subject: 'ME', verifiedAt: '2026-11-24T12:00:00Z', outsidePage: 20,
          ignoredBlankRows: 2, repeatedRows: 1, rows: [], counts: {} } }, { busy: false });
      });
      for (const group of ['ready', 'review', 'skipped', 'outside']) assert.equal(await page.locator(`#ksisDraftRows [data-ksis-group="${group}"]`).count(), 1);
      assert.match(await page.locator('#ksisDraftRows [data-ksis-group=review]').innerText(), /Blocked child.*รูปแบบรหัสคุมอง/s);
      assert.match(await page.locator('#ksisAuditSource').innerText(), /หน้าที่เลือก 3.*11\/2026.*ME.*นอกหน้าที่ตรวจ 20/s);
      assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
