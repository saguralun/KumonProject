import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) for (const type of ['ws', 'cd']) {
    test(`DO ${type} retains operation after lost response and reload, then permits intentional equal append (${embedded ? 'desktop' : 'browser/tablet'})`, {
        skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000
    }, async () => {
        const receipts = new Map(), keys = [];
        let quantity = 0, dropResponse = true, rejectNext = false;
        const f = await controlFixture('stock-receive', async (req, res) => {
            if (req.path === '/stock-receive/masters') {
                res.json({ success: true, retryScope: { epoch: '00000000-0000-4000-8000-000000000001', actor: 'fixture' }, masters: {
                    subjects: [{ subjectId: 1, subjectCode: 'ME' }], levels: [{ levelMasterId: 1, subjectId: 1, levelCode: 'A' }],
                    worksheets: [{ levelMasterId: 1, worksheetMasterId: 101, worksheetNo: 1 }], cds: [{ levelMasterId: 1, cdMasterId: 101, cdNo: 1 }]
                } }); return true;
            }
            if (req.path === '/stock-receive/dos' && req.method === 'POST') {
                assert.equal(req.body.type, type); assert.equal(req.body.items[0].quantity, 10);
                assert.match(req.body.operationKey, /^[\da-f-]{36}:[\da-f]{32}$/);
                const key = req.body.operationKey; keys.push(key);
                if (rejectNext) { rejectNext = false; res.status(400).json({ success: false, retrySafe: true, error: 'Synthetic validation failure' }); return true; }
                if (!receipts.has(key)) {
                    quantity += 10;
                    receipts.set(key, { success: true, doId: 701, doNo: 'SYNTHETIC-ONLY', appended: quantity > 10 });
                }
                if (dropResponse) {
                    dropResponse = false;
                    // Send an incomplete response body so Chromium cannot
                    // transparently retry the POST before JS observes failure.
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.flushHeaders(); res.write('{"success":');
                    setTimeout(() => res.destroy(), 30);
                }
                else res.json(receipts.get(key));
                return true;
            }
        }, { embedded });
        try {
            const { page } = f;
            if (!embedded) await page.setViewportSize({ width: 1024, height: 768 });
            await page.locator('[data-item-type="cd"]').waitFor();
            if (type === 'cd') await page.locator('[data-item-type="cd"]').click();
            else await page.locator('#levelSelect').selectOption('1');
            await page.locator('#doForm [name=doNo]').fill('SYNTHETIC-ONLY');
            const input = page.locator('[data-master-id="101"]'); await input.fill('10');
            await page.locator('#saveDoButton').click();
            await page.waitForFunction(() => !document.getElementById('doFormPanel').inert);
            assert.equal(quantity, 10); assert.equal(await input.inputValue(), '10');
            // An edited ambiguous retry must not silently become a fresh append.
            await input.fill('11'); await page.locator('#saveDoButton').click();
            await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('มีคำขอ DO'));
            assert.equal(keys.length, 1);
            // This scenario intentionally reloads to recover the durable retry.
            // Leave protection itself is checked separately in leaveGuard.ui.
            await page.evaluate(() => window.kumonLeaveGuard?.allowNextUnload());
            await page.reload();
            await page.waitForFunction(() => document.querySelector('[data-master-id="101"]')?.value === '10');
            assert.equal(await page.locator('#doForm [name=doNo]').inputValue(), 'SYNTHETIC-ONLY');
            await page.locator('#saveDoButton').click();
            await page.waitForFunction(() => !document.getElementById('doFormPanel').inert && document.querySelector('[data-master-id="101"]').value === '');
            assert.equal(keys[0], keys[1]); assert.equal(quantity, 10);
            assert.equal(await page.evaluate(() => localStorage.getItem('kumondb.stock-receive.pending.v1')), null);
            // Confirmed success releases the key: ten more is a deliberate append.
            await input.fill('10'); await page.locator('#saveDoButton').click();
            await page.waitForFunction(() => !document.getElementById('doFormPanel').inert && document.querySelector('[data-master-id="101"]').value === '');
            assert.notEqual(keys[2], keys[1]); assert.equal(quantity, 20);
            // Definite validation rejection permits correction without discarding
            // an ambiguous operation or losing the entered quantity.
            rejectNext = true; await input.fill('10'); await page.locator('#saveDoButton').click();
            await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Synthetic validation failure'));
            assert.equal(await input.inputValue(), '10');
            assert.equal(await page.evaluate(() => localStorage.getItem('kumondb.stock-receive.pending.v1')), null);
            await page.locator('#saveDoButton').click();
            await page.waitForFunction(() => !document.getElementById('doFormPanel').inert && document.querySelector('[data-master-id="101"]').value === '');
            assert.notEqual(keys[3], keys[4]); assert.equal(quantity, 30);
            assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
}
