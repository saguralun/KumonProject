import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createKsisDesktop } from '../services/ksisDesktop.js';
import { chromium } from 'playwright-core';

test('Embedded Chromium keeps KSIS alive across tool tabs and local reload, with isolated remote content and clamped layout', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 50000
}, async () => {
    const profileDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'kumon-embedded-test-'));
    const app = express(); app.use(express.json());
    app.get('/api/auth/me', (_req, res) => res.json({ user: { role: 'admin', displayName: 'Desktop Test', userId: 1 }, permissions: ['*'] }));
    app.get('/api/system/update-check', (_req, res) => res.json({ checked: false }));
    app.post('/api/ksis/draft/preview', (_req, res) => res.json({ success: true, previewId: 'desktop-preview', page: 1, subject: 'ALL', context: 'TEST Oct - 2026', period: { month: 10, year: 2026 },
        rows: [{ name: 'นักเรียนตัวอย่าง', kumonId: '7642650000001', subject: 'ME', ready: true,
            before: { level: { value: 'C' }, worksheet: { value: '80' }, used: { value: '0' }, status: { value: 'C' } },
            desired: { level: 'C', worksheet: 90, used: 8, status: 'C', zun: [], at: [] } }] }));
    app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    let desktop;
    try {
        let remoteLoads = 0;
        desktop = await createKsisDesktop({ origin: `http://localhost:${server.address().port}`, profileDirectory, cookieHeader: 'kumondb.sid=s%3Atest-only',
            configureContext: (context) => context.route('https://kao.ksis.kumon.com/**', (route) => {
                remoteLoads++;
                return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<meta charset="utf-8"><style>body{margin:0;background:#e8f7ed;font:18px Arial;padding:30px;color:#123d29}h1{font-size:30px}input{font:inherit;padding:10px}</style><h1>KSIS · Test Browser</h1><p>เว็บทดสอบภายใน · ไม่ใช่ข้อมูลนักเรียนจริง</p><label>Username <input value="demo"></label><script>window.loginMemory="session-alive"</script>' });
            }) });
        const { main, page, application, context } = desktop;
        await main.locator('.ksis-embedded').waitFor();
        await page.getByRole('heading', { name: 'KSIS · Test Browser' }).waitFor();
        assert.equal(await page.evaluate(() => typeof process), 'undefined');
        assert.equal(await page.evaluate(() => typeof require), 'undefined');
        assert.equal(await page.evaluate(() => typeof window.kumonDesktop), 'undefined');
        assert.equal((await context.cookies('https://kao.ksis.kumon.com/kth/')).some((cookie) => cookie.name === 'kumondb.sid'), false);
        assert.equal((await context.cookies(`http://localhost:${server.address().port}`)).find((cookie) => cookie.name === 'kumondb.sid').value, 's%3Atest-only');
        await main.locator('#ksisAuditButton').click(); await main.locator('#ksisDraftButton').click();
        await main.reload(); await main.locator('.ksis-embedded').waitFor();
        assert.equal(await page.evaluate(() => window.loginMemory), 'session-alive'); assert.equal(remoteLoads, 1);
        // Normal KumonDB pages stay in this app; returning reuses the same remote view.
        const origin = `http://localhost:${server.address().port}`;
        await main.goto(`${origin}/report.html`);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
        assert.equal(await page.evaluate(() => window.loginMemory), 'session-alive');
        await main.locator('#appMenuButton').click();
        await main.locator('.nav-flyout-trigger').filter({ hasText: 'จัดการ' }).hover();
        await main.locator('[data-ksis-link]').click();
        await main.locator('.ksis-embedded').waitFor();
        assert.equal(new URL(main.url()).pathname, '/ksis.html');
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
        assert.equal(remoteLoads, 1); assert.equal(context.pages().length, 2);
        await page.goto('https://kao.ksis.kumon.com/kth/#/student/11111111-1111-4111-8111-111111111111');
        await page.goto('https://kao.ksis.kumon.com/kth/#/reportbeditgrid');
        assert.equal(await page.evaluate(() => window.loginMemory), 'session-alive'); assert.equal(remoteLoads, 1);
        const layout = await main.locator('#ksisBrowserSlot').boundingBox();
        assert.ok(layout.width > 500); assert.ok(layout.height > 450); assert.ok(layout.x > 400);
        const view = await application.evaluate(({ BrowserWindow }) => {
            const child = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
            return { visible: child.getVisible(), bounds: child.getBounds(), url: child.webContents.getURL() };
        });
        assert.equal(view.visible, true, JSON.stringify({ view, visibility: await main.evaluate(() => document.visibilityState) }));
        assert.ok(Math.abs(view.bounds.x - layout.x) <= 1);
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-ksis-embedded-remote-test.png') });
        await main.locator('#appMenuButton').click();
        assert.equal(await application.evaluate(async ({ BrowserWindow }) => {
            const child = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
            for (let count = 0; count < 50 && child.getVisible(); count++) await new Promise((resolve) => setTimeout(resolve, 20));
            return child.getVisible();
        }), false);
        await main.locator('#appMenuBackdrop').click();
        assert.equal(await application.evaluate(async ({ BrowserWindow }) => {
            const child = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
            for (let count = 0; count < 50 && !child.getVisible(); count++) await new Promise((resolve) => setTimeout(resolve, 20));
            return child.getVisible();
        }), true);
        await main.locator('#ksisDraftPreview').click(); await main.locator('#ksisDraftRows table').waitFor();
        assert.equal(await main.locator('#ksisDraftRows').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
        await main.locator('#ksisDraftFill').click();
        assert.equal(await application.evaluate(async ({ BrowserWindow }) => {
            const child = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
            for (let count = 0; count < 50 && child.getVisible(); count++) await new Promise((resolve) => setTimeout(resolve, 20));
            return child.getVisible();
        }), false);
        await main.locator('#ksisDraftCancel').click();
        await main.waitForFunction(() => !document.querySelector('dialog[open]'));
        assert.equal(await application.evaluate(async ({ BrowserWindow }) => {
            const child = BrowserWindow.getAllWindows()[0].contentView.children.at(-1);
            for (let count = 0; count < 50 && !child.getVisible(); count++) await new Promise((resolve) => setTimeout(resolve, 20));
            return child.getVisible();
        }), true);
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await desktop.focus();
        for (const size of [{ width: 1280, height: 720 }, { width: 1600, height: 900 }]) {
            await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), size);
            await main.waitForFunction((width) => innerWidth === width, size.width);
            assert.equal(await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            assert.ok((await main.locator('#ksisBrowserSlot').boundingBox()).height > 450);
            assert.equal(await main.locator('#ksisDraftRows').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
        }
        const preferences = await application.evaluate(({ webContents }) => webContents.getAllWebContents().map((contents) => {
            const preferences = contents.getLastWebPreferences(); return { node: preferences.nodeIntegration, sandbox: preferences.sandbox, isolated: preferences.contextIsolation, secure: preferences.webSecurity };
        }));
        assert.ok(preferences.every((item) => item.node === false && item.sandbox === true && item.isolated === true && item.secure === true));
        const screenshot = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
        await fs.writeFile(path.join(os.tmpdir(), 'kumondb-ksis-embedded-test.png'), Buffer.from(screenshot, 'base64'));
        const nativeScreenshot = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
            const window = BrowserWindow.getAllWindows()[0];
            const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: window.getBounds(), fetchWindowIcons: false });
            const image = sources.find((source) => source.id === window.getMediaSourceId())?.thumbnail;
            if (!image) return null;
            const size = image.getSize(), bitmap = image.toBitmap();
            const offset = (Math.floor(size.height * .65) * size.width + Math.floor(size.width * .8)) * 4;
            return { png: image.toPNG().toString('base64'), pixel: [...bitmap.subarray(offset, offset + 3)] };
        });
        if (nativeScreenshot) {
            assert.ok(nativeScreenshot.pixel.every((value, index) => Math.abs(value - [237, 247, 232][index]) < 5), `Embedded view was not painted: ${nativeScreenshot.pixel}`);
            await fs.writeFile(path.join(os.tmpdir(), 'kumondb-ksis-embedded-native-test.png'), Buffer.from(nativeScreenshot.png, 'base64'));
        }
    } finally {
        await desktop?.application.close(); await new Promise((resolve) => server.close(resolve));
        assert.ok(path.resolve(profileDirectory).startsWith(`${path.resolve(os.tmpdir())}${path.sep}kumon-embedded-test-`));
        await fs.rm(profileDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});

