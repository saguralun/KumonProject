import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';
const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 40000 };
for (const embedded of [false, true]) {
    test(`Stock search ignores late results and late errors from the previous query (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
        let release, notify, fail = false;
        let started;
        const order = doNo => ({ doId: doNo === 'FRESH' ? 2 : 1, doNo, type: 'ws', outDate: '2026-11-20', receiveDate: '2026-11-20', itemCount: 1, totalQuantity: 1 });
        const f = await controlFixture('stock-receive', async (req, res) => {
            if (req.path.endsWith('/masters')) { res.json({ masters: { subjects: [], levels: [], worksheets: [], cds: [] } }); return true; }
            if (req.path === '/stock-receive/dos') {
                if (req.query.query === 'old') {
                    notify(); await new Promise(resolve => { release = resolve; });
                    if (fail) res.status(503).json({ error: 'OLD SEARCH ERROR' }); else res.json({ rows: [order('OLD')] });
                } else res.json({ rows: [order('FRESH')] });
                return true;
            }
            return false;
        }, { embedded });
        try {
            for (fail of [false, true]) {
                started = new Promise(resolve => { notify = resolve; });
                await f.page.locator('#doSearch').fill('old'); await started;
                await f.page.locator('#doSearch').fill(fail ? 'new-error' : 'new');
                await f.page.waitForResponse(r => r.url().includes('query=new'));
                const response = f.page.waitForResponse(r => r.url().includes('query=old'));
                release(); await (await response).finished();
                await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                assert.match(await f.page.locator('#doTableWrap').innerText(), /FRESH/);
                assert.doesNotMatch(await f.page.locator('#doTableWrap').innerText(), /OLD/);
            }
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { release?.(); await f.close(); }
    });
    test(`Stock cut states physical quantities including zero without guessing legacy missing values (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
        let cutQuantity = 3;
        const f = await controlFixture('stock-cut', async (req, res) => {
            if (req.path === '/stock-cut/pending-dates') { res.json({ rows: [{ date: '2026-11-20', itemCount: 2, totalQuantity: 4, ...(cutQuantity === undefined ? {} : { cutQuantity }) }] }); return true; }
            return false;
        }, { embedded });
        try {
            for (cutQuantity of [3, 0, undefined]) {
                await f.page.reload(); await f.page.locator('#cutAllButton:enabled').waitFor();
                const subtitle = await f.page.locator('#pendingSubtitle').innerText();
                assert.match(subtitle, /4 รายการบันทึก/);
                await f.page.locator('#cutAllButton').click();
                const confirmation = await f.page.locator('#appActionDialog').innerText();
                if (cutQuantity === undefined) assert.match(confirmation, /ไม่ทราบจำนวนตัดจริง/);
                else { assert.match(subtitle, new RegExp(`ตัดคลังจริง ${cutQuantity}`)); assert.match(confirmation, new RegExp(`ตัดคลังจริง ${cutQuantity}`)); }
                await f.choose(false);
            }
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
}
