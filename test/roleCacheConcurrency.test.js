import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return { promise, resolve };
}

for (const seedFreshCache of [false, true]) {
    test(`Revoking a grant discards pending old permission loads (new cache already loaded: ${seedFreshCache})`, async t => {
        const oldRead = deferred(), readStarted = deferred();
        let grants = ['page:payment'], reads = 0;
        t.mock.method(pool, 'query', async (sql) => {
            if (sql === 'SELECT role_code, permission_key FROM role_permission') {
                reads++;
                const snapshot = grants.map(permission_key => ({ role_code: 'staff', permission_key }));
                if (reads === 1) {
                    readStarted.resolve();
                    await oldRead.promise;
                }
                return { rows: snapshot };
            }
            if (sql.startsWith('SELECT role_code FROM role_master')) return { rows: [{ role_code: 'staff' }] };
            if (sql.startsWith('SELECT permission_key FROM role_permission')) return { rows: grants.map(permission_key => ({ permission_key })) };
            assert.fail(`Unexpected database query: ${sql}`);
        });
        t.mock.method(pool, 'connect', async () => ({
            async query(sql) {
                if (sql.startsWith('DELETE FROM role_permission')) grants = [];
                else assert.ok(['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql), sql);
                return { rows: [] };
            },
            release() {}
        }));
        const roles = await import(`../services/roleService.js?revoke-race-${seedFreshCache}`);
        const staleAuthorization = roles.roleHasPermission('staff', 'page:payment');
        await readStarted.promise;
        await roles.setRolePermissions('staff', []);
        if (seedFreshCache) assert.deepEqual(await roles.grantedPermissionsFor('staff'), []);
        oldRead.resolve();
        assert.equal(await staleAuthorization, false, 'Even the pending caller must not use the revoked grant');
        assert.equal(await roles.roleHasPermission('staff', 'page:payment'), false);
        assert.deepEqual(await roles.grantedPermissionsFor('staff'), []);
        assert.equal(reads, 2, 'Subsequent readers should reuse the current cache');
    });
}

test('A failed permission read remains fail-closed and can be retried', async t => {
    t.mock.method(pool, 'connect', () => assert.fail('No database connections allowed'));
    let reads = 0;
    t.mock.method(pool, 'query', async sql => {
        assert.match(sql, /^SELECT role_code, permission_key FROM role_permission$/);
        if (++reads === 1) throw Error('fixture read failure');
        return { rows: [{ role_code: 'staff', permission_key: 'page:report' }] };
    });
    const roles = await import('../services/roleService.js?read-failure');
    await assert.rejects(roles.grantedPermissionsFor('staff'), /fixture read failure/);
    assert.deepEqual(await roles.grantedPermissionsFor('staff'), ['page:report']);
    assert.equal(await roles.roleHasPermission('staff', 'page:payment'), false);
    assert.equal(reads, 2);
});
