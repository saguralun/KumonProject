import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { createAccount, resetAccountPassword, updateAccountRole, setAccountActive } from '../../services/authService.js';
import { setRolePermissions, roleHasPermission } from '../../services/roleService.js';

// Only called after isolatedDatabase.integration.test.js verifies its temporary
// PostgreSQL cluster and replaces both application pool entry points.
export async function checkConcurrentPermissions(database) {
    const role = 'audit_two_machines';
    const keys = (await database.query('SELECT permission_key FROM permission_master ORDER BY permission_key LIMIT 2')).rows.map(row => row.permission_key);
    assert.equal(keys.length, 2);
    await database.query('INSERT INTO role_master(role_code,role_name,is_system,sort_order) VALUES($1,$2,FALSE,999)', [role, 'Synthetic only']);
    const read = async () => (await database.query('SELECT permission_key FROM role_permission WHERE role_code=$1 ORDER BY permission_key', [role])).rows.map(row => row.permission_key);
    try {
        await setRolePermissions(role, [keys[0]], []);
        const snapshot = await read();
        // Both writers start together on separate pool connections. Their role
        // row lock must serialize check-and-write, not just the final INSERT.
        const results = await Promise.allSettled([
            setRolePermissions(role, [], snapshot),
            setRolePermissions(role, keys, snapshot)
        ]);
        assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
        assert.equal(results.find(row => row.status === 'rejected').reason.statusCode, 409);
        const winner = results[0].status === 'fulfilled' ? [] : [...keys].sort();
        assert.deepEqual(await read(), winner);
        await setRolePermissions(role, [keys[0]], winner);
        await setRolePermissions(role, [], [keys[0]]);
        await assert.rejects(setRolePermissions(role, keys, [keys[0]]), { statusCode: 409 });
        assert.deepEqual(await read(), []);
        assert.equal(await roleHasPermission(role, keys[0]), false);
        await setRolePermissions(role, [keys[1]], []);
        assert.equal(await roleHasPermission(role, keys[1]), true);
        await assert.rejects(setRolePermissions(role, ['unknown-audit-key'], [keys[1]]), { statusCode: 400 });
        assert.deepEqual(await read(), [keys[1]], 'Bad key must roll back the preceding DELETE');
    } finally {
        await database.query('DELETE FROM role_master WHERE role_code=$1', [role]);
    }
}

export async function checkAccountSeparation(database) {
    const ids = [];
    const schema = async () => (await database.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='kumon' ORDER BY table_name,ordinal_position")).rows;
    const beforeSchema = await schema();
    const read = async id => (await database.query('SELECT * FROM app_user WHERE user_id=$1', [id])).rows[0];
    try {
        const user = await createAccount({ username: 'audit-create-only', password: 'synthetic-before', displayName: 'Keep original', role: 'staff' });
        ids.push(user.user_id);
        await setAccountActive(user.user_id, false);
        const before = await read(user.user_id);
        await assert.rejects(createAccount({ username: user.username, password: 'synthetic-wrong', displayName: 'Wrong', role: 'admin' }), { statusCode: 409 });
        assert.deepEqual(await read(user.user_id), before);
        const result = await resetAccountPassword(user.user_id, 'synthetic-after');
        assert.deepEqual(Object.keys(result).sort(), ['display_name', 'is_active', 'role', 'user_id', 'username']);
        const after = await read(user.user_id);
        for (const key of Object.keys(before).filter(key => !['password_hash', 'updated_at'].includes(key))) assert.deepEqual(after[key], before[key], key);
        assert.equal(await bcrypt.compare('synthetic-after', after.password_hash), true);
        // Reset cannot reinstate the stale role or re-enable an account when
        // another machine explicitly changes that account at the same time.
        await Promise.all([resetAccountPassword(user.user_id, 'synthetic-third'), updateAccountRole(user.user_id, 'instructor')]);
        const concurrent = await read(user.user_id);
        assert.equal(concurrent.role, 'instructor'); assert.equal(concurrent.is_active, false);
        assert.equal(concurrent.display_name, before.display_name);
        assert.equal(await bcrypt.compare('synthetic-third', concurrent.password_hash), true);
        await assert.rejects(createAccount({ username: 'audit-no-role', password: 'synthetic-before' }), { statusCode: 400 });
        await assert.rejects(createAccount({ username: 'audit-guest', password: 'synthetic-before', role: 'guest' }), { statusCode: 400 });
        assert.deepEqual(await schema(), beforeSchema, 'No schema changes are needed for account separation');
    } finally {
        await database.query('DELETE FROM app_user WHERE user_id=ANY($1::int[])', [ids]);
    }
}
