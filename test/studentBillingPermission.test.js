import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import pool from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import studentRoutes from '../routes/studentRoutes.js';
import { cancelReceiptPayment } from '../services/paymentService.js';

function database(t) {
  const queries = [];
  t.mock.method(pool, 'query', () => assert.fail('Never use the production pool or query Payment page permissions'));
  t.mock.method(pool, 'connect', async () => ({ release() {}, async query(sql) {
    const text = sql.replace(/\s+/g, ' ').trim(); queries.push(text);
    if (text.includes('information_schema.columns')) return { rows: [{ column_name: 'inserted_status_history_id' }, { column_name: 'payment_status_updated_at' }] };
    if (text.includes('FROM kumon.billing WHERE billing_id')) return { rows: [{ billing_id: 77, student_id: 1, receipt_book: 10, receipt_no: 42, billing_month: 10, billing_year: 2026 }] };
    if (text.includes('FROM kumon.billing_detail detail')) return { rows: [{ billing_detail_id: 88, enrollment_id: 10, status_group1_id: 1, inserted_status_history_id: null, payment_status_updated_at: null }] };
    if (text.includes('FROM kumon.enrollment enrollment')) return { rows: [{ enrollment_id: 10, status_code: 'C', payment_unchanged: false }] };
    assert.match(text, /^(BEGIN|COMMIT|ROLLBACK|SELECT pg_advisory_xact_lock|DELETE FROM kumon\.(billing_detail|billing)\b)/);
    return { rows: [], rowCount: 1 };
  } }));
  return queries;
}

async function appFixture(t) {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { const role = req.get('x-role'); if (role) req.session = { user: { role, userId: 1 } }; next(); });
  app.use('/api/students', requireAuth, studentRoutes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return (role, studentId = '1', body = {}, billingId = '77') => fetch(`http://127.0.0.1:${server.address().port}/api/students/${studentId}/history/billing/${billingId}/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(role ? { 'x-role': role } : {}) }, body: JSON.stringify(body)
  });
}

test('Student bill cancellation allows Admin/Instructor without Payment page permission and rejects every lower role', async t => {
  const queries = database(t), call = await appFixture(t);
  assert.equal((await call(null)).status, 401);
  for (const role of ['staff', 'guest', 'custom']) assert.equal((await call(role)).status, 403);
  assert.equal(queries.length, 0);
  for (const role of ['admin', 'instructor']) {
    const response = await call(role); assert.equal(response.status, 200);
    assert.equal((await response.json()).billingId, 77);
  }
  assert.equal(queries.filter(sql => sql === 'COMMIT').length, 2);
});

test('A student route cannot cancel another child’s bill or trust a spoofed body identity', async t => {
  const queries = database(t), call = await appFixture(t);
  assert.equal((await call('instructor', '2', { studentId: 1, billingId: 77 })).status, 404);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.equal(queries.some(sql => /^(DELETE|UPDATE|INSERT)/.test(sql)), false);
  const before = queries.length;
  for (const value of ['bad', '0', '-1']) assert.equal((await call('instructor', value)).status, 400);
  assert.equal((await call('instructor', '1', {}, 'bad')).status, 400);
  assert.equal(queries.length, before);
});

test('Existing Payment cancellation callers can still omit a student scope', async t => {
  const queries = database(t);
  assert.equal((await cancelReceiptPayment({ billingId: 77 })).billingId, 77);
  assert.equal(queries.at(-1), 'COMMIT');
});
