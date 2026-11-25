import assert from 'node:assert/strict';
import { test } from 'node:test';
import { worksheetModalFixture } from './support/worksheetModalFixture.js';
import path from 'node:path';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000 };
const focusId = page => page.evaluate(() => document.activeElement?.id);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

for (const embedded of [false, true]) {
    const surface = embedded ? 'desktop' : 'browser';
    test(`Incomplete WS owns focus, traps Tab, blocks background focus and restores its opener (${surface})`, ui, async () => {
        const f = await worksheetModalFixture(embedded);
        try {
            const { page } = f;
            await page.locator('#findIncompleteWs').click();
            await page.locator('#incompleteWsTableWrap tbody tr').first().waitFor();
            assert.equal(await page.locator('#incompleteWsModal').evaluate(el => el.open), true);
            assert.equal(await focusId(page), 'incompleteWsClose');
            await page.locator('#studentSearch').evaluate(el => el.focus());
            assert.equal(await page.locator('#incompleteWsModal').evaluate(el => el.contains(document.activeElement)), true);
            await page.locator('#incompleteWsClose').focus(); await page.keyboard.press('Shift+Tab');
            assert.equal(await page.locator('#incompleteWsModal').evaluate(el => el.contains(document.activeElement)), true);
            await page.keyboard.press('Tab'); assert.equal(await focusId(page), 'incompleteWsClose');
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#incompleteWsModal').isVisible(), false);
            assert.equal(await focusId(page), 'findIncompleteWs'); assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });

    test(`Incomplete WS selects exactly one child with Enter, Space or an existing row click (${surface})`, ui, async () => {
        const f = await worksheetModalFixture(embedded);
        try {
            const { page } = f;
            for (const key of ['Enter', 'Space', 'mouse']) {
                await page.locator('#findIncompleteWs').click();
                const button = page.locator('[data-select-incomplete-id="11"]'); await button.waitFor();
                const before = f.requests.filter(request => request.path.endsWith('/context')).length;
                if (key === 'mouse') await page.locator('[data-incomplete-enrollment-id="11"] td').last().click();
                else { await button.focus(); await page.keyboard.press(key); }
                await page.waitForFunction(() => document.getElementById('studentSearch').value.startsWith('#11 ') && document.activeElement?.matches('[data-ws-input][data-kind=main]'));
                assert.equal(await page.locator('#incompleteWsModal').isVisible(), false);
                assert.equal(f.requests.filter(request => request.path.endsWith('/context')).length, before + 1, key);
            }
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });

    test(`AT keeps Enter shortcuts, allows natural Tab order and restores either opener on Escape (${surface})`, ui, async () => {
        const f = await worksheetModalFixture(embedded);
        try {
            const { page } = f; await f.load();
            for (const opener of ['completeWsLevel', 'editLastAtButton']) {
                await page.locator('#' + opener).click();
                assert.equal(await page.locator('#atModal').evaluate(el => el.open), true);
                assert.equal(await focusId(page), 'atScore');
                await page.locator('#atScore').fill('80'); await page.keyboard.press('Enter'); assert.equal(await focusId(page), 'atTime');
                await page.locator('#atTime').fill('5'); await page.keyboard.press('Enter'); assert.equal(await focusId(page), 'atGroup');
                await page.keyboard.press('Tab');
                assert.equal(await page.locator('[data-at-pass=false]').evaluate(el => el === document.activeElement), true);
                await page.keyboard.press('Shift+Tab'); assert.equal(await focusId(page), 'atGroup');
                await page.keyboard.press('Enter'); assert.equal(await focusId(page), 'atSaveButton');
                await page.keyboard.press('Tab'); assert.equal(await focusId(page), 'atCancel');
                await page.keyboard.press('Shift+Tab'); assert.equal(await focusId(page), 'atSaveButton');
                await page.locator('#studentSearch').evaluate(el => el.focus());
                assert.equal(await page.locator('#atModal').evaluate(el => el.contains(document.activeElement)), true);
                await page.keyboard.press('Escape');
                assert.equal(await page.locator('#atModal').isVisible(), false); assert.equal(await focusId(page), opener);
            }
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });

    test(`AT pending save resists Escape, backdrop and duplicate submits; failure remains visible and retry succeeds (${surface})`, ui, async () => {
        const f = await worksheetModalFixture(embedded), release = deferred();
        try {
            const { page } = f; await f.load();
            await page.locator('#completeWsLevel').click();
            await page.locator('#atScore').fill('80'); await page.locator('#atTime').fill('5');
            f.config.holdSave = release.promise; f.config.failSave = true;
            const request = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/at-completion'));
            await page.locator('#atSaveButton').click(); await request;
            assert.equal(await page.locator('#atCancel').isDisabled(), true);
            await page.keyboard.press('Escape'); await page.keyboard.press('Tab');
            assert.equal(await focusId(page), 'atModal');
            await page.locator('#atModal').click({ position: { x: 2, y: 2 } });
            await page.locator('#atForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
            assert.equal(await page.locator('#atModal').evaluate(el => el.open), true); assert.equal(f.writes().length, 1);
            release.resolve();
            await page.locator('#atModalMessage').waitFor();
            await page.waitForFunction(() => !document.getElementById('atSaveButton').disabled);
            assert.match(await page.locator('#atModalMessage').innerText(), /Synthetic AT failure/);
            assert.equal(await page.locator('#atScore').inputValue(), '80'); assert.equal(await page.locator('#atTime').inputValue(), '5');
            assert.equal(await focusId(page), 'atSaveButton');
            f.config.failSave = false;
            await page.keyboard.press('Enter');
            await page.waitForFunction(() => !document.getElementById('atModal').open && document.activeElement?.matches('[data-ws-input][data-kind=main]'));
            assert.equal(f.writes().length, 2); assert.deepEqual(f.writes()[0].body, f.writes()[1].body);
            assert.deepEqual(f.errors, []);
        } finally { release.resolve(); await f.close(); }
    });

    test(`Incomplete WS keyboard paging retains focus, section and mouse backdrop behavior (${surface})`, ui, async () => {
        const f = await worksheetModalFixture(embedded);
        try {
            const { page } = f; await page.locator('#findIncompleteWs').click();
            const next = page.locator('[data-incomplete-section=regular][data-incomplete-page=next]');
            await next.focus(); await page.keyboard.press('Enter');
            await page.locator('[data-select-incomplete-id="12"]').waitFor();
            assert.equal(await page.evaluate(() => document.activeElement?.dataset.incompletePage), 'prev');
            assert.equal(await page.locator('[data-select-incomplete-id="13"]').count(), 1);
            await page.keyboard.press('Enter');
            await page.locator('[data-select-incomplete-id="11"]').waitFor();
            assert.equal(await page.evaluate(() => document.activeElement?.dataset.incompletePage), 'next');
            await page.locator('#incompleteWsModal').click({ position: { x: 2, y: 2 } });
            assert.equal(await page.locator('#incompleteWsModal').isVisible(), false); assert.equal(await focusId(page), 'findIncompleteWs');
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });

    test(`Incomplete WS ignores old success and failure after close/reopen (${surface})`, ui, async () => {
        const f = await worksheetModalFixture(embedded); let release;
        try {
            const { page } = f;
            for (const fail of [false, true]) {
                release = deferred();
                f.config.read = async (_req, res) => {
                    const gate = release; await gate.promise;
                    res.status(fail ? 503 : 200).json(fail ? { error: 'OLD incomplete error' } : {
                        cutoffDate: '2020-01-21', regular: { rows: [f.row(777)] }, kc: { rows: [] }
                    }); return true;
                };
                const first = page.waitForRequest(request => request.url().includes('/incomplete-ws'));
                await page.locator('#findIncompleteWs').click(); await first;
                await page.keyboard.press('Escape');
                assert.equal(await focusId(page), 'findIncompleteWs');
                f.config.read = null;
                await page.locator('#findIncompleteWs').click(); await page.locator('[data-select-incomplete-id="11"]').waitFor();
                const response = page.waitForResponse(response => response.url().includes('/incomplete-ws'));
                release.resolve(); await (await response).finished();
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                assert.equal(await page.locator('[data-select-incomplete-id="11"]').count(), 1);
                assert.equal(await page.locator('[data-select-incomplete-id="777"]').count(), 0);
                assert.doesNotMatch(await page.locator('#statusLine').innerText(), /OLD incomplete error/);
                assert.equal(await focusId(page), 'incompleteWsClose'); await page.keyboard.press('Escape');
            }
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { release?.resolve(); await f.close(); }
    });

    test(`Nested notice closes only itself and both worksheet modals fit PC/tablet screens (${surface})`, ui, async () => {
        const f = await worksheetModalFixture(embedded);
        try {
            const { page } = f; await f.load(); await page.locator('#completeWsLevel').click();
            await page.locator('#atScore').fill('80');
            await page.evaluate(() => { void showAppMessage('Synthetic notice'); });
            await page.locator('#appActionDialog').waitFor(); await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.getElementById('appActionDialog'));
            assert.equal(await page.locator('#atModal').evaluate(el => el.open), true);
            assert.equal(await page.locator('#atScore').inputValue(), '80'); assert.equal(await focusId(page), 'atScore');
            for (const [width, height] of [[1366, 768], [1024, 768]]) {
                await page.setViewportSize({ width, height });
                for (const selector of ['.at-dialog', '#atCancel', '#atSaveButton']) {
                    const box = await page.locator(selector).boundingBox();
                    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, selector);
                }
                await page.screenshot({ path: path.resolve(`logs/modal-at-${surface}-${width}.png`) });
            }
            await page.keyboard.press('Escape'); await page.locator('#findIncompleteWs').click();
            await page.locator('[data-select-incomplete-id="11"]').waitFor();
            for (const [width, height] of [[1366, 768], [1024, 768]]) {
                await page.setViewportSize({ width, height });
                const box = await page.locator('.incomplete-ws-dialog').boundingBox();
                assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1);
                await page.screenshot({ path: path.resolve(`logs/modal-incomplete-${surface}-${width}.png`) });
            }
            await page.keyboard.press('Escape'); assert.equal(await focusId(page), 'findIncompleteWs');
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
}
