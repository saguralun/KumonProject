import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { listRoles, deleteRole } from '../services/roleService.js';

test('Role usage lists active, inactive and total accounts without writes', async t => {
  t.mock.method(pool, 'connect', () => { throw Error('No database connections allowed'); });
  t.mock.method(pool, 'query', async sql => {
    assert.doesNotMatch(sql, /\b(UPDATE|INSERT|DELETE|ALTER|DROP)\b/i);
    assert.match(sql, /AS total_user_count/);
    assert.match(sql, /AS inactive_user_count/);
    return { rows: [{ role_code: 'inactive-only', active_user_count: 0, inactive_user_count: 1, total_user_count: 1 }] };
  });
  const rows = await listRoles();
  assert.equal(rows[0].total_user_count, 1);
});

test('An inactive account still prevents role deletion on the server', async t => {
  const calls = [];
  t.mock.method(pool, 'connect', () => { throw Error('No database connections allowed'); });
  t.mock.method(pool, 'query', async sql => {
    calls.push(sql);
    if (sql.includes('SELECT is_system')) return { rows: [{ is_system: false }] };
    if (sql.includes('COUNT(*)')) { assert.doesNotMatch(sql, /is_active/); return { rows: [{ count: 1 }] }; }
    throw Error('No writes allowed');
  });
  await assert.rejects(deleteRole('inactive-only'), { statusCode: 409 });
  assert.equal(calls.length, 2);
});
