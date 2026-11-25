import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pool from '../config/db.js';
import authRoutes from '../routes/authRoutes.js';
import userRoutes from '../routes/userRoutes.js';
import { refreshAccountSession, requireAuth, requireAdmin } from '../middleware/auth.js';
import { upsertAccount, verifyAccountLogin } from '../services/authService.js';
import { accountCredentialVersion, refreshAccountSessionData } from '../services/accountSession.js';

const deferred = () => {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
};

// The same database-boundary isolation as authAdminConcurrency/accountAndSystemSafety:
// both pool entry points are replaced before any service call. Real Express,
// bcrypt, cookies and connect-pg-simple operate on synthetic account/session rows.
async function fixture(t) {
    const passwordHash = await bcrypt.hash('synthetic-before', 4);
    let accounts = [1, 2, 3].map(id => ({ user_id: id, username: `fixture${id}`,
        password_hash: passwordHash, display_name: `Fixture ${id}`, role: 'admin', is_active: true }));
    let sessions = new Map();
    const state = { failRevocation: false, unavailable: false, failDestroy: false,
        sessionTableExists: true, catalogError: null, revocationError: null,
        beforeLoginTimestamp: null, calls: [], errors: [], held: deferred(), resume: deferred() };
    const normalize = sql => sql.replace(/\s+/g, ' ').trim();
    t.mock.method(pool, 'query', async (sql, params = []) => {
        sql = normalize(sql); state.calls.push(sql);
        if (state.unavailable) throw Error('synthetic database unavailable');
        if (sql.startsWith('SELECT sess FROM')) {
            const row = sessions.get(params[0]);
            return { rows: row ? [{ sess: structuredClone(row) }] : [] };
        }
        if (sql.startsWith('INSERT INTO "session"')) {
            sessions.set(params[2], structuredClone(JSON.parse(JSON.stringify(params[0]))));
            return { rows: [{ sid: params[2] }] };
        }
        if (sql.startsWith('UPDATE "session" SET expire')) return { rows: [] };
        if (sql === 'DELETE FROM "session" WHERE sid = $1') {
            if (state.failDestroy) throw Error('synthetic session destroy failure');
            sessions.delete(params[0]); return { rows: [] };
        }
        if (sql.includes('AS stored_session_exists')) {
            assert.match(sql, /EXISTS \(SELECT 1 FROM "session" WHERE sid = \$2 AND sess->'user'->>'userId' = \$3\)/);
            assert.equal(params[2], String(params[0]));
            const row = accounts.find(row => row.user_id === params[0] && row.is_active);
            const stored = sessions.get(params[1]);
            return { rows: row ? [{ ...row, stored_session_exists: String(stored?.user?.userId) === String(params[0]) }] : [] };
        }
        if (sql.startsWith('SELECT user_id, username, password_hash')) {
            const row = accounts.find(row => row.username === params[0]);
            return { rows: row ? [{ ...row }] : [] };
        }
        if (sql.startsWith('UPDATE app_user SET last_login_at')) {
            await state.beforeLoginTimestamp?.();
            return { rows: [] };
        }
        assert.fail(`Unexpected pool SQL: ${sql}`);
    });
    t.mock.method(pool, 'connect', async () => {
        let workingAccounts, workingSessions;
        return {
            async query(sql, params = []) {
                sql = normalize(sql); state.calls.push(sql);
                if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED') {
                    workingAccounts = structuredClone(accounts); workingSessions = structuredClone(sessions);
                    return { rows: [] };
                }
                if (sql === 'LOCK TABLE app_user IN SHARE ROW EXCLUSIVE MODE') return { rows: [] };
                if (sql === 'SELECT 1 FROM role_master WHERE role_code = $1') {
                    return { rows: ['admin', 'staff'].includes(params[0]) ? [{}] : [] };
                }
                if (sql === 'SELECT user_id, role, is_active FROM app_user WHERE username = $1') {
                    return { rows: workingAccounts.filter(row => row.username === params[0]).map(row => ({ ...row })) };
                }
                if (sql.startsWith('SELECT COUNT(*)')) {
                    return { rows: [{ count: workingAccounts.filter(row => row.role === 'admin' && row.is_active && row.user_id !== params[0]).length }] };
                }
                if (sql.startsWith('INSERT INTO app_user')) {
                    let row = workingAccounts.find(row => row.username === params[0]);
                    if (row && sql.includes('DO NOTHING')) return { rows: [] };
                    if (!row) { row = { user_id: workingAccounts.length + 1, username: params[0] }; workingAccounts.push(row); }
                    Object.assign(row, { password_hash: params[1], display_name: params[2], role: params[3], is_active: true });
                    return { rows: [{ user_id: row.user_id, username: row.username, display_name: row.display_name, role: row.role }] };
                }
                if (sql.startsWith('UPDATE app_user SET password_hash')) {
                    const row = workingAccounts.find(row => row.user_id === params[0]);
                    if (!row) return { rows: [] };
                    row.password_hash = params[1];
                    return { rows: [{ user_id: row.user_id, username: row.username, display_name: row.display_name, role: row.role, is_active: row.is_active }] };
                }
                if (sql === "SELECT to_regclass('session') IS NOT NULL AS session_table_exists") {
                    if (state.catalogError) throw state.catalogError;
                    return { rows: [{ session_table_exists: state.sessionTableExists }] };
                }
                if (sql === 'DELETE FROM "session" WHERE sess->\'user\'->>\'userId\' = $1') {
                    assert.equal(state.sessionTableExists, true, 'Absent session tables must not be queried');
                    if (state.revocationError) throw state.revocationError;
                    if (state.failRevocation) throw Error('synthetic session revocation failure');
                    for (const [sid, row] of workingSessions) if (String(row.user?.userId) === params[0]) workingSessions.delete(sid);
                    return { rows: [] };
                }
                if (sql === 'COMMIT') { accounts = workingAccounts; sessions = workingSessions; return { rows: [] }; }
                if (sql === 'ROLLBACK') return { rows: [] };
                assert.fail(`Unexpected transaction SQL: ${sql}`);
            },
            release() {}
        };
    });
    // Error responses are asserted below; keep expected failures out of test logs.
    t.mock.method(console, 'error', error => state.errors.push(error));
    const PgSession = connectPgSimple(session);
    const store = new PgSession({ pool, tableName: 'session', createTableIfMissing: false, pruneSessionInterval: false });
    const app = express(); app.use(express.json());
    app.use(session({ store, name: 'kumondb.sid', secret: 'synthetic-password-reset-secret',
        resave: false, saveUninitialized: false, rolling: true, cookie: { maxAge: 43200000 } }));
    app.use(refreshAccountSession);
    app.use('/api/auth', authRoutes);
    app.use('/api/users', requireAdmin, userRoutes);
    app.get('/api/protected', requireAuth, (req, res) => res.json({ user: req.session.user }));
    app.get('/api/admin', requireAdmin, (_req, res) => res.sendStatus(200));
    app.post('/api/held', requireAuth, async (req, res) => {
        state.held.resolve();
        await state.resume.promise;
        req.session.syntheticDraft = 'forces a late session save';
        res.sendStatus(200);
    });
    app.use((error, _req, res, _next) => { state.errors.push(error); res.status(503).json({ success: false }); });
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => {
        state.resume.resolve();
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const request = (path, cookie, body) => fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
        headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const login = async (id, password = 'synthetic-before') => {
        const response = await request('/api/auth/login/admin', undefined, { username: `fixture${id}`, password });
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.deepEqual(Object.keys(payload.user).sort(), ['displayName', 'role', 'userId', 'username']);
        assert.doesNotMatch(JSON.stringify(payload), /password_hash|credentialVersion|accountCredentialVersion/);
        return response.headers.get('set-cookie').split(';')[0];
    };
    const reset = (cookie, id, extra = {}) => request(`/api/users/${id}/password`, cookie, { password: 'synthetic-after', ...extra });
    return { state, request, login, reset, accounts: () => accounts, sessions: () => sessions, store };
}

