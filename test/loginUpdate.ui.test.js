import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

test('Login update requires confirmation but no credentials, recovers errors and waits for the new runtime', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 }, async () => {
    const app = express(); app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), updates = [], errors = [], logins = [];
        let updated = false, failUpdate = true, confirm = false, loads = 0;
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/**', (route) => {
            const pathname = new URL(route.request().url()).pathname;
            let data = { success: true }, status = 200;
            if (pathname === '/api/system/update-check') { loads++; data = { checked: true, upToDate: false, remoteMessage: 'Fixture update available' }; }
            if (pathname.startsWith('/api/auth/login')) logins.push(pathname);
            if (pathname === '/api/system/runtime') data = { instanceId: updated ? 'new' : 'old' };
            if (pathname === '/api/system/update-apply') {
                assert.deepEqual(route.request().postDataJSON(), { confirm: true });
                updates.push(pathname);
                if (failUpdate) { data = { success: false, error: 'Fixture update unavailable' }; status = 503; }
                else data = { success: true, previousInstanceId: 'old' };
            }
            return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/login.html`);
        await page.locator('#loginUpdateButton').waitFor();
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-login-update-mobile.png'), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.locator('#loginUpdateButton').click();
        await page.locator('#appActionDialog').waitFor();
        assert.match(await page.locator('#appDialogMessage').textContent(), /สำรองก่อนปรับส่วนที่ขาด/);
        assert.equal(await page.locator('#appDialogMessage').evaluate(element => element.scrollWidth <= element.clientWidth), true);
        const dialogBounds = await page.locator('#appActionDialog').boundingBox();
        assert.ok(dialogBounds.x >= 0 && dialogBounds.y >= 0 && dialogBounds.x + dialogBounds.width <= 390 && dialogBounds.y + dialogBounds.height <= 844);
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-schema-update-confirmation-mobile.png'), fullPage: true });
        await page.locator('#appDialogCancel').click();
        assert.equal(updates.length, 0);
        confirm = true; await page.locator('#loginUpdateButton').click(); await page.locator('#appDialogConfirm').click();
        await page.waitForFunction(() => document.getElementById('loginMessage').textContent.includes('unavailable'));
        for (const id of ['loginUpdateButton', 'adminSubmit', 'guestSubmit']) assert.equal(await page.locator(`#${id}`).isEnabled(), true);
        failUpdate = false; await page.locator('#loginUpdateButton').click(); await page.locator('#appDialogConfirm').click();
        await page.waitForFunction(() => document.getElementById('loginMessage').textContent.includes('กำลังรอ'));
        assert.equal(await page.locator('#adminSubmit').isDisabled(), true); assert.equal(loads, 1);
        updated = true;
        await page.waitForResponse((response) => response.url().includes('/api/system/update-check'));
        assert.equal(loads, 2); assert.equal(updates.length, 2); assert.deepEqual(logins, []); assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
