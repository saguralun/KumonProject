// Read-only production verification: only the direct CLI writes the evidence JSON.
// The worker inherits no environment, never evaluates config/db.js or dotenv,
// and replaces only the database boundary. Service/middleware code is unmodified.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const scriptPath = fileURLToPath(import.meta.url);
const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const evidencePath = resolve(projectRoot, 'test/reviews/2026-11-24/auth-evidence.json');
const workerFlag = '--auth-session-review-worker';
const execFileAsync = promisify(execFile);

// Exact statements, not startsWith('SELECT')/catch-all fake successes. A changed
// production query must be reviewed before this audit can claim new evidence.
const SQL = Object.freeze({
  begin: 'BEGIN ISOLATION LEVEL READ COMMITTED',
  lock: 'LOCK TABLE app_user IN SHARE ROW EXCLUSIVE MODE',
  role: 'SELECT 1 FROM role_master WHERE role_code = $1',
  existing: 'SELECT user_id, role, is_active FROM app_user WHERE username = $1',
  otherAdmins: "SELECT COUNT(*)::int AS count FROM app_user WHERE role = 'admin' AND is_active = TRUE AND user_id != $1",
  upsert: 'INSERT INTO app_user (username, password_hash, display_name, role) VALUES ($1, $2, $3, $4) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, display_name = EXCLUDED.display_name, role = EXCLUDED.role, is_active = TRUE, updated_at = CURRENT_TIMESTAMP RETURNING user_id, username, display_name, role',
  active: 'SELECT user_id, username, display_name, role FROM app_user WHERE user_id = $1 AND is_active = TRUE',
  login: 'SELECT user_id, username, password_hash, display_name, role, is_active FROM app_user WHERE username = $1',
  loginTime: 'UPDATE app_user SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1',
  target: 'SELECT role, is_active FROM app_user WHERE user_id = $1',
  setActive: 'UPDATE app_user SET is_active = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1 RETURNING user_id, username, display_name, role, is_active',
  commit: 'COMMIT',
  rollback: 'ROLLBACK'
});
const normalizeSql = sql => {
  assert.equal(typeof sql, 'string', 'SQL must be an explicit string');
  return sql.replace(/\s+/g, ' ').trim();
};
const project = (row, fields) => Object.fromEntries(fields.map(key => [key, row[key]]));
const publicAccount = row => project(row, ['user_id', 'username', 'display_name', 'role', 'is_active']);