test('Reset revokes two machines, preserves resetting Admin/other accounts, and accepts only the new password', async t => {
    const f = await fixture(t);
    const admin = await f.login(1), first = await f.login(2), second = await f.login(2), other = await f.login(3);
    for (const cookie of [admin, first, second, other]) assert.equal((await f.request('/api/admin', cookie)).status, 200);
    assert.equal((await f.reset(admin, 2)).status, 200);
    assert.equal([...f.sessions().values()].filter(row => row.user?.userId === 2).length, 0);
    for (const cookie of [first, second]) assert.equal((await f.request('/api/protected', cookie)).status, 401);
    for (const cookie of [admin, other]) assert.equal((await f.request('/api/admin', cookie)).status, 200);
    const oldLogin = await f.request('/api/auth/login/admin', undefined, { username: 'fixture2', password: 'synthetic-before' });
    assert.equal(oldLogin.status, 401);
    const fresh = await f.login(2, 'synthetic-after');
    assert.equal((await f.request('/api/admin', fresh)).status, 200);
    assert.equal((await f.request('/api/auth/me', first)).status, 200);
    assert.equal((await (await f.request('/api/auth/me', first)).json()).user, null);
    assert.equal(f.accounts()[1].role, 'admin'); assert.equal(f.accounts()[1].is_active, true);
});

