import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import pool from '../config/db.js';
import systemRoutes from '../routes/systemRoutes.js';

test('The retired preparation endpoint is absent for all roles; optional Admin diagnostics remain read-only', async (t) => {
    const queries = [];
    t.mock.method(pool, 'query', async (sql) => { queries.push(sql); return { rows: [{ column_name: 'inserted_status_history_id' }, { column_name: 'payment_status_updated_at' }] }; });
    t.mock.method(pool, 'connect', () => assert.fail('No migration authorized in this test'));
    const app = express(); app.use(express.json());
    app.use((req, _res, next) => { const role = req.get('x-role'); if (role) req.session = { user: { role } }; next(); });
    app.use('/api/system', systemRoutes);
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
        const call = (role, method, action, body) => fetch(`http://127.0.0.1:${server.address().port}/api/system/database/${action}`, {
            method, headers: { 'Content-Type': 'application/json', ...(role ? { 'x-role': role } : {}) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
        });
        for (const role of [null, 'guest', 'staff', 'instructor', 'admin']) {
            assert.equal((await call(role, 'POST', 'prepare', { confirm: true })).status, 404);
        }
        assert.equal((await call(null, 'GET', 'status')).status, 401);
        for (const role of ['guest', 'staff', 'instructor']) {
            assert.equal((await call(role, 'GET', 'status')).status, 403);
        }
        assert.equal(queries.length, 0);
        const response = await call('admin', 'GET', 'status');
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal((await response.json()).ready, true);
        assert.equal(queries.length, 1); assert.doesNotMatch(queries[0], /ALTER|UPDATE|INSERT/);
    } finally { await new Promise((resolve) => server.close(resolve)); }
});