function createSqlFixture() {
  let rows = [], connected = false, nextId = 1;
  const trace = [], rejectedSql = [];
  const fixture = {
    phase: 'setup', unavailable: false, trace, rejectedSql,
    snapshot(username) {
      const row = rows.find(value => value.username === username);
      assert.ok(row, 'Requested fixture account must exist');
      return publicAccount(row);
    },
    storedHash(username) { return rows.find(row => row.username === username)?.password_hash; },
    assertReleased() { assert.equal(connected, false, 'Service must release its transaction client'); }
  };
  function identify(sql, params) {
    const normalized = normalizeSql(sql);
    const entry = Object.entries(SQL).find(([, value]) => value === normalized);
    if (!entry) {
      rejectedSql.push({ phase: fixture.phase });
      throw new Error('UNKNOWN_SQL_REJECTED');
    }
    assert.ok(Array.isArray(params), 'SQL parameters must be an array');
    const expected = { begin: 0, lock: 0, role: 1, existing: 1, otherAdmins: 1,
      upsert: 4, active: 1, login: 1, loginTime: 1, target: 1, setActive: 2, commit: 0, rollback: 0 };
    assert.equal(params.length, expected[entry[0]], 'SQL parameter count must match');
    trace.push({ phase: fixture.phase, operation: entry[0], sql: normalized });
    return entry[0];
  }
  const pool = {
    async query(sql, params = []) {
      const operation = identify(sql, params);
      assert.ok(['active', 'login', 'loginTime'].includes(operation), 'Unexpected pool statement');
      if (fixture.unavailable) throw new Error('SYNTHETIC_DATABASE_UNAVAILABLE');
      if (operation === 'active') {
        const row = rows.find(value => value.user_id === Number(params[0]) && value.is_active);
        return { rows: row ? [project(row, ['user_id', 'username', 'display_name', 'role'])] : [] };
      }
      if (operation === 'login') {
        const row = rows.find(value => value.username === params[0]);
        return { rows: row ? [structuredClone(row)] : [] };
      }
      const row = rows.find(value => value.user_id === Number(params[0]));
      assert.ok(row, 'Login timestamp target must exist');
      row.last_login_at = 'synthetic-login-timestamp';
      return { rows: [], rowCount: 1 };
    },
    async connect() {
      assert.equal(connected, false, 'This fixture does not simulate concurrent transactions');
      connected = true;
      let working = null, locked = false, released = false;
      return {
        async query(sql, params = []) {
          assert.equal(released, false, 'Released client cannot execute SQL');
          const operation = identify(sql, params);
          if (operation === 'begin') {
            assert.equal(working, null, 'Nested transactions are unsupported');
            working = structuredClone(rows);
            return { rows: [] };
          }
          assert.ok(working, 'Transaction must begin before any client operation');
          if (operation === 'rollback') { working = null; locked = false; return { rows: [] }; }
          if (operation === 'lock') { locked = true; return { rows: [] }; }
          assert.equal(locked, true, 'Account writes and checks must follow the actual service lock');
          if (operation === 'commit') { rows = working; working = null; locked = false; return { rows: [] }; }
          if (operation === 'role') return { rows: ['admin', 'staff'].includes(params[0]) ? [{ '?column?': 1 }] : [] };
          if (operation === 'existing') {
            const row = working.find(value => value.username === params[0]);
            return { rows: row ? [project(row, ['user_id', 'role', 'is_active'])] : [] };
          }
          if (operation === 'otherAdmins') return { rows: [{ count: working.filter(row => row.role === 'admin' && row.is_active && row.user_id !== Number(params[0])).length }] };
          if (operation === 'upsert') {
            const [username, password_hash, display_name, role] = params;
            assert.match(password_hash, /^\$2[aby]\$/, 'Actual bcrypt must produce the stored hash');
            let row = working.find(value => value.username === username);
            if (!row) { row = { user_id: nextId++, username }; working.push(row); }
            Object.assign(row, { password_hash, display_name, role, is_active: true });
            return { rows: [project(row, ['user_id', 'username', 'display_name', 'role'])], rowCount: 1 };
          }
          if (operation === 'target') {
            const row = working.find(value => value.user_id === Number(params[0]));
            return { rows: row ? [project(row, ['role', 'is_active'])] : [] };
          }
          if (operation === 'setActive') {
            const row = working.find(value => value.user_id === Number(params[0]));
            if (!row) return { rows: [], rowCount: 0 };
            assert.equal(typeof params[1], 'boolean');
            row.is_active = params[1];
            return { rows: [publicAccount(row)], rowCount: 1 };
          }
          throw new Error('SQL_NOT_ALLOWED_ON_TRANSACTION_CLIENT');
        },
        release(error) {
          assert.equal(error, undefined, 'Rollback must not fail');
          assert.equal(working, null, 'Transaction must end before release');
          assert.equal(released, false, 'Client may be released only once');
          released = true;
          connected = false;
        }
      };
    }
  };
  fixture.pool = new Proxy(pool, {
    get(target, key) {
      if (!Object.hasOwn(target, key)) throw new Error('UNKNOWN_POOL_OPERATION');
      return target[key];
    }
  });
  return fixture;
}

function createSession(user, label) {
  const events = [];
  const value = { user: structuredClone(user), regenerate(callback) {
    assert.equal(typeof callback, 'function');
    events.push('regenerate');
    delete value.user;
    callback();
  } };
  const session = new Proxy(value, {
    get(target, key) {
      if (!['user', 'regenerate'].includes(key)) throw new Error('UNKNOWN_SESSION_OPERATION');
      return target[key];
    },
    set(target, key, next) {
      if (key !== 'user') throw new Error('UNKNOWN_SESSION_WRITE');
      events.push('refresh-user');
      target.user = next;
      return true;
    }
  });
  return { label, session, events };
}