test('Creating an existing username cannot reset, promote or reactivate its account', async t => {
    const f = await fixture(t), admin = await f.login(1);
    Object.assign(f.accounts()[1], { role: 'staff', is_active: false, display_name: 'Keep original name' });
    const before = structuredClone(f.accounts()[1]);
    const response = await f.request('/api/users', admin, { username: 'fixture2', password: 'different-password', displayName: 'Wrong new name', role: 'admin' });
    assert.equal(response.status, 409);
    assert.deepEqual(f.accounts()[1], before);
});

test('Create-only HTTP keeps normal new accounts and rejects invalid or unauthorized creation', async t => {
    const f = await fixture(t), admin = await f.login(1);
    const payload = { username: ' fixture-new ', password: 'synthetic-new', displayName: 'New fixture', role: 'staff' };
    const original = structuredClone(f.accounts());
    assert.equal((await f.request('/api/users', undefined, payload)).status, 401);
    Object.assign(f.accounts()[2], { role: 'staff' });
    const staff = await f.login(3);
    assert.equal((await f.request('/api/users', staff, payload)).status, 403);
    for (const invalid of [{ role: '' }, { role: 'guest' }, { password: 'short' }, { username: ' ' }]) {
        assert.equal((await f.request('/api/users', admin, { ...payload, ...invalid })).status, 400);
    }
    assert.equal(f.accounts().length, 3);
    const response = await f.request('/api/users', admin, payload);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.doesNotMatch(JSON.stringify(body), /password_hash|credentialVersion/);
    assert.equal(body.user.username, 'fixture-new'); assert.equal(body.user.role, 'staff');
    const created = f.accounts().find(row => row.username === 'fixture-new');
    assert.equal(created.is_active, true); assert.equal(created.display_name, 'New fixture');
    assert.equal(await bcrypt.compare('synthetic-new', created.password_hash), true);
    assert.deepEqual(f.accounts().slice(0, 2), original.slice(0, 2));
});

test('Dedicated password reset preserves inactive role/name and revokes only the target sessions', async t => {
    const f = await fixture(t), admin = await f.login(1), target = await f.login(2), other = await f.login(3);
    Object.assign(f.accounts()[1], { role: 'staff', is_active: false, display_name: 'Original inactive account' });
    const before = { ...f.accounts()[1] };
    const response = await f.reset(admin, 2, { role: 'admin', isActive: true, displayName: 'Must not change', username: 'fixture3' });
    assert.equal(response.status, 200);
    assert.doesNotMatch(JSON.stringify(await response.json()), /password_hash|credentialVersion/);
    assert.equal(f.accounts()[1].role, before.role); assert.equal(f.accounts()[1].is_active, false);
    assert.equal(f.accounts()[1].display_name, before.display_name); assert.equal(f.accounts()[1].username, before.username);
    assert.notEqual(f.accounts()[1].password_hash, before.password_hash);
    assert.equal((await f.request('/api/protected', target)).status, 401);
    for (const cookie of [admin, other]) assert.equal((await f.request('/api/protected', cookie)).status, 200);
    assert.equal((await f.request('/api/auth/login/admin', undefined, { username: 'fixture2', password: 'synthetic-after' })).status, 401);
});

test('Password endpoint rejects missing accounts, invalid IDs, short passwords and non-Admins without changing accounts', async t => {
    const f = await fixture(t), admin = await f.login(1);
    const before = structuredClone(f.accounts());
    assert.equal((await f.reset(admin, 999)).status, 404);
    assert.equal((await f.reset(admin, 'bad')).status, 400);
    assert.equal((await f.reset(admin, 2, { password: 'short' })).status, 400);
    assert.deepEqual(f.accounts(), before);
    f.accounts()[1].role = 'staff'; const staff = await f.login(2);
    assert.equal((await f.reset(staff, 3)).status, 403);
    assert.equal((await f.reset(undefined, 3)).status, 401);
});

