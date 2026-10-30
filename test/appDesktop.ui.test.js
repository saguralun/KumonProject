import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplicationDesktop } from '../services/ksisDesktop.js';
import { mainDesktop } from '../services/appDesktop.js';
import { openKsisDesktop, withKsisWorkspacePage } from '../services/ksisStudentService.js';

test('One main window supports login, regular pages, the controlled KSIS view, isolated accounts and printing without popups', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 60000
}, async (t) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumon-main-desktop-test-'));
    const app = express(); app.use(express.json()); let desktop, remoteLoads = 0, openCalls = 0;
    const userFor = (req) => /kumondb.sid=fixture-(\d+)/.exec(req.headers.cookie || '')?.[1];
    app.post('/api/auth/login/admin', (req, res) => {
        const id = req.body.username === 'second' ? 2 : 1;
        res.set('Set-Cookie', `kumondb.sid=fixture-${id}; Path=/; HttpOnly; SameSite=Lax`).json({ success: true, user: { role: 'admin' } });
    });
    app.post('/api/auth/logout', (_req, res) => res.clearCookie('kumondb.sid').json({ success: true }));
    app.get('/api/auth/me', (req, res) => res.json({ user: userFor(req) ? { role: 'admin', userId: Number(userFor(req)), displayName: `Fixture ${userFor(req)}` } : null, permissions: ['*'] }));
    app.post('/api/ksis/desktop/open', async (req, res) => {
        openCalls++;
        try { res.json(await openKsisDesktop({ userId: Number(userFor(req)), origin, cookieHeader: req.headers.cookie })); }
        catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
    });
    app.get('/api/{*path}', (_req, res) => res.json({ success: true, checked: false, rows: [], patterns: [] }));
    app.get('/fixture-download.csv', (_req, res) => res.attachment('fixture-only.csv').send('test,value\n1,2\n'));
    app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://localhost:${server.address().port}`;
    try {
        desktop = await createApplicationDesktop({ origin, profileDirectory: path.join(root, 'app'), configureContext: (context) => context.route('https://kao.ksis.kumon.com/**', (route) => {
            remoteLoads++;
            return route.fulfill({ contentType: 'text/html', body: '<style>body{background:#e8f7ed;font:24px Arial;padding:24px}</style><h1>KSIS Fixture</h1><input id="draft" value="unsaved fixture"><script>window.fixtureMemory="alive"</script>' });
        }) });
        t.mock.method(mainDesktop, 'current', () => desktop);
        const activate = desktop.activateAccount.bind(desktop);
        t.mock.method(desktop, 'activateAccount', (options) => activate({ ...options, profileDirectory: path.join(root, `account-${options.userId}`) }));
        const { main, application, context } = desktop;
        const errors = []; main.on('pageerror', (error) => errors.push(error.message));
        const windowCount = () => application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
        const login = async (username) => {
            await main.locator('[name=username]').fill(username); await main.locator('[name=password]').fill('fixture-only');
            await main.locator('#adminSubmit').click(); await main.waitForURL('**/worksheet.html');
            await main.locator('#authLogoutButton').waitFor({ state: 'attached' });
        };
        const logout = async () => {
            const menu = main.locator('.app-menu-toggle');
            if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
            await main.locator('#authLogoutButton').click(); await main.waitForURL('**/login.html');
        };
        await main.locator('#adminForm').waitFor();
        assert.deepEqual(await main.evaluate(() => window.kumonDesktop.info()), { embedded: true, unified: true });
        await login('first'); assert.equal(await windowCount(), 1); assert.equal(context.pages().length, 1);
        assert.equal(remoteLoads, 0);
        await main.goto(`${origin}/report.html`); await main.locator('#authLogoutButton').waitFor({ state: 'attached' });
        await main.locator('#appMenuButton').click();
        await main.locator('.nav-flyout-trigger').filter({ hasText: 'จัดการ' }).hover();
        const opening = main.waitForResponse((response) => response.url().endsWith('/api/ksis/desktop/open'));
        await main.locator('[data-ksis-link]').click(); await main.waitForURL('**/ksis.html');
        const opened = await opening;
        assert.equal(opened.status(), 200, await opened.text());
        const page = context.pages().find((item) => item !== main);
        assert.ok(page, await main.locator('#statusLine').innerText());
        await page.getByRole('heading', { name: 'KSIS Fixture' }).waitFor();
        assert.equal(openCalls, 1); assert.equal(remoteLoads, 1); assert.equal(await windowCount(), 1);
        await withKsisWorkspacePage({ sourceUrl: page.url(), userId: 1 }, async (controlled) => assert.equal(controlled, page));
        await page.locator('#draft').fill('fixture pending edit');
        await page.evaluate(() => { document.cookie = 'ksisFixture=first; Path=/'; localStorage.setItem('fixtureAccount', 'first'); });
        assert.equal(await page.evaluate(() => typeof window.kumonDesktop), 'undefined');
        assert.equal(await page.evaluate(() => typeof require), 'undefined');
        assert.doesNotMatch(await page.evaluate(() => document.cookie), /kumondb.sid/);
        await main.goto(`${origin}/payment.html`); await main.locator('#authLogoutButton').waitFor({ state: 'attached' });
        assert.equal(await windowCount(), 1);
        await main.goto(`${origin}/ksis.html`);
        await main.waitForFunction(() => document.querySelector('.ksis-embedded'));
        await main.waitForTimeout(200);
        assert.equal(remoteLoads, 1); assert.equal(await page.locator('#draft').inputValue(), 'fixture pending edit');
        assert.equal(await page.evaluate(() => window.fixtureMemory), 'alive');
        await logout();
        await assert.rejects(withKsisWorkspacePage({ sourceUrl: page.url(), userId: 1 }, () => assert.fail('Logged-out account must not control KSIS')), { statusCode: 409 });
        await login('second'); await main.goto(`${origin}/ksis.html`);
        await main.waitForTimeout(600);
        const second = context.pages().find((item) => item !== main && item !== page);
        assert.ok(second, await main.locator('#statusLine').innerText());
        await second.getByRole('heading', { name: 'KSIS Fixture' }).waitFor();
        assert.equal(await second.evaluate(() => localStorage.getItem('fixtureAccount')), null);
        assert.doesNotMatch(await second.evaluate(() => document.cookie), /ksisFixture/);
        await assert.rejects(desktop.assertAppSession('kumondb.sid=fixture-1'), { statusCode: 409 });
        await logout();
        await login('first'); await main.goto(`${origin}/ksis.html`); await main.waitForTimeout(300);
        assert.equal(remoteLoads, 2); assert.equal(await windowCount(), 1);
        assert.equal(await page.evaluate(() => localStorage.getItem('fixtureAccount')), 'first');
        assert.equal(await page.locator('#draft').inputValue(), 'fixture pending edit');
        const downloading = main.waitForEvent('download');
        await application.evaluate(({ dialog }, destination) => {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination });
        }, path.join(root, 'chosen-fixture.csv'));
        await main.evaluate(() => { const link = document.createElement('a'); link.href = '/fixture-download.csv'; link.download = 'fixture-only.csv'; link.click(); });
        const download = await downloading;
        assert.equal(download.suggestedFilename(), 'fixture-only.csv');
        await desktop.downloadsIdle();
        assert.equal(await fs.readFile(path.join(root, 'chosen-fixture.csv'), 'utf8'), 'test,value\n1,2\n');
        assert.equal(await download.failure(), null); await download.delete();
        // Replace the native print operation: no real printer or print dialog is used.
        await application.evaluate(({ BrowserWindow }) => {
            const prototype = Object.getPrototypeOf(BrowserWindow.getAllWindows()[0].webContents);
            prototype.print = function (options, callback) { globalThis.fixturePrint = { silent: options.silent, url: this.getURL() }; callback(true); };
        });
        assert.deepEqual(await main.evaluate(() => window.kumonDesktop.printHtml('<html><body>Fixture print only</body></html>')), { printed: true });
        assert.equal(await windowCount(), 1);
        assert.equal(await application.evaluate(() => globalThis.fixturePrint.silent), false);
        await main.evaluate(() => window.open('https://example.invalid', '_blank'));
        assert.equal(await windowCount(), 1);
        for (const size of [{ width: 1280, height: 720 }, { width: 1600, height: 900 }]) {
            await application.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), size);
            await main.waitForFunction((width) => innerWidth === width, size.width);
            assert.equal(await main.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        }
        const screenshot = await application.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
        await fs.writeFile(path.join(os.tmpdir(), 'kumondb-single-window-fixture.png'), Buffer.from(screenshot, 'base64'));
        await desktop.focus();
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const activeViews = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter((view) => view.getVisible()).length);
        assert.equal(activeViews, 1);
        const native = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
            const window = BrowserWindow.getAllWindows()[0];
            const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: window.getBounds(), fetchWindowIcons: false });
            const image = sources.find((source) => source.id === window.getMediaSourceId())?.thumbnail;
            if (!image) return null;
            const size = image.getSize(), bitmap = image.toBitmap();
            const offset = (Math.floor(size.height * .65) * size.width + Math.floor(size.width * .8)) * 4;
            return { png: image.toPNG().toString('base64'), pixel: [...bitmap.subarray(offset, offset + 3)] };
        });
        if (native) {
            assert.ok(native.pixel.every((value, index) => Math.abs(value - [237, 247, 232][index]) < 5), `Remote view is blank or hidden: ${native.pixel}`);
            await fs.writeFile(path.join(os.tmpdir(), 'kumondb-single-window-native-fixture.png'), Buffer.from(native.png, 'base64'));
        }
        assert.deepEqual(errors, []);
    } finally {
        await desktop?.application.close(); await new Promise((resolve) => server.close(resolve));
        assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}kumon-main-desktop-test-`));
        await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});