async function requestThroughMiddleware(auth, stored, { admin = false } = {}) {
  const request = { path: '/api/users', session: stored?.session };
  const observed = { session: stored?.label ?? 'no-session', status: null, accepted: false, calls: [] };
  let terminal = false;
  const response = {
    status(status) { assert.equal(terminal, false); observed.status = status; return this; },
    json(body) { assert.equal(terminal, false); terminal = true; observed.response = body; }
  };
  // Execute every production handler: neither the SQL mock nor the session mock
  // decides authorization. A handler must call next to reach the following one.
  for (const [name, handler] of [
    ['refreshAccountSession', auth.refreshAccountSession],
    ['requireAuth', auth.requireAuth],
    ...(admin ? [['requireAdmin', auth.requireAdmin]] : [])
  ]) {
    observed.calls.push(name);
    let nextCalls = 0;
    await handler(request, response, error => {
      if (error) throw error;
      assert.equal(terminal, false, 'A response cannot also advance the pipeline');
      nextCalls++;
    });
    if (terminal) break;
    assert.equal(nextCalls, 1, 'Middleware must either respond or call next exactly once');
  }
  if (!terminal) { observed.status = 200; observed.accepted = true; }
  observed.resultingRole = request.session?.user?.role ?? null;
  observed.sessionEvents = stored ? [...stored.events] : [];
  return observed;
}