for (const legacy of [false, true]) test(`An in-flight ${legacy ? 'legacy' : 'current'} session resaved after reset is rejected`, async t => {
    const f = await fixture(t), admin = await f.login(1), target = await f.login(2);
    if (legacy) for (const row of f.sessions().values()) if (row.user?.userId === 2) delete row.accountCredentialVersion;
    const held = f.request('/api/held', target, {});
    await f.state.held.promise;
    assert.equal((await f.reset(admin, 2)).status, 200);
    assert.equal([...f.sessions().values()].filter(row => row.user?.userId === 2).length, 0);
    f.state.resume.resolve(); assert.equal((await held).status, 200);
    // connect-pg-simple really recreated this session through its UPSERT.
    const resurrected = [...f.sessions().values()].find(row => row.user?.userId === 2);
    assert.ok(resurrected?.syntheticDraft);
    assert.notEqual(resurrected.accountCredentialVersion, accountCredentialVersion(f.accounts()[1].password_hash));
    assert.equal((await f.request('/api/admin', target)).status, 401);
    assert.equal((await f.request('/api/admin', await f.login(2, 'synthetic-after'))).status, 200);
});

test('A login verified before reset but persisted afterwards cannot restore access', async t => {
    const f = await fixture(t), admin = await f.login(1);
    const reached = deferred(), resume = deferred();
    t.after(() => resume.resolve());
    f.state.beforeLoginTimestamp = async () => { reached.resolve(); await resume.promise; };
    const lateLogin = f.request('/api/auth/login/admin', undefined, { username: 'fixture2', password: 'synthetic-before' });
    await reached.promise;
    assert.equal((await f.reset(admin, 2)).status, 200);
    f.state.beforeLoginTimestamp = null; resume.resolve();
    const response = await lateLogin; assert.equal(response.status, 200);
    const stale = response.headers.get('set-cookie').split(';')[0];
    assert.equal((await f.request('/api/admin', stale)).status, 401);
    assert.equal((await f.request('/api/admin', await f.login(2, 'synthetic-after'))).status, 200);
});

test('Self-reset revokes every old session including the current resetting session', async t => {
    const f = await fixture(t), first = await f.login(1), second = await f.login(1);
    assert.equal((await f.reset(first, 1)).status, 200);
    for (const cookie of [first, second]) assert.equal((await f.request('/api/admin', cookie)).status, 401);
    assert.equal((await f.request('/api/admin', await f.login(1, 'synthetic-after'))).status, 200);
});

test('Revocation failure rolls back credentials and returns an error, without affecting any sessions', async t => {
    const f = await fixture(t), admin = await f.login(1), target = await f.login(2);
    const beforeAccounts = structuredClone(f.accounts()), beforeSessions = structuredClone(f.sessions());
    f.state.failRevocation = true;
    const response = await f.reset(admin, 2);
    assert.equal(response.status, 500); assert.equal((await response.json()).success, false);
    assert.deepEqual(f.accounts(), beforeAccounts); assert.deepEqual(f.sessions(), beforeSessions);
    assert.ok(f.state.calls.includes('ROLLBACK'));
    assert.equal((await f.request('/api/admin', target)).status, 200);
    assert.equal((await f.request('/api/admin', admin)).status, 200);
    await assert.rejects(verifyAccountLogin({ username: 'fixture2', password: 'synthetic-after' }), { statusCode: 401 });
});

test('Pre-existing sessions upgrade without logging out other accounts; invalidated legacy cookies stay rejected', async t => {
    const f = await fixture(t), admin = await f.login(1), target = await f.login(2), other = await f.login(3);
    for (const row of f.sessions().values()) delete row.accountCredentialVersion;
    assert.equal((await f.request('/api/admin', other)).status, 200);
    assert.ok([...f.sessions().values()].find(row => row.user.userId === 3).accountCredentialVersion);
    const legacy = structuredClone([...f.sessions().values()].find(row => row.user.userId === 2));
    assert.equal((await f.reset(admin, 2)).status, 200);
    assert.equal(await refreshAccountSessionData('deleted-legacy-sid', legacy), null);
    assert.equal((await f.request('/api/admin', target)).status, 401);
    assert.equal((await f.request('/api/admin', admin)).status, 200);
    assert.equal((await f.request('/api/admin', other)).status, 200);
});

