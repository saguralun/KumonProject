import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import session from 'express-session';
import { once } from 'node:events';
import pool from '../config/db.js';
import { refreshAccountSession, requireAdmin, requireStaff } from '../middleware/auth.js';
import systemRoutes from '../routes/systemRoutes.js';
import { restoreBackupFile } from '../services/backupService.js';

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

test('Updates require Admin; Opening Schedule endpoints honor the configured permission rather than an Admin-only gate', async (t) => {
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
    const app = express(); app.use((req, _res, next) => { const role = req.get('x-test-role'); if (role) req.session = { user: { role } }; next(); });
    app.use('/api/system', systemRoutes);
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        const request = (path, method, role) => fetch(`http://127.0.0.1:${server.address().port}/api/system${path}`, { method, headers: role ? { 'x-test-role': role } : {} });
        assert.equal((await request('/update-apply', 'POST')).status, 401);
        for (const role of ['guest', 'staff', 'instructor', 'scheduler']) assert.equal((await request('/update-apply', 'POST', role)).status, 403);
        assert.equal(executedUpdates, 0);
        assert.equal((await request('/update-apply', 'POST', 'admin')).status, 200); assert.equal(executedUpdates, 1);
        for (const [path, method] of [['/opening-schedules', 'GET'], ['/opening-schedules', 'POST'], ['/opening-schedules/1/active', 'POST'], ['/opening-schedules/1', 'DELETE']]) {
            assert.equal((await request(path, method, 'scheduler')).status, 200);
            assert.equal((await request(path, method, 'staff')).status, 403);
            assert.equal((await request(path, method)).status, 401);
        }
    } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('Restore invokes one atomic transaction and aborts on the first error, without running a real restore', async () => {
    const calls = [];
    const input = { executable: 'fake-pg_restore', host: 'test-host', port: 5432, user: 'test-user', dbName: 'isolated-test', tempFile: 'test.backup', env: {} };
    await restoreBackupFile(input, async (...args) => calls.push(args));
    assert.ok(calls[0][1].includes('--single-transaction')); assert.ok(calls[0][1].includes('--exit-on-error'));
    assert.ok(calls[0][1].includes('--clean')); assert.equal(calls[0][1].at(-1), 'test.backup');
    await assert.rejects(restoreBackupFile(input, async () => { throw new Error('restore stopped'); }), /restore stopped/);
});
