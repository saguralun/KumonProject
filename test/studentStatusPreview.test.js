import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { previewEnrollmentStatusAction, applyEnrollmentStatusAction } from '../services/studentService.js';
import express from 'express';
import { once } from 'node:events';
import studentRoutes from '../routes/studentRoutes.js';

pool.query = () => assert.fail('Production DB forbidden');
pool.connect = () => assert.fail('Production DB forbidden');

function fixture(t, { billing = { month: 7, year: 2026 }, other = false, level = 'O', passed = true } = {}) {
  const calls = [], writes = [];
  const config = { billing, other };
  let released = 0;
  const client = { release() { released++; }, async query(sql, params = []) {
    const compact = sql.replace(/\s+/g, ' ').trim(); calls.push({ sql: compact, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)/.test(compact)) return { rows: [] };
    if (compact.includes('AND e.enrollment_id = $2')) return { rows: [{ enrollment_id: 10, student_id: 1, subject_code: 'ME', current_level_code: level,
      has_passed_current_level_at: passed, en_start_date: '2026-01-01', current_status_group1_id: 2, current_status_group2_id: 7 }] };
    if (compact.includes('FROM kumon.billing_detail')) return { rows: config.billing ? [{ billing_month: config.billing.month, billing_year: config.billing.year }] : [] };
    if (compact.includes('e.enrollment_id <>')) return { rows: config.other ? [{ value: 1 }] : [] };
    if (compact.includes('FROM kumon.status_master')) return { rows: [{ status_id: { A: 2, R: 3, N: 4, EO: 5, CP: 6, H: 7, OT: 8 }[params[0]] }] };
    if (/^(UPDATE|INSERT|DELETE)/.test(compact)) { writes.push({ sql: compact, params }); return { rows: compact.startsWith('INSERT') ? [{ enrollment_status_id: 50 }] : [] }; }
    if (compact.includes('FROM kumon.student student')) return { rows: [{ student_id: 1, first_name: 'Synthetic', last_name: 'Child' }] };
    if (compact.includes('FROM kumon.enrollment e')) return { rows: [] };
    assert.fail('Unexpected fixture query: ' + compact);
  } };
  t.mock.method(pool, 'connect', async () => client);
  return { calls, writes, config, released: () => released };
}

test('Absent preview discloses the next billing period, including year rollover, without locking or writing', async t => {
  const f = fixture(t, { billing: { month: 12, year: 2026 } });
  const { preview } = await previewEnrollmentStatusAction(1, 10, { action: 'absent' });
  assert.deepEqual(preview.period, { month: 1, year: 2027 }); assert.equal(preview.statusCode, 'A');
  assert.equal(preview.startDate, '2026-01-01'); assert.equal(preview.changesStartDate, false);
  assert.equal(preview.periodSource, 'next_billing'); assert.match(preview.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(f.calls[0].sql, 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.ok(!f.calls.some(call => call.sql.includes('FOR UPDATE'))); assert.equal(f.writes.length, 0); assert.equal(f.released(), 1);
});

for (const [date, billing, other, status, period, half, changes] of [
  ['2026-11-10', { month: 7, year: 2026 }, false, 'R', 11, false, false],
  ['2026-11-20', { month: 7, year: 2026 }, false, 'R', 11, true, false],
  ['2026-11-21', { month: 7, year: 2026 }, false, 'N', 12, false, true],
  ['2026-11-21', { month: 7, year: 2026 }, true, 'EO', 12, false, true],
  ['2026-11-15', null, false, 'R', 11, true, false]
]) test(`Resume preview preserves existing ${status} and half-month rules for ${date}, other=${other}, billing=${billing?.month ?? 'none'}`, async t => {
  const f = fixture(t, { billing, other });
  const { preview } = await previewEnrollmentStatusAction(1, 10, { action: 'resume', resumeDate: date });
  assert.equal(preview.statusCode, status); assert.equal(preview.period.month, period);
  assert.equal(preview.halfMonth, half); assert.equal(preview.changesStartDate, changes);
  assert.equal(preview.startDate, changes ? date : '2026-01-01'); assert.equal(f.writes.length, 0);
});

test('Missing bills use the current Kumon period; ineligible Completer and invalid dates never write', async t => {
  const f = fixture(t, { billing: null, passed: false });
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-24T12:00:00+07:00').getTime() });
  const { preview } = await previewEnrollmentStatusAction(1, 10, { action: 'outgoingTransfer' });
  assert.deepEqual(preview.period, { month: 12, year: 2026 }); assert.equal(preview.periodSource, 'current');
  await assert.rejects(previewEnrollmentStatusAction(1, 10, { action: 'completer' }), { statusCode: 400 });
  await assert.rejects(previewEnrollmentStatusAction(1, 10, { action: 'resume', resumeDate: 'invalid' }), { statusCode: 400 });
  assert.equal(f.writes.length, 0); assert.equal(f.released(), 3);
});

test('A changed billing period after Preview rejects the optional confirmation snapshot before any write', async t => {
  const f = fixture(t);
  const { preview } = await previewEnrollmentStatusAction(1, 10, { action: 'absent' });
  f.config.billing = { month: 8, year: 2026 };
  await assert.rejects(applyEnrollmentStatusAction(1, 10, { action: 'absent', expectedPlan: preview.fingerprint }), { statusCode: 409 });
  assert.equal(f.writes.length, 0); assert.ok(f.calls.some(call => call.sql.includes('FOR UPDATE')));
  assert.equal(f.calls.at(-1).sql, 'ROLLBACK'); assert.equal(f.released(), 2);
});

test('An unchanged Preview and legacy clients both retain the original write contract', async t => {
  const f = fixture(t);
  const { preview } = await previewEnrollmentStatusAction(1, 10, { action: 'resume', resumeDate: '2026-11-20' });
  await applyEnrollmentStatusAction(1, 10, { action: 'resume', resumeDate: '2026-11-20', expectedPlan: preview.fingerprint });
  assert.deepEqual(f.writes[0].params, [3, 7, false, '2026-11-20', 10, 1]);
  await applyEnrollmentStatusAction(1, 10, { action: 'absent' });
  assert.deepEqual(f.writes[1].params, [2, 10, 1]);
  assert.deepEqual(f.writes[2].params, [10, 2, 8, 2026]); assert.equal(f.released(), 3);
});

test('Status Preview HTTP is no-store, allows Admin/Instructor and refuses Guest or signed-out access without querying', async t => {
  const f = fixture(t), app = express();
  app.use((req, _res, next) => { req.session = { user: req.get('x-fixture-role') ? { role: req.get('x-fixture-role') } : null }; next(); });
  app.use('/api/students', studentRoutes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}/api/students/1/enrollments/10/status-preview?action=absent`;
    for (const role of ['admin', 'instructor']) {
      const response = await fetch(url, { headers: { 'x-fixture-role': role } });
      assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
      assert.equal((await response.json()).preview.statusCode, 'A');
    }
    const count = f.calls.length;
    assert.equal((await fetch(url, { headers: { 'x-fixture-role': 'guest' } })).status, 403);
    assert.equal((await fetch(url)).status, 401); assert.equal(f.calls.length, count); assert.equal(f.writes.length, 0);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
