import assert from 'node:assert/strict';
import { test } from 'node:test';
import bcrypt from 'bcryptjs';
import pool from '../config/db.js';
import { setAccountActive, updateAccountRole, upsertAccount } from '../services/authService.js';

function accountsFixture(t, initial, { failWrite = false, failRollback = false } = {}) {
    let rows = structuredClone(initial), lockTail = Promise.resolve();
    const calls = [], releases = [];
    t.mock.method(pool, 'query', () => assert.fail('Account mutations must not query the production pool'));
    t.mock.method(bcrypt, 'hash', async () => 'fixture-hash');
    t.mock.method(pool, 'connect', async () => {
        let unlock, working, inTransaction = false;
        return {
            async query(sql, params = []) {
                const normalized = sql.replace(/\s+/g, ' ').trim();
                calls.push(normalized);
                if (normalized.startsWith('BEGIN')) { inTransaction = true; return { rows: [] }; }
                if (normalized.startsWith('LOCK TABLE app_user')) {
                    assert.equal(inTransaction, true);
                    assert.match(normalized, /IN SHARE ROW EXCLUSIVE MODE$/);
                    const preceding = lockTail;
                    lockTail = new Promise(resolve => { unlock = resolve; });
                    await preceding;
                    working = structuredClone(rows);
                    return { rows: [] };
                }
                if (normalized === 'ROLLBACK') {
                    if (failRollback) throw Error('fixture rollback failure');
                    working = null;
                    return { rows: [] };
                }
                assert.ok(working, 'All reads and writes must occur after acquiring the shared account lock');
                if (normalized === 'COMMIT') { rows = working; return { rows: [] }; }
                if (normalized.startsWith('SELECT 1 FROM role_master')) {
                    return { rows: ['admin', 'staff'].includes(params[0]) ? [{}] : [] };
                }
                if (normalized.startsWith('SELECT COUNT(*)')) {
                    return { rows: [{ count: working.filter(row => row.role === 'admin' && row.is_active && row.user_id !== Number(params[0])).length }] };
                }
                if (normalized.startsWith('SELECT')) {
                    const row = working.find(row => normalized.includes('WHERE username') ? row.username === params[0] : row.user_id === Number(params[0]));
                    return { rows: row ? [{ ...row }] : [] };
                }
                if (failWrite) throw Error('fixture write failure');
                if (normalized.startsWith('INSERT INTO app_user')) {
                    let row = working.find(row => row.username === params[0]);
                    if (!row) { row = { user_id: working.length + 1, username: params[0] }; working.push(row); }
                    Object.assign(row, { password_hash: params[1], display_name: params[2], role: params[3], is_active: true });
                    return { rows: [{ ...row }] };
                }
                assert.match(normalized, /^UPDATE app_user/);
                const row = working.find(row => row.user_id === Number(params[0]));
                if (!row) return { rows: [] };
                if (normalized.includes('SET is_active')) row.is_active = params[1];
                else row.role = params[1];
                return { rows: [{ ...row }] };
            },
            release(error) { releases.push(error); unlock?.(); }
        };
    });
    return { rows: () => rows, calls, releases };
}

const admin = id => ({ user_id: id, username: `admin${id}`, role: 'admin', is_active: true });
const operations = {
    disable: id => setAccountActive(id, false),
    demote: id => updateAccountRole(id, 'staff'),
    upsert: id => upsertAccount({ username: `admin${id}`, password: 'fixture-only', role: 'staff' })
};

for (const [firstName, first] of Object.entries(operations)) {
    for (const [secondName, second] of Object.entries(operations)) {
        test(`Concurrent ${firstName}/${secondName} cannot remove both active admins`, async t => {
            const fixture = accountsFixture(t, [admin(1), admin(2)]);
            const results = await Promise.allSettled([first(1), second(2)]);
            assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
            const rejected = results.find(result => result.status === 'rejected');
            assert.equal(rejected.reason.statusCode, 400);
            assert.equal(fixture.rows().filter(row => row.role === 'admin' && row.is_active).length, 1);
            assert.equal(fixture.calls.filter(sql => sql === 'COMMIT').length, 1);
            assert.equal(fixture.calls.filter(sql => sql === 'ROLLBACK').length, 1);
            assert.equal(fixture.releases.length, 2);
        });
    }
}

test('Account creation/reactivation and harmless inactive-admin edits remain available', async t => {
    const inactive = { ...admin(2), is_active: false };
    const fixture = accountsFixture(t, [admin(1), inactive]);
    assert.equal((await setAccountActive(2, false)).is_active, false);
    assert.equal((await updateAccountRole(2, 'staff')).role, 'staff');
    assert.equal((await upsertAccount({ username: 'admin2', password: 'fixture', role: 'admin' })).is_active, true);
    await setAccountActive(1, false);
    assert.equal((await upsertAccount({ username: 'new-admin', password: 'fixture' })).role, 'admin');
    assert.equal(fixture.rows().filter(row => row.role === 'admin' && row.is_active).length, 2);
    await assert.rejects(updateAccountRole(2, 'guest'), error => error.statusCode === 400);
    await assert.rejects(updateAccountRole(2, 'missing-role'), error => error.statusCode === 400);
    await assert.rejects(setAccountActive(999, true), error => error.statusCode === 404);
});

for (const failRollback of [false, true]) test(`Failed account write rolls back and releases the client (rollback failure: ${failRollback})`, async t => {
    const fixture = accountsFixture(t, [admin(1), admin(2)], { failWrite: true, failRollback });
    await assert.rejects(setAccountActive(1, false), /fixture write failure/);
    assert.equal(fixture.rows().filter(row => row.is_active).length, 2);
    assert.ok(fixture.calls.includes('ROLLBACK'));
    assert.equal(fixture.releases.length, 1);
    if (failRollback) assert.match(fixture.releases[0].message, /fixture rollback failure/);
    else assert.equal(fixture.releases[0], undefined);
});
