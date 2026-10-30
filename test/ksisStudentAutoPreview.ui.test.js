import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { once } from 'node:events';
import { createApplicationDesktop } from '../services/ksisDesktop.js';
import { mainDesktop } from '../services/appDesktop.js';
import studentRoutes from '../routes/studentRoutes.js';
import productionPool from '../config/db.js';

test('One Preview opens KSIS beside the existing form, waits for manual fixture login, resumes and never applies or saves automatically', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 60000
}, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumondb-student-auto-preview-'));
    t.mock.method(productionPool, 'query', () => assert.fail('The fixture must never query the production database'));
    t.mock.method(productionPool, 'connect', () => assert.fail('The fixture must never connect to the production database'));
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { req.session = { user: { role: 'admin', userId: 887701 } }; next(); });
    let studentWrites = 0, remoteWrites = 0, remoteLoads = 0, desktop;
    const errors = [];
    app.get('/api/auth/me', (_req, res) => res.json({ user: { role: 'admin', userId: 887701, displayName: 'Preview fixture' }, permissions: ['*'] }));
    app.get('/api/students/masters', (_req, res) => res.json({ success: true, masters: {
        prefixes: [{ id: 1, name: 'ด.ช.' }, { id: 2, name: 'ด.ญ.' }], genders: [{ id: 1, name: 'ชาย' }, { id: 2, name: 'หญิง' }],
        grades: [{ id: 1, label: 'เตรียมอ. (PK3)' }], subjects: [], statuses: [], schedules: [], levels: [], worksheets: [], dtMasters: [], studentHints: {}, addressRows: []
    } }));
    app.get('/api/students/duplicate', (_req, res) => res.json({ success: true, duplicate: null }));
    app.get('/api/students', (_req, res) => res.json({ success: true, rows: [] }));
    app.get('/api/students/search', (_req, res) => res.json({ success: true, rows: [] }));
    app.post('/api/students', (_req, res) => { studentWrites++; res.sendStatus(409); });
    app.use('/api/students', (req, res, next) => {
        if (req.method === 'POST' && req.path === '/ksis/preview') return next();
        errors.push(`Unexpected fixture route: ${req.method} ${req.path}`); return res.sendStatus(500);
    }, studentRoutes);
    app.use('/api', (_req, res) => res.json({ success: true, checked: false, rows: [] }));
    app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://localhost:${server.address().port}`;
    const sourceUrl = 'https://kao.ksis.kumon.com/kth/#/student/11111111-1111-4111-8111-111111111111';
    const shell = `<meta charset="utf-8"><style>body{background:#edf7ff;font:18px Arial;padding:24px}button{font-size:20px;padding:12px}</style><div id="fixture"></div><script>
        window.fixtureAuthenticated=false;
        function render(){
            if(!window.fixtureAuthenticated){
                document.getElementById('fixture').innerHTML='<h1>KSIS Login Fixture</h1><p>Synthetic login only</p><input id="fixtureUsername" aria-label="Fixture username"><button id="fixtureLogin">เข้าสู่ระบบจำลอง</button>';
                document.getElementById('fixtureLogin').onclick=()=>{window.fixtureAuthenticated=true;location.hash='/home';};
                if(location.hash!=='#/login')location.hash='/login';return;
            }
            document.getElementById('fixture').innerHTML=location.hash.startsWith('#/student/')?'<h1>KSIS Student Fixture</h1><input id="firstName" value="ตัวอย่าง"><input id="lastName" value="ทดสอบ"><input id="dateOfBirth" value="24/07/2562"><input id="personalId" value="excluded-private-data">':'<h1>KSIS Home Fixture</h1>';
        }
        addEventListener('hashchange',render);render();
    </script>`;
    try {
        desktop = await createApplicationDesktop({ origin, startPath: '/student-manager.html', cookieHeader: 'kumondb.sid=fixture-preview',
            profileDirectory: path.join(root, 'app'), downloadDirectory: path.join(root, 'Downloads'),
            configureContext: context => context.route('https://**/*', route => {
                if (!route.request().url().startsWith('https://kao.ksis.kumon.com/kth/')) return route.abort();
                if (route.request().method() !== 'GET') { remoteWrites++; return route.abort(); }
                remoteLoads++; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: shell });
            }) });
        t.mock.method(mainDesktop, 'current', () => desktop);
        const activate = desktop.activateAccount.bind(desktop);
        t.mock.method(desktop, 'activateAccount', options => activate({ ...options, profileDirectory: path.join(root, 'ksis') }));
        const { main, application, context } = desktop;
        main.on('pageerror', error => errors.push(error.message));
        await main.locator('#addStudentModal:not(.hidden)').waitFor();
        await main.locator('#addStudentForm [name=firstName]').fill('ชื่อที่พิมพ์ไว้');
        await main.locator('#addStudentForm [name=nickname]').fill('ข้อมูลเดิม');
        await main.locator('#ksisStudentUrl').fill(sourceUrl);
        await main.locator('#ksisPreviewButton').click();
        await main.waitForFunction(() => document.getElementById('ksisImportStatus').textContent.includes('เข้าสู่ระบบ KSIS ด้านขวา'));
        const remote = context.pages().find(page => page !== main);
        assert.ok(remote); await remote.locator('#fixtureLogin').waitFor();
        assert.equal(main.url(), `${origin}/student-manager.html`);
        assert.equal(await main.locator('#addStudentForm').evaluate(form => form.scrollWidth <= form.clientWidth + 1), true);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
        await main.waitForTimeout(450);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).length), 1);
        await remote.locator('#fixtureUsername').fill('manual fixture typing');
        await main.waitForTimeout(1100);
        assert.equal(await remote.locator('#fixtureUsername').inputValue(), 'manual fixture typing', 'Login polling must never reload the user input');
        assert.equal(await remote.evaluate(() => typeof window.kumonDesktop), 'undefined');
        await desktop.focus();
        const native = await application.evaluate(async ({ BrowserWindow, desktopCapturer }) => {
            const window = BrowserWindow.getAllWindows()[0];
            const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: window.getBounds() });
            return sources.find(source => source.id === window.getMediaSourceId())?.thumbnail.toPNG().toString('base64');
        });
        if (native) await fs.writeFile(path.join(os.tmpdir(), 'kumondb-student-preview-login-fixture.png'), Buffer.from(native, 'base64'));
        await main.locator('#ksisStudentStop').click();
        await main.waitForTimeout(400);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).length), 0);
        await main.locator('#ksisPreviewButton').click();
        await main.waitForFunction(() => document.getElementById('ksisImportStatus').textContent.includes('เข้าสู่ระบบ KSIS ด้านขวา'));
        await remote.locator('#fixtureLogin').click(); // A synthetic user login, never actual KSIS authentication.
        await main.locator('#ksisPreview table').waitFor();
        assert.equal(await main.locator('#addStudentForm [name=firstName]').inputValue(), 'ชื่อที่พิมพ์ไว้');
        assert.equal(await main.locator('#addStudentForm [name=nickname]').inputValue(), 'ข้อมูลเดิม');
        assert.equal(await main.locator('#ksisApplyButton').isEnabled(), true);
        assert.equal(await main.locator('#ksisStudentPane').isVisible(), false);
        assert.equal(remote.url(), sourceUrl); assert.equal(remoteLoads, 1);
        assert.equal(context.pages().length, 2);
        assert.equal(studentWrites, 0); assert.equal(remoteWrites, 0);
        await main.evaluate(() => window.kumonDesktop.setKsisBounds({ x: 0, y: 0, width: 1400, height: 800, visible: true }));
        await main.waitForTimeout(150);
        assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(view => view.getVisible()).length), 0);
        await main.screenshot({ path: path.join(os.tmpdir(), 'kumondb-student-preview-ready-fixture.png'), fullPage: true });
        await main.locator('#ksisPreviewButton').click(); await main.locator('#ksisPreview table').waitFor();
        assert.equal(remoteLoads, 1); assert.equal(studentWrites, 0); assert.equal(remoteWrites, 0);
        assert.deepEqual(errors, []);
        assert.equal(productionPool.query.mock.callCount(), 0); assert.equal(productionPool.connect.mock.callCount(), 0);
    } finally {
        await desktop?.application.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
        assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}kumondb-student-auto-preview-`));
        await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});
