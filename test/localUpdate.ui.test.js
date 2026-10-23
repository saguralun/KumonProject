import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

test('Local staff can update in-app without an admin session', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 }, async () => {
    const app = express(); app.use(express.static('public'));
    app.get('/fixture', (_req, res) => res.send('<div id="authBar"></div><script src="/js/appDialogs.js"></script><script src="/js/authClient.js"></script>'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(), updates = [], errors = [];
        let updated = false, confirm = false, loads = 0;
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/**', (route) => {
            const pathname = new URL(route.request().url()).pathname;
            let data = { success: true };
            if (pathname === '/api/auth/me') { loads++; data.user = { role: 'staff', displayName: 'Fixture staff' }; }
            if (pathname === '/api/system/update-check') data = { checked: true, upToDate: false };
            if (pathname === '/api/system/runtime') data.instanceId = updated ? 'new' : 'old';
            if (pathname === '/api/system/update-apply') { updates.push(route.request().postDataJSON()); updated = true; data.previousInstanceId = 'old'; }
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/fixture`);
        await page.locator('#authUpdateButton').waitFor();
        await page.locator('#authUpdateButton').click(); await page.locator('#appDialogCancel').click(); assert.equal(updates.length, 0);
        confirm = true; await page.locator('#authUpdateButton').click(); await page.locator('#appDialogConfirm').click();
        await page.waitForResponse((response) => response.url().includes('/api/auth/me'));
        assert.deepEqual(updates, [{ confirm: true }]); assert.equal(loads, 2); assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
