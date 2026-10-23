import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { createAppDesktopManager } from '../services/appDesktop.js';
import { mainDesktop } from '../services/appDesktop.js';
import express from 'express';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import systemRoutes from '../routes/systemRoutes.js';
import { chromium } from 'playwright-core';
import { withKsisPage } from '../services/ksisStudentService.js';
import { createApplicationDesktop } from '../services/ksisDesktop.js';

test('Main desktop concurrent opens share one launch and a closed app can be opened again', async () => {
    let launches = 0;
    const manager = createAppDesktopManager(async (options) => {
        launches++;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { origin: options.origin, application: new EventEmitter() };
    });
    const options = { origin: 'http://localhost:3000' };
    const [first, second] = await Promise.all([manager.open(options), manager.open(options)]);
    assert.equal(first, second); assert.equal(launches, 1); assert.equal(manager.current(), first);
    await assert.rejects(manager.open({ origin: 'http://localhost:4000' }), { statusCode: 409 });
    first.application.emit('close'); assert.equal(manager.current(), null);
    assert.notEqual(await manager.open(options), first); assert.equal(launches, 2);
});

test('A failed desktop launch is retryable and never authorizes a missing app', async () => {
    let launches = 0;
    const manager = createAppDesktopManager(async (options) => {
        if (++launches === 1) throw new Error('synthetic launch failure');
        return { origin: options.origin, application: new EventEmitter() };
    });
    await assert.rejects(manager.open({ origin: 'http://localhost:3000' }), /synthetic/);
    assert.equal(manager.current(), null);
    await manager.open({ origin: 'http://localhost:3000' }); assert.equal(launches, 2);
});

test('The desktop shortcut focuses the same app only for local JSON requests and rejects foreign web origins', async (t) => {
    let opens = 0, focuses = 0;
    t.mock.method(mainDesktop, 'open', async () => { opens++; return { focus: async () => { focuses++; } }; });
    const app = express(); app.use('/api/system', systemRoutes);
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
        const send = (headers) => fetch(`${origin}/api/system/desktop/show`, { method: 'POST', headers, body: '{}' });
        assert.equal((await send({ 'Content-Type': 'application/json' })).status, 200);
        assert.equal((await send({ 'Content-Type': 'text/plain' })).status, 403);
        assert.equal((await send({ 'Content-Type': 'application/json', Origin: 'https://foreign.invalid' })).status, 403);
        assert.equal(opens, 1); assert.equal(focuses, 1);
    } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('The Windows launcher uses the integrated app and never silently kills a running server on a regular relaunch', async () => {
    const launcher = await fs.readFile('launcher/start.ps1', 'utf8');
    assert.doesNotMatch(launcher, /Start-Process.*chrome|--app=|Resolve-ChromePath/);
    assert.match(launcher, /KUMON_DESKTOP_MAIN = '1'/);
    const reuse = launcher.indexOf('/api/system/desktop/show'), stop = launcher.indexOf('Stop-Process');
    assert.ok(reuse > 0 && reuse < stop); assert.match(launcher.slice(reuse, stop), /return/);
});

test('Student import cannot open another Chrome while the integrated main app is present', async (t) => {
    t.mock.method(mainDesktop, 'current', () => ({}));
    t.mock.method(chromium, 'launchPersistentContext', () => assert.fail('No separate Chrome in the main app'));
    await assert.rejects(withKsisPage({ userId: 999221, sourceUrl: 'https://kao.ksis.kumon.com/kth/#/student/fixture' }, () => assert.fail()), { statusCode: 409 });
});

test('The integrated desktop refuses a foreign startup page before launching anything', async () => {
    await assert.rejects(createApplicationDesktop({ origin: 'http://localhost:3000', profileDirectory: 'unused', startPath: 'https://foreign.invalid' }), { statusCode: 400 });
});
