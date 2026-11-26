import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createApplicationDesktop } from '../services/ksisDesktop.js';

test('Startup shows its local loading card before navigation and finishes only after the pending login page is ready', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 40000
}, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumon-startup-desktop-'));
    let release, loginStarted, page, desktop, opening;
    const gate = new Promise(resolve => { release = resolve; });
    const navigating = new Promise(resolve => { loginStarted = resolve; });
    const stages = [], app = express();
    app.get('/login.html', async (_req, res) => {
        await gate;
        res.send('<meta charset="utf-8"><h1>Synthetic login ready</h1><input aria-label="Fixture username">');
    });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        opening = createApplicationDesktop({ origin, profileDirectory: root, downloadDirectory: path.join(root, 'downloads'),
            configureContext: async context => {
                await context.route('https://**/*', route => route.abort());
                page = context.pages().find(item => item.url().startsWith('file:'));
                assert.ok(page, 'The local loading page must exist before navigation');
                await page.getByRole('status').waitFor({ timeout: 5000 });
                assert.match(await page.getByRole('status').textContent(), /กำลังโหลดหน้าล็อกอิน/);
            },
            onStartupStage: stage => { stages.push(stage); if (stage === 'login') loginStarted(); }
        });
        await Promise.race([navigating, opening.then(() => assert.fail('Desktop readiness must wait for the login response'))]);
        assert.deepEqual(stages, ['desktop', 'login']);
        release(); desktop = await opening;
        await desktop.main.getByRole('heading', { name: 'Synthetic login ready' }).waitFor();
        await desktop.main.getByRole('textbox', { name: 'Fixture username' }).fill('fixture-only');
        assert.deepEqual(stages, ['desktop', 'login', 'ready']);
        assert.equal(await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    } finally {
        release();
        if (!desktop && opening) desktop = await opening.catch(() => null);
        await desktop?.application.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        assert.ok(root.startsWith(path.join(os.tmpdir(), 'kumon-startup-desktop-')));
        await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});
