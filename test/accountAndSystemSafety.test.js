import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import session from 'express-session';
import { once } from 'node:events';
import pool from '../config/db.js';
import { refreshAccountSession, requireAdmin, requireStaff } from '../middleware/auth.js';
import systemRoutes from '../routes/systemRoutes.js';
import { restoreBackupFile } from '../services/backupService.js';
import { requireUpdateAccess } from '../middleware/updateAccess.js';

test('Existing sessions immediately lose access after account deactivation or role reduction, including uppercase URLs', async (t) => {
    let active = true, role = 'admin', unavailable = false;
    t.mock.method(pool, 'query', async (sql) => {
        if (unavailable) throw new Error('database unavailable');
        assert.match(sql, /is_active = TRUE/);
        return { rows: active ? [{ user_id: 22, username: 'test', display_name: 'Test', role }] : [] };
    });
    const app = express(); app.use(session({ secret: 'isolated-test-secret', resave: false, saveUninitialized: false }));
    app.post('/test-login', (req, res) => { req.session.user = { userId: 22, role: 'admin' }; res.json({ success: true }); });
    app.use(refreshAccountSession);
    app.post('/api/relogin', (req, res) => req.session.regenerate((error) => error ? res.sendStatus(500) : res.sendStatus(200)));
    app.get('/api/admin', requireAdmin, (_req, res) => res.json({ success: true }));
    app.get('/api/staff', requireStaff, (_req, res) => res.json({ success: true }));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const login = await fetch(`${base}/test-login`, { method: 'POST' });
        const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
        assert.equal((await fetch(`${base}/api/admin`, { headers })).status, 200);
        role = 'staff';
        assert.equal((await fetch(`${base}/API/admin`, { headers })).status, 403);
        role = 'instructor';
        assert.equal((await fetch(`${base}/api/staff`, { headers })).status, 200);
        unavailable = true;
        assert.equal((await fetch(`${base}/api/staff`, { headers })).status, 503);
        unavailable = false; active = false;
        assert.equal((await fetch(`${base}/api/staff`, { headers })).status, 401);
        // A revoked cookie must not break the next attempt to sign in as another account.
        assert.equal((await fetch(`${base}/api/relogin`, { method: 'POST', headers })).status, 200);
    } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Local updates need confirmation but not a login; Opening Schedule honors its configured permission', async (t) => {
    let executedUpdates = 0;
    // Replace only the final action: this test must never pull code or spawn a restart.
    const update = systemRoutes.stack.find((layer) => layer.route?.path === '/update-apply').route;
    t.mock.method(update.stack.at(-1), 'handle', (_req, res) => { executedUpdates++; res.json({ success: true }); });
    for (const layer of systemRoutes.stack.filter((layer) => layer.route?.path?.startsWith('/opening-schedules'))) {
        t.mock.method(layer.route.stack.at(-1), 'handle', (_req, res) => res.json({ success: true }));
    }
    t.mock.method(pool, 'query', async (sql) => {
        assert.match(sql, /FROM role_permission/);
        return { rows: [{ role_code: 'scheduler', permission_key: 'page:opening-schedule' }] };
    });
    const app = express(); app.use(express.json()); app.use((req, _res, next) => { const role = req.get('x-test-role'); if (role) req.session = { user: { role } }; next(); });
    app.use('/api/system', systemRoutes);
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        const request = (path, method, role, extra = {}) => fetch(`http://127.0.0.1:${server.address().port}/api/system${path}`, { method, ...extra, headers: { ...(role ? { 'x-test-role': role } : {}), ...extra.headers } });
        const confirmed = { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirm: true }) };
        assert.equal((await request('/update-apply', 'POST')).status, 400);
        assert.equal((await request('/update-apply', 'POST', undefined, { ...confirmed, body: '{}' })).status, 400);
        assert.equal((await request('/update-apply', 'POST', undefined, { ...confirmed, headers: { ...confirmed.headers, Origin: 'https://foreign.example' } })).status, 403);
        assert.equal(executedUpdates, 0);
        for (const role of [undefined, 'guest', 'staff', 'instructor', 'scheduler', 'admin']) assert.equal((await request('/update-apply', 'POST', role, confirmed)).status, 200);
        assert.equal(executedUpdates, 6);
        for (const [path, method] of [['/opening-schedules', 'GET'], ['/opening-schedules', 'POST'], ['/opening-schedules/1/active', 'POST'], ['/opening-schedules/1', 'DELETE']]) {
            assert.equal((await request(path, method, 'scheduler')).status, 200);
            assert.equal((await request(path, method, 'staff')).status, 403);
            assert.equal((await request(path, method)).status, 401);
        }
    } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Update access rejects remote non-admins, cross-origin calls and rebinding hosts', () => {
    function check({ address = '127.0.0.1', role, host = '127.0.0.1:3000', origin, site, type = 'application/json', confirm = true } = {}) {
        let status = 200, allowed = false;
        const headers = { host, origin, 'sec-fetch-site': site };
        const req = { socket: { remoteAddress: address, localPort: 3000 }, protocol: 'http', session: { user: { role } }, get: (key) => headers[key], is: (value) => value === type, body: { confirm } };
        const res = { status(value) { status = value; return this; }, json() {} };
        requireUpdateAccess(req, res, () => { allowed = true; });
        return { status, allowed };
    }
    for (const address of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) assert.equal(check({ address }).allowed, true);
    for (const role of [undefined, 'guest', 'staff', 'instructor']) assert.equal(check({ address: '192.168.1.10', role }).status, 403);
    assert.equal(check({ address: '192.168.1.10', role: 'admin', host: '192.168.1.2:3000', origin: 'http://192.168.1.2:3000' }).allowed, true);
    assert.equal(check({ host: 'rebound.example:3000', origin: 'http://rebound.example:3000' }).status, 403);
    assert.equal(check({ origin: 'null' }).status, 403);
    assert.equal(check({ site: 'cross-site' }).status, 403);
    assert.equal(check({ type: 'text/plain' }).status, 400);
    assert.equal(check({ confirm: 'true' }).status, 400);
    assert.equal(check({ confirm: false }).status, 400);
});

test('Restore invokes one atomic transaction and aborts on the first error, without running a real restore', async () => {
    const calls = [];
    const input = { executable: 'fake-pg_restore', host: 'test-host', port: 5432, user: 'test-user', dbName: 'isolated-test', tempFile: 'test.backup', env: {} };
    await restoreBackupFile(input, async (...args) => calls.push(args));
    assert.ok(calls[0][1].includes('--single-transaction')); assert.ok(calls[0][1].includes('--exit-on-error'));
    assert.ok(calls[0][1].includes('--clean')); assert.equal(calls[0][1].at(-1), 'test.backup');
    await assert.rejects(restoreBackupFile(input, async () => { throw new Error('restore stopped'); }), /restore stopped/);
});