test('A browser K-sis page is only a launcher for the existing app, never a second editable workspace', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
    const app = express(); app.use(express.static('public')); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(), actions = [], errors = []; let embedded = true;
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/**', (route) => {
            const pathname = new URL(route.request().url()).pathname;
            let data = { success: true };
            if (pathname === '/api/auth/me') data = { user: { role: 'admin', displayName: 'Test' }, permissions: ['*'] };
            if (pathname === '/api/ksis/desktop/status') data = { success: true, embedded };
            if (route.request().method() === 'POST') { actions.push(pathname); assert.equal(pathname, '/api/ksis/desktop/open'); embedded = true; data = { success: true, embedded }; }
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html`);
        await page.locator('.ksis-browser-launcher').waitFor();
        assert.equal(await page.locator('#ksisAtPreview').isVisible(), false);
        assert.equal(await page.locator('#ksisDraftFill').isVisible(), false);
        assert.equal(await page.locator('#ksisAtAuditCurrent').isVisible(), false);
        assert.equal(await page.locator('#ksisDesktopOpen').innerText(), 'กลับไปยัง K-sis ในแอป');
        await page.locator('#ksisDesktopOpen').click();
        await page.waitForFunction(() => !document.getElementById('ksisDesktopOpen').disabled);
        assert.equal(page.context().pages().length, 1);
        embedded = false; await page.reload(); await page.locator('.ksis-browser-launcher').waitFor();
        assert.equal(await page.locator('#ksisDesktopOpen').innerText(), 'เปิด K-sis ในแอป');
        await page.locator('#ksisDesktopOpen').click();
        await page.waitForFunction(() => document.getElementById('ksisDesktopOpen').textContent.includes('กลับไปยัง'));
        assert.deepEqual(actions, ['/api/ksis/desktop/open', '/api/ksis/desktop/open']); assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});

test('The integrated workspace can retry a failed attachment without leaving a stale launcher or opening another page', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
    const app = express(); app.use(express.static('public')); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let attempts = 0;
        await page.addInitScript(() => { window.kumonDesktop = { info: async () => ({ unified: true }), setKsisBounds() {} }; });
        await page.route('**/api/**', (route) => {
            const pathname = new URL(route.request().url()).pathname;
            let data = { success: true }, status = 200;
            if (pathname === '/api/auth/me') data = { user: { role: 'admin', displayName: 'Fixture' }, permissions: ['*'] };
            if (pathname === '/api/ksis/desktop/open' && ++attempts === 1) { status = 409; data = { success: false, error: 'Synthetic attachment failure' }; }
            return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html`);
        await page.waitForFunction(() => document.getElementById('ksisDesktopStatus').textContent === 'Synthetic attachment failure');
        assert.equal(await page.locator('#ksisDesktopOpen').isVisible(), true);
        await page.locator('#ksisDesktopOpen').click();
        await page.waitForFunction(() => document.getElementById('ksisDesktopLaunch').classList.contains('hidden'));
        assert.equal(attempts, 2); assert.equal(browser.contexts()[0].pages().length, 1);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
