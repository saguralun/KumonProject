import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) {
    test(`Stock stale quantity refreshes the latest amount before a deliberate retry (${embedded ? 'desktop' : 'browser'})`, {
        skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000
    }, async () => {
        let quantity = 10, patches = [];
        const f = await controlFixture('stock-receive', async (req, res) => {
            if (req.path.endsWith('/masters')) { res.json({ masters: { subjects: [], levels: [], worksheets: [], cds: [] } }); return true; }
            const order = { doId: 1, doNo: 'STALE-ONLY', type: 'ws', isStockProcessed: false,
                items: [{ receiveId: 2, quantity, type: 'ws', subjectCode: 'ME', levelCode: 'A', itemNo: 1 }] };
            if (req.path === '/stock-receive/dos') { res.json({ rows: [order] }); return true; }
            if (req.path === '/stock-receive/dos/1') { res.json({ deliveryOrder: order }); return true; }
            if (req.method === 'PATCH') {
                patches.push(req.body);
                if (req.body.expectedQuantity !== quantity) res.status(409).json({ error: `รายการนี้เปลี่ยนแล้ว จำนวนล่าสุด ${quantity}` });
                else { quantity = req.body.quantity; res.json({ success: true }); }
                return true;
            }
            return false;
        }, { embedded });
        try {
            const { page } = f;
            await page.locator('tr[data-do-id="1"]').click(); await page.locator('.do-item-qty-input').waitFor();
            quantity = 15;
            await page.locator('.do-item-qty-input').fill('12'); await page.locator('.do-item-qty-input').press('Tab');
            await page.waitForFunction(() => document.querySelector('.do-item-qty-input')?.value === '15' && !document.getElementById('doDetailBody').inert);
            assert.equal(quantity, 15); assert.match(await page.locator('#statusLine').innerText(), /ล่าสุด 15.*12/);
            await page.locator('.do-item-qty-input').fill('12'); await page.locator('.do-item-qty-input').press('Tab');
            await page.waitForFunction(() => document.querySelector('.do-item-qty-input')?.value === '12' && !document.getElementById('doDetailBody').inert);
            assert.equal(quantity, 12);
            assert.deepEqual(patches, [{ quantity: 12, expectedQuantity: 10 }, { quantity: 12, expectedQuantity: 15 }]);
            assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
    test(`Stock quantities survive same-subject clicks and cancelled level changes (${embedded ? 'desktop' : 'browser'})`, {
        skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000
    }, async () => {
        const f = await controlFixture('stock-receive', async (req, res) => {
            if (req.path === '/stock-receive/masters') {
                res.json({ masters: { subjects: [{ subjectId: 1, subjectCode: 'ME', subjectName: 'Math' }],
                    levels: [{ levelMasterId: 1, subjectId: 1, levelCode: 'A' }, { levelMasterId: 2, subjectId: 1, levelCode: 'B' }],
                    worksheets: [{ worksheetMasterId: 11, levelMasterId: 1, worksheetNo: 1 }, { worksheetMasterId: 21, levelMasterId: 2, worksheetNo: 1 }], cds: [] } }); return true;
            }
            if (req.path === '/stock-receive/dos') { res.json({ rows: [] }); return true; }
            return false;
        }, { embedded });
        try {
            const { page } = f;
            await page.locator('#levelSelect').selectOption('1');
            await page.locator('[data-master-id="11"]').fill('5');
            await page.locator('#subjectButtons [data-subject-id="1"]').click();
            assert.equal(await page.locator('[data-master-id="11"]').inputValue(), '5');
            await page.locator('#levelSelect').selectOption('2');
            await page.locator('#appActionDialog').waitFor();
            await f.choose(false);
            // Native dialog.close queues its close event. Wait for the prior
            // choice to finish before starting another level change.
            await page.waitForFunction(() => !document.getElementById('appActionDialog'));
            assert.equal(await page.locator('#levelSelect').inputValue(), '1');
            assert.equal(await page.locator('[data-master-id="11"]').inputValue(), '5');
            await page.locator('#levelSelect').selectOption('2'); await f.choose(true);
            await page.locator('[data-master-id="21"]').waitFor();
            assert.equal(await page.locator('[data-master-id="21"]').inputValue(), '');
            assert.deepEqual(f.writes(), []); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
}