test('Guest session checks retain their existing behavior without account credential queries', async t => {
    await fixture(t);
    t.mock.method(pool, 'query', () => assert.fail('Guest account checks must not query app_user'));
    const req = { path: '/api/protected', session: { user: { role: 'guest', displayName: 'Synthetic Guest' } } };
    let passed = false;
    await refreshAccountSession(req, {}, () => { requireAuth(req, {}, () => { passed = true; }); });
    assert.equal(passed, true);
    assert.equal(req.session.accountCredentialVersion, undefined);
});

test('Credential validation and session destruction errors never reach protected handlers', async t => {
    const f = await fixture(t), admin = await f.login(1), target = await f.login(2);
    const row = [...f.sessions().values()].find(row => row.user.userId === 2);
    row.accountCredentialVersion = 'invalid-credential-marker';
    f.state.failDestroy = true;
    assert.equal((await f.request('/api/admin', target)).status, 503);
    f.state.failDestroy = false;
    assert.equal((await f.request('/api/admin', target)).status, 401);
    f.state.unavailable = true;
    assert.equal((await f.request('/api/admin', admin)).status, 503);
    f.state.unavailable = false;
    assert.equal((await f.request('/api/admin', admin)).status, 200);
});

test('Upsert still applies the existing explicit role/reactivation semantics and default Admin role', async t => {
    const f = await fixture(t);
    f.accounts()[1].role = 'staff'; f.accounts()[1].is_active = false;
    await upsertAccount({ username: 'fixture2', password: 'synthetic-after', role: 'staff' });
    assert.equal(f.accounts()[1].role, 'staff'); assert.equal(f.accounts()[1].is_active, true);
    const created = await upsertAccount({ username: 'synthetic-new', password: 'synthetic-only' });
    assert.equal(created.role, 'admin');
});

test('CLI admin setup creates and resets accounts before the session table exists', async t => {
    const f = await fixture(t);
    f.state.sessionTableExists = false;
    const created = await upsertAccount({ username: 'fresh-cli-admin', password: 'synthetic-first', displayName: 'CLI Admin' });
    assert.equal(created.role, 'admin');
    assert.equal((await verifyAccountLogin({ username: created.username, password: 'synthetic-first' })).userId, created.user_id);
    const reset = await upsertAccount({ username: created.username, password: 'synthetic-second', displayName: 'CLI Admin' });
    assert.equal(reset.user_id, created.user_id);
    assert.equal((await verifyAccountLogin({ username: created.username, password: 'synthetic-second' })).userId, created.user_id);
    await assert.rejects(verifyAccountLogin({ username: created.username, password: 'synthetic-first' }), { statusCode: 401 });
    assert.equal(f.state.calls.filter(sql => sql.includes('AS session_table_exists')).length, 2);
    assert.equal(f.state.calls.filter(sql => sql.startsWith('DELETE FROM "session"')).length, 0);
    assert.equal(f.state.calls.filter(sql => sql === 'COMMIT').length, 2);
    assert.equal(f.state.calls.includes('ROLLBACK'), false);
});

for (const operation of ['catalog', 'revocation']) {
    for (const code of ['42501', '42P01']) test(`${operation} SQL error ${code} rolls back instead of skipping revocation`, async t => {
        const f = await fixture(t);
        const before = structuredClone(f.accounts());
        const failure = Object.assign(Error(`synthetic ${operation} failure`), { code });
        f.state[operation === 'catalog' ? 'catalogError' : 'revocationError'] = failure;
        await assert.rejects(upsertAccount({ username: 'fixture2', password: 'synthetic-after', role: 'admin' }), error => error === failure);
        assert.deepEqual(f.accounts(), before);
        assert.equal(f.state.calls.includes('COMMIT'), false);
        assert.equal(f.state.calls.includes('ROLLBACK'), true);
    });
}

test('An unknown session catalog result fails closed instead of reporting a successful reset', async t => {
    const f = await fixture(t), before = structuredClone(f.accounts());
    f.state.sessionTableExists = undefined;
    await assert.rejects(upsertAccount({ username: 'fixture2', password: 'synthetic-after' }), /Cannot verify session store availability/);
    assert.deepEqual(f.accounts(), before);
    assert.ok(f.state.calls.includes('ROLLBACK'));
});
