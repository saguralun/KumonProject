import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { _electron, chromium } from 'playwright-core';
import { desktopAppCookie } from '../services/ksisDesktop.js';
import { openKsisDesktop, ksisDesktopStatus, withKsisPage, withKsisWorkspacePage } from '../services/ksisStudentService.js';

const require = createRequire(import.meta.url);
const { appOrigin, isKsisUrl, isWorkspaceUrl, clampBounds } = require('../desktop/security.cjs');

test('Desktop accepts only loopback app origin and the real HTTPS KSIS destination', () => {
    assert.equal(appOrigin('http://localhost:3000'), 'http://localhost:3000');
    for (const url of ['https://evil.example', 'http://localhost.evil.example', 'file:///C:/data', 'http://user:pass@localhost:3000', 'http://localhost:3000/other']) assert.throws(() => appOrigin(url));
    assert.equal(isKsisUrl('https://kao.ksis.kumon.com/kth/#/login'), true);
    for (const url of ['http://kao.ksis.kumon.com/kth/', 'https://kao.ksis.kumon.com.evil.example/kth/', 'https://kao.ksis.kumon.com/other/', 'javascript:alert(1)']) assert.equal(isKsisUrl(url), false);
    assert.equal(isWorkspaceUrl('http://localhost:3000/ksis.html', 'http://localhost:3000'), true);
    assert.equal(isWorkspaceUrl('https://kao.ksis.kumon.com/kth/#/ksis.html', 'http://localhost:3000'), false);
    assert.deepEqual(clampBounds({ x: -5, y: 10, width: 9999, height: 9999 }, { width: 1200, height: 800 }), { x: 0, y: 10, width: 1200, height: 790 });
    assert.equal(clampBounds({ x: NaN }, { width: 1200, height: 800 }), null);
});

test('Desktop transfers only the current local application cookie, not other cookies or credentials', () => {
    const cookie = desktopAppCookie('other=private; kumondb.sid=s%3Atest-only; third=secret', 'http://localhost:3000');
    assert.deepEqual(cookie, { name: 'kumondb.sid', value: 's%3Atest-only', url: 'http://localhost:3000', httpOnly: true, sameSite: 'Lax' });
    assert.throws(() => desktopAppCookie('other=private', 'http://localhost:3000'), { statusCode: 401 });
});

test('All KSIS actions reuse the same embedded page per account, and a closed desktop is released', async (t) => {
    const application = new EventEmitter();
    let launches = 0, cookieUpdates = 0, focuses = 0;
    const visits = [];
    const main = { url: () => main.current || 'file:///desktop/loading.html', evaluate: async () => true,
        goto: async (url) => { main.current = url; } };
    const page = { current: 'about:blank', url: () => page.current, evaluate: async () => false,
        isClosed: () => false, goto: async (url) => { visits.push(url); page.current = url; } };
    const context = { pages: () => [main, page], addCookies: async (cookies) => { cookieUpdates++; assert.equal(cookies.length, 1); } };
    Object.assign(application, { firstWindow: async () => main, context: () => context, evaluate: async () => { focuses++; }, close: async () => application.emit('close') });
    t.mock.method(_electron, 'launch', async (options) => {
        launches++; assert.equal(options.env.DB_PASSWORD, undefined); assert.equal(options.env.SESSION_SECRET, undefined);
        assert.match(options.env.KUMON_DESKTOP_PROFILE, /987653/); return application;
    });
    const options = { userId: 987653, origin: 'http://localhost:3000', cookieHeader: 'kumondb.sid=test-only' };
    await openKsisDesktop(options);
    assert.equal(ksisDesktopStatus(options.userId).embedded, true);
    await withKsisPage({ sourceUrl: 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid', userId: options.userId }, async (actual) => assert.equal(actual, page));
    await withKsisWorkspacePage({ sourceUrl: page.url(), userId: options.userId }, async (actual) => assert.equal(actual, page));
    await openKsisDesktop(options);
    assert.equal(launches, 1); assert.equal(cookieUpdates, 2); assert.ok(focuses > 0); assert.equal(visits.length, 1);
    t.mock.method(page, 'isClosed', () => true);
    await assert.rejects(withKsisWorkspacePage({ sourceUrl: page.url(), userId: options.userId }, async () => assert.fail('Never substitute the local app page')), { statusCode: 409 });
    application.emit('close'); assert.equal(ksisDesktopStatus(options.userId).embedded, false);
});

test('Workspace jobs require the embedded app and never launch a fallback Chrome or a second desktop', async (t) => {
    t.mock.method(chromium, 'launchPersistentContext', () => assert.fail('No fallback browser'));
    t.mock.method(_electron, 'launch', () => assert.fail('No implicit second desktop'));
    await assert.rejects(withKsisWorkspacePage({ userId: 987660, sourceUrl: 'https://kao.ksis.kumon.com/kth/#/atestentrygrid', requireEmbedded: false }, async () => assert.fail()), { statusCode: 409 });
    assert.equal(ksisDesktopStatus(987660).embedded, false);
});