async function runWorker() {
  const net = await import('node:net');
  const tls = await import('node:tls');
  const dgram = await import('node:dgram');
  const restorations = [];
  let networkAttempts = 0, dbRedirects = 0, forbiddenImports = 0;
  const blockNetwork = () => { networkAttempts++; throw new Error('NETWORK_FORBIDDEN'); };
  function replace(target, name, value) {
    const original = target[name];
    target[name] = value;
    restorations.push(() => { target[name] = original; });
  }
  replace(net.default.Socket.prototype, 'connect', blockNetwork);
  replace(net.default.Server.prototype, 'listen', blockNetwork);
  replace(tls.default, 'connect', blockNetwork);
  replace(dgram.default, 'createSocket', blockNetwork);
  replace(globalThis, 'fetch', blockNetwork);
  const fixture = createSqlFixture();
  const poolKey = Symbol.for('kumondb.auth-session-review.pool');
  globalThis[poolKey] = fixture.pool;
  const dbUrl = new URL('../../config/db.js', import.meta.url).href;
  const stubUrl = 'data:text/javascript,' + encodeURIComponent('export default globalThis[Symbol.for("kumondb.auth-session-review.pool")];');
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (specifier === 'dotenv' || specifier.includes('.env')) {
      forbiddenImports++;
      throw new Error('ENV_FILE_IMPORT_FORBIDDEN');
    }
    const result = nextResolve(specifier, context);
    if (result.url === dbUrl) { dbRedirects++; return { url: stubUrl, shortCircuit: true }; }
    return result;
  } });
  try {
    const service = await import('../../services/authService.js');
    const auth = await import('../../middleware/auth.js');
    const serviceCalls = [];
    async function call(name, input, purpose) {
      fixture.phase = purpose;
      const safeInput = name === 'setAccountActive' ? { userId: input[0], isActive: input[1] }
        : { username: input.username, ...(name === 'upsertAccount' ? { roleArgument: input.role ?? '(omitted: service default)' } : {}) };
      const record = { name, purpose, input: safeInput };
      serviceCalls.push(record);
      try {
        const result = name === 'setAccountActive' ? await service[name](...input) : await service[name](input);
        record.outcome = 'returned';
        return result;
      } catch (error) {
        record.outcome = 'rejected';
        record.statusCode = error.statusCode ?? null;
        throw error;
      }
    }
    const username = 'audit-admin-session';
    await call('upsertAccount', { username, password: 'synthetic-before-reset', role: 'admin', displayName: 'Synthetic Admin' }, 'create-admin');
    const sessions = [];
    for (const label of ['old-session-A', 'old-session-B']) {
      const user = await call('verifyAccountLogin', { username, password: 'synthetic-before-reset' }, `login-${label}`);
      sessions.push(createSession(user, label));
    }
    assert.notEqual(sessions[0].session, sessions[1].session);
    assert.notEqual(sessions[0].session.user, sessions[1].session.user);
    const before = fixture.snapshot(username), oldHash = fixture.storedHash(username);
    fixture.phase = 'sessions-before-reset';
    const beforeReset = [];
    for (const session of sessions) beforeReset.push(await requestThroughMiddleware(auth, session, { admin: true }));
    assert.ok(beforeReset.every(value => value.accepted));
    await call('upsertAccount', { username, password: 'synthetic-after-reset', role: 'admin', displayName: 'Synthetic Admin' }, 'reset-existing-admin');
    const after = fixture.snapshot(username);
    assert.equal(after.user_id, before.user_id, 'Reset must hit the existing username');
    assert.ok(oldHash !== fixture.storedHash(username), 'Actual reset must change the stored hash');
    await assert.rejects(call('verifyAccountLogin', { username, password: 'synthetic-before-reset' }, 'old-password-after-reset'), error => error.statusCode === 401);
    await call('verifyAccountLogin', { username, password: 'synthetic-after-reset' }, 'new-password-after-reset');
    fixture.phase = 'old-sessions-after-reset';
    const afterReset = [];
    for (const session of sessions) afterReset.push(await requestThroughMiddleware(auth, session, { admin: true }));
    assert.ok(afterReset.every(value => value.calls.includes('requireAuth')), 'Both old sessions must reach actual requireAuth');

    const existingUsernameCases = [];
    async function existingCase(label, initialRole, initiallyActive, roleArgument) {
      const name = `audit-${label}`;
      const created = await call('upsertAccount', { username: name, password: 'synthetic-initial', role: initialRole }, `${label}-create`);
      if (!initiallyActive) await call('setAccountActive', [created.user_id, false], `${label}-deactivate`);
      const prior = fixture.snapshot(name);
      await call('upsertAccount', { username: name, password: 'synthetic-reset', ...(roleArgument === undefined ? {} : { role: roleArgument }) }, `${label}-reset-existing`);
      const current = fixture.snapshot(name);
      assert.equal(current.user_id, prior.user_id);
      existingUsernameCases.push({ label, roleArgument: roleArgument ?? '(omitted: service default)', before: prior, after: current,
        roleChanged: prior.role !== current.role, activeChanged: prior.is_active !== current.is_active });
    }
    await existingCase('inactive-staff-default-role', 'staff', false, undefined);
    await existingCase('inactive-staff-explicit-role', 'staff', false, 'staff');
    await existingCase('active-admin-explicit-staff', 'admin', true, 'staff');
    assert.deepEqual(existingUsernameCases.map(row => [row.after.role, row.after.is_active]), [['admin', true], ['staff', true], ['staff', true]]);

    fixture.phase = 'control-no-session';
    const noSession = await requestThroughMiddleware(auth, null);
    assert.equal(noSession.status, 401);
    assert.ok(noSession.calls.includes('requireAuth'));
    fixture.unavailable = true;
    fixture.phase = 'control-database-unavailable';
    const unavailable = await requestThroughMiddleware(auth, sessions[0]);
    fixture.unavailable = false;
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.accepted, false);
    assert.deepEqual(unavailable.calls, ['refreshAccountSession']);
    await call('setAccountActive', [before.user_id, false], 'control-deactivate-admin');
    fixture.phase = 'control-old-sessions-after-deactivation';
    const deactivated = [];
    for (const session of sessions) deactivated.push(await requestThroughMiddleware(auth, session));
    assert.ok(deactivated.every(value => value.status === 401 && value.calls.includes('requireAuth')));
    assert.ok(sessions.every(value => value.events.includes('regenerate')));
    fixture.assertReleased();
    assert.equal(fixture.rejectedSql.length, 0, 'Production calls must use only explicitly supported SQL');
    fixture.phase = 'control-unknown-sql';
    await assert.rejects(fixture.pool.query('SELECT audit_unknown_statement', []), /UNKNOWN_SQL_REJECTED/);
    assert.equal(fixture.rejectedSql.length, 1);
    assert.equal(networkAttempts, 0);
    assert.equal(forbiddenImports, 0);
    assert.ok(dbRedirects > 0);
    return {
      schemaVersion: 1, generatedAt: new Date().toISOString(), status: 'completed',
      method: 'Actual authService and auth middleware, unchanged; exact SQL/stateful session doubles; real bcrypt; no HTTP server or database. A recorded 200 means the middleware called next through every gate, not an HTTP response.',
      safety: { workerEnvironment: 'empty (no inherited secrets)', productionDbModuleEvaluated: false,
        dbModuleRedirects: dbRedirects, forbiddenImports, networkAttempts, unexpectedProductionSql: 0, unknownSqlNegativeControlRejected: true },
      adminPasswordReset: { before, after, storedPasswordChanged: true, oldPasswordRejected: true, newPasswordAccepted: true,
        roleChanged: before.role !== after.role, activeChanged: before.is_active !== after.is_active,
        beforeReset, afterReset, oldSessionsAcceptedAfterReset: afterReset.filter(value => value.accepted).length,
        observedFinding: afterReset.every(value => value.accepted) ? 'Both pre-reset Admin sessions still pass refreshAccountSession, requireAuth and requireAdmin after the password changes.' : 'See per-session results; do not assume both old sessions remain accepted.' },
      existingUsernameCases,
      negativeControls: { noSession, databaseUnavailable: unavailable, afterDeactivation: deactivated },
      serviceCalls, sqlTrace: fixture.trace,
      limitations: [
        'SQL results and transaction effects are modeled in memory; no real PostgreSQL constraint, locking or session-store behavior is verified.',
        'Sessions originate from actual verifyAccountLogin results, but Express cookies, HTTP login/logout routes and persistence are not exercised.',
        'The omitted-role case proves the service default only; it does not prove which role a particular UI interaction submits.',
        'No browser, network, production data, Guest PIN, environment file, or real account is used.'
      ]
    };
  } finally {
    hooks.deregister();
    delete globalThis[poolKey];
    for (const restore of restorations.reverse()) restore();
  }
}

