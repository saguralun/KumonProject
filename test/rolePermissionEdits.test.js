import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { setRolePermissions, roleHasPermission } from '../services/roleService.js';
import express from 'express';
import { once } from 'node:events';
import roleRoutes from '../routes/roleRoutes.js';
import { requireAdmin } from '../middleware/auth.js';

pool.query = () => assert.fail('Production query forbidden');
pool.connect = () => assert.fail('Production connect forbidden');
function fixture(t) {
    let grants = ['page:stock'], locks = 0;
    const read = async sql => {
        if (sql.includes('FROM role_master')) return { rows: [{ role_code: 'staff' }] };
        if (sql.includes('FROM role_permission')) return { rows: grants.map(permission_key => ({ role_code: 'staff', permission_key })) };
        assert.fail('Unexpected fixture read: ' + sql);
    };
    t.mock.method(pool, 'query', read);
    t.mock.method(pool, 'connect', async () => {
        let pending = null;
        return { release() {}, async query(sql, p = []) {
            if (sql.includes('FOR UPDATE')) locks++;
            if (['BEGIN', 'ROLLBACK'].includes(sql)) { pending = null; return { rows: [] }; }
            if (sql === 'COMMIT') { if (pending) grants = pending; return { rows: [] }; }
            if (sql.startsWith('DELETE FROM role_permission')) { pending = []; return { rows: [] }; }
            if (sql.includes('INSERT INTO role_permission')) {
                if (p.includes('bad-key')) throw Object.assign(Error('Invalid key'), { code: '23503' });
                pending = p.slice(1); return { rows: [] };
            }
            if (sql.includes('FROM role_permission') && pending) return { rows: pending.map(permission_key => ({ permission_key })) };
            return read(sql);
        } };
    });
    return { grants: () => grants, locks: () => locks };
}

test('Two admins with the same snapshot cannot restore a permission revoked by the first machine', async t => {
    const f = fixture(t), bothMachinesRead = ['page:stock'];
    await setRolePermissions('staff', [], bothMachinesRead);
    await assert.rejects(setRolePermissions('staff', ['page:stock', 'page:report'], bothMachinesRead), { statusCode: 409 });
    assert.deepEqual(f.grants(), []);
    assert.equal(await roleHasPermission('staff', 'page:stock'), false);
    await setRolePermissions('staff', ['page:report'], []);
    assert.deepEqual(f.grants(), ['page:report']); assert.equal(f.locks(), 3);
});

test('Permission comparison uses sets and rejected writes retain grants', async t => {
    const f = fixture(t);
    await setRolePermissions('staff', ['page:report', 'page:stock'], ['page:stock', 'page:stock']);
    await setRolePermissions('staff', ['page:report'], ['page:stock', 'page:report']);
    await assert.rejects(setRolePermissions('staff', ['bad-key'], ['page:report']), { statusCode: 400 });
    assert.deepEqual(f.grants(), ['page:report']);
    for (const role of ['admin', 'guest']) await assert.rejects(setRolePermissions(role, [], []), { statusCode: 400 });
});

test('Permission HTTP endpoint requires a snapshot and Admin access before any grant write', async t => {
    const f = fixture(t), app = express(); app.use(express.json());
    // Synthetic identities only; the real guard/router/service are exercised.
    app.use((req, _res, next) => { req.session = req.headers['x-fixture-role'] ? { user: { role: req.headers['x-fixture-role'] } } : {}; next(); });
    app.use('/roles', requireAdmin, roleRoutes);
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const put = (body, role = 'admin') => fetch(`http://127.0.0.1:${server.address().port}/roles/staff/permissions`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-fixture-role': role } : {}) }, body: JSON.stringify(body)
    });
    const desired = { permissionKeys: [], expectedPermissionKeys: ['page:stock'] };
    assert.equal((await put(desired, null)).status, 401);
    assert.equal((await put(desired, 'staff')).status, 403);
    assert.equal((await put({ permissionKeys: [] })).status, 409);
    assert.equal((await put({ permissionKeys: 'wrong', expectedPermissionKeys: [] })).status, 400);
    assert.equal(f.locks(), 0); assert.deepEqual(f.grants(), ['page:stock']);
    assert.equal((await put(desired)).status, 200);
    assert.equal((await put(desired)).status, 409);
    assert.deepEqual(f.grants(), []);
});
