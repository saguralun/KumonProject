import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) {
  test(`DO detail, quantity, item delete, Process and whole-DO delete stay on the visible delivery note (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    let lateFirst, notifyFirst, releaseQuantity, failProcess = true, delayFirst = true;
    const firstStarted = new Promise(resolve => { notifyFirst = resolve; });
    const orders = [1, 2].map(doId => ({ doId, doNo: `FIX-${doId}`, type: 'ws', receiveDate: '2026-10-01', outDate: '2026-10-01', receiveMonth: 10, receiveYear: 2026, isStockProcessed: false, itemCount: 1, totalQuantity: 3,
      items: [{ receiveId: doId * 10, type: 'ws', subjectCode: 'ME', levelCode: 'A', itemNo: 1, quantity: 3 }] }));
    const f = await controlFixture('stock-receive', async (req, res) => {
      if (req.path === '/stock-receive/masters') { res.json({ success: true, masters: { subjects: [], levels: [], worksheets: [], cds: [] } }); return true; }
      if (req.path === '/stock-receive/dos') { res.json({ success: true, rows: orders }); return true; }
      const match = req.path.match(/^\/stock-receive\/dos\/(\d+)(?:\/items\/(\d+)|\/(process))?$/);
      if (!match) return;
      const id = Number(match[1]), order = orders.find(item => item.doId === id);
      if (req.method === 'PATCH') { await new Promise(resolve => { releaseQuantity = resolve; }); order.items[0].quantity = req.body.quantity; }
      if (req.method === 'DELETE' && match[2]) order.items = [];
      if (req.method === 'DELETE' && !match[2]) orders.splice(orders.indexOf(order), 1);
      if (req.method === 'POST') {
        assert.equal(id, 2, 'Only the visible second DO may be processed');
        if (failProcess) { res.status(503).json({ success: false, error: 'Fixture Process failed' }); return true; }
        order.isStockProcessed = true; res.json({ success: true, doNo: order.doNo, itemsProcessed: 1 }); return true;
      }
      const send = () => res.json({ success: true, deliveryOrder: order });
      if (req.method === 'GET' && id === 1 && delayFirst) { delayFirst = false; lateFirst = () => { send(); lateFirst = null; }; notifyFirst(); }
      else send();
      return true;
    }, { embedded });
    try {
      const { page } = f;
      await page.locator('tr[data-do-id="1"]').click(); await firstStarted;
      await page.locator('tr[data-do-id="2"]').click(); await page.waitForFunction(() => document.getElementById('doDetailTitle').textContent === 'DO FIX-2');
      lateFirst(); await page.waitForTimeout(80); assert.equal(await page.locator('#doDetailTitle').innerText(), 'DO FIX-2');
      await page.locator('#doProcessButton').click(); await f.choose(false); assert.equal(f.writes().length, 0);
      await page.locator('#doProcessButton').click(); await f.choose(true); await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture Process failed'));
      assert.equal(await page.locator('#doProcessButton').isEnabled(), true);
      failProcess = false; await page.locator('#doProcessButton').click(); await f.choose(true); await page.locator('#doDetailModal').waitFor({ state: 'hidden' });
      await page.locator('tr[data-do-id="2"]').click(); await page.locator('#doDetailModal').waitFor();
      assert.equal(await page.locator('#doProcessButton').isVisible(), false); assert.equal(await page.locator('#doDeleteButton').isVisible(), false);
      await page.locator('#doDetailClose').click(); await page.locator('tr[data-do-id="1"]').click(); await page.locator('.do-item-qty-input').waitFor();
      await page.locator('.do-item-qty-input').fill('4'); await page.locator('.do-item-qty-input').press('Tab');
      assert.equal(await page.locator('#doProcessButton').isDisabled(), true);
      await page.locator('#doProcessButton').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      assert.equal(await page.locator('#appActionDialog').count(), 0); releaseQuantity();
      await page.waitForFunction(() => document.querySelector('.do-item-qty-input')?.value === '4' && !document.querySelector('.do-item-qty-input').disabled);
      await page.locator('[data-delete-receive-id]').click(); await f.choose(false);
      const before = f.writes().length;
      await page.locator('[data-delete-receive-id]').click(); await f.choose(true); await page.locator('[data-delete-receive-id]').waitFor({ state: 'detached' });
      assert.equal(f.writes().length, before + 1);
      await page.locator('#doDeleteButton').click(); await f.choose(false);
      await page.locator('#doDeleteButton').click(); await f.choose(true); await page.locator('tr[data-do-id="1"]').waitFor({ state: 'detached' });
      assert.equal(f.writes().at(-1).path, '/stock-receive/dos/1'); assert.deepEqual(f.errors, []);
    } finally { releaseQuantity?.(); if (typeof lateFirst === 'function') lateFirst(); await f.close(); }
  });

  test(`Stock cut buttons cancel, recover a rejected cut, serialize clicks and keep WS/CD responses separate (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    let rows = [{ date: '2026-10-01', itemCount: 1, totalQuantity: 3 }], fail = true, release, lateCd;
    let notifyCd; const cdStarted = new Promise(resolve => { notifyCd = resolve; });
    const f = await controlFixture('stock-cut', async (req, res) => {
      if (req.path === '/stock-cut/pending-dates') {
        if (req.query.type === 'cd') { lateCd = () => { res.json({ success: true, rows: [{ date: '2026-09-01', itemCount: 1, totalQuantity: 99 }] }); lateCd = null; }; notifyCd(); }
        else res.json({ success: true, rows });
        return true;
      }
      if (req.path === '/stock-cut/pending-dates/2026-10-01') { res.json({ success: true, items: [{ subjectCode: 'ME', levelCode: 'A', itemNo: 1, quantity: 3, currentStock: 10, resultingStock: 7 }] }); return true; }
      if (req.path === '/stock-cut/process') {
        assert.deepEqual(req.body, { type: 'ws', dates: ['2026-10-01'] });
        if (fail) res.status(503).json({ success: false, error: 'Fixture cut failed' });
        else { await new Promise(resolve => { release = resolve; }); rows = []; res.json({ success: true, itemsProcessed: 1, recordsProcessed: 1 }); }
        return true;
      }
    }, { embedded });
    try {
      const { page } = f;
      await page.locator('#cutAllButton:enabled').waitFor();
      await page.locator('[data-item-type=cd]').click(); await cdStarted; await page.locator('[data-item-type=ws]').click();
      await page.locator('#cutAllButton:enabled').waitFor(); lateCd();
      await page.waitForTimeout(100); assert.match(await page.locator('#pendingTableWrap').innerText(), /01\/10\/2569/);
      assert.doesNotMatch(await page.locator('#pendingTableWrap').innerText(), /99/);
      await page.locator('tr[data-date]').click(); await page.locator('#cutDayButton:enabled').waitFor();
      await page.locator('#cutDayButton').click(); await f.choose(false); assert.equal(f.writes().length, 0);
      await page.locator('#detailClose').click();
      await page.locator('#cutAllButton').click(); await f.choose(true);
      await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture cut failed'));
      assert.equal(await page.locator('#cutAllButton').isEnabled(), true);
      fail = false; await page.locator('#cutAllButton').click(); await f.choose(true);
      await page.waitForFunction(() => document.getElementById('cutAllButton').disabled);
      assert.equal(await page.locator('[data-item-type=cd]').isDisabled(), true);
      await page.locator('#cutAllButton').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      assert.equal(f.writes().length, 2); release();
      await page.waitForFunction(() => document.getElementById('pendingSubtitle').textContent.includes('ไม่มีรายการ'));
      assert.equal(await page.locator('#cutAllButton').isDisabled(), true); assert.deepEqual(f.errors, []);
    } finally { release?.(); lateCd?.(); await f.close(); }
  });

  test(`Receive stock preserves failed input, cancels discard and blocks duplicate DO submissions (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    let fail = true, release;
    const f = await controlFixture('stock-receive', async (req, res) => {
      if (req.path === '/stock-receive/masters') {
        res.json({ success: true, masters: { subjects: [{ subjectId: 1, subjectCode: 'ME' }], levels: [{ levelMasterId: 1, subjectId: 1, levelCode: 'A', levelType: 1 }], worksheets: [{ levelMasterId: 1, worksheetMasterId: 101, worksheetNo: 1 }], cds: [] } }); return true;
      }
      if (req.path === '/stock-receive/dos' && req.method === 'POST') {
        assert.equal(req.body.doNo, 'FIXTURE-ONLY'); assert.deepEqual(req.body.items, [{ masterId: 101, quantity: 3 }]);
        if (fail) res.status(503).json({ success: false, error: 'Fixture DO failed' });
        else { await new Promise(resolve => { release = resolve; }); res.json({ success: true, doNo: 'FIXTURE-ONLY', appended: false }); }
        return true;
      }
    }, { embedded });
    try {
      const { page } = f;
      await page.locator('#levelSelect option[value="1"]').waitFor({ state: 'attached' });
      await page.locator('#levelSelect').selectOption('1');
      await page.locator('#doForm [name=doNo]').fill('FIXTURE-ONLY');
      const quantity = page.locator('[data-master-id="101"]'); await quantity.fill('3');
      await page.locator('#newDoButton').click(); await f.choose(false); assert.equal(await quantity.inputValue(), '3');
      await page.locator('#saveDoButton').click();
      await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture DO failed'));
      assert.equal(await page.locator('#saveDoButton').isEnabled(), true); assert.equal(await quantity.inputValue(), '3');
      assert.equal(await page.locator('#doFormPanel').evaluate(e => e.inert), false);
      fail = false; await page.locator('#saveDoButton').click();
      assert.equal(await page.locator('#doFormPanel').evaluate(e => e.inert), true);
      await page.locator('#doForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(f.writes().length, 2); release();
      await page.waitForFunction(() => !document.getElementById('doFormPanel').inert);
      assert.equal(await quantity.inputValue(), ''); assert.equal(await page.locator('#saveDoButton').isDisabled(), true);
      assert.deepEqual(f.errors, []);
    } finally { release?.(); await f.close(); }
  });
}