export async function runAuthSessionReview() {
  // Isolation also makes importing/running this audit safe for a parent harness:
  // no shared module cache, environment mutation, pool patches, or output files.
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, workerFlag], {
    cwd: projectRoot, env: {}, windowsHide: true, timeout: 45000, maxBuffer: 1024 * 1024
  });
  return JSON.parse(stdout);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === workerFlag) {
    try { process.stdout.write(JSON.stringify(await runWorker())); }
    catch (error) {
      // No partial observations are promoted to a confirmed finding.
      process.stdout.write(JSON.stringify({ status: 'inconclusive', findingConfirmed: false,
        limitation: 'The isolated service/middleware verification did not complete.',
        error: { name: error.name, message: error.message } }));
    }
  } else {
    let evidence;
    try { evidence = await runAuthSessionReview(); }
    catch { evidence = { status: 'inconclusive', findingConfirmed: false, limitation: 'The isolated worker could not complete or return valid evidence.' }; }
    await mkdir(dirname(evidencePath), { recursive: true });
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
    process.stdout.write(JSON.stringify({ status: evidence.status, evidencePath,
      oldSessionsAcceptedAfterReset: evidence.adminPasswordReset?.oldSessionsAcceptedAfterReset ?? null }) + '\n');
    if (evidence.status !== 'completed') process.exitCode = 1;
  }
}
