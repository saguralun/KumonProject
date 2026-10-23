import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';

test('Login update button requires an admin login and confirmation, then verifies a new runtime before redirecting', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 }, async () => {
    const app = express(); app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), updates = [], errors = [];
        let role = 'instructor', updated = false, allowLogin = false;
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('dialog', (dialog) => dialog.accept());
        await page.route('**/api/**', (route) => {
            const pathname = new URL(route.request().url()).pathname;
            let data = { success: true }, status = 200;
            if (pathname === '/api/system/update-check') data = { checked: true, upToDate: false, remoteMessage: 'Fixture update available' };
            if (pathname === '/api/auth/login/admin') {
                if (allowLogin) data.user = { role };
                else { data = { success: false, error: 'Fixture wrong password' }; status = 401; }
            }
            if (pathname === '/api/system/runtime') data = { instanceId: updated ? 'new' : 'old' };
            if (pathname === '/api/system/update-apply') { assert.equal(role, 'admin'); updates.push(pathname); updated = true; data = { success: true, previousInstanceId: 'old' }; }
            return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/login.html`);
        await page.locator('#loginUpdateButton').waitFor();
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-login-update-mobile.png'), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.locator('#loginUpdateButton').click();
        assert.equal(updates.length, 0);
        await page.locator('[name=username]').fill('fixture'); await page.locator('[name=password]').fill('fixture-only');
        await page.locator('#adminSubmit').click();
        await page.waitForFunction(() => document.getElementById('loginMessage').textContent.includes('wrong password'));
        assert.equal(updates.length, 0);
        allowLogin = true; await page.locator('#adminSubmit').click();
        await page.waitForFunction(() => document.getElementById('loginMessage').textContent.includes('ไม่มีสิทธิ์'));
        assert.equal(updates.length, 0);
        role = 'admin'; await page.locator('#adminSubmit').click();
        await page.waitForURL('**/worksheet.html');
        assert.equal(updates.length, 1); assert.equal(updated, true); assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
