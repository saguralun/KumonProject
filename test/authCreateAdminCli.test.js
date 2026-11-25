import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const cliUrl = new URL('../scripts/createAdmin.js', import.meta.url).href;
const dbUrl = new URL('../config/db.js', import.meta.url).href;

async function runCli(mode) {
    // Run the actual CLI, with its asynchronous main/catch/finally intact.
    // Redirect only the DB boundary and dotenv before either can be evaluated.
    const source = `
        import assert from 'node:assert/strict';
        import { registerHooks } from 'node:module';
        import { fileURLToPath } from 'node:url';
        const mode = ${JSON.stringify(mode)};
        const calls = [];
        let transaction = false, committed = false, rolledBack = false, deleted = false, released = false;
        const client = {
            async query(sql, params = []) {
                sql = sql.replace(/\\s+/g, ' ').trim();
                calls.push(sql);
                if (sql === 'BEGIN ISOLATION LEVEL READ COMMITTED') { transaction = true; return { rows: [] }; }
                assert.equal(transaction, true);
                if (sql === 'LOCK TABLE app_user IN SHARE ROW EXCLUSIVE MODE') return { rows: [] };
                if (sql === 'SELECT 1 FROM role_master WHERE role_code = $1') return { rows: [{}] };
                if (sql.startsWith('INSERT INTO app_user')) {
                    assert.equal(params[0], 'synthetic-cli-admin');
                    assert.match(params[1], /^\\$2[aby]\\$10\\$/);
                    return { rows: [{ user_id: 101, username: params[0], display_name: params[2], role: params[3] }] };
                }
                if (sql === "SELECT to_regclass('session') IS NOT NULL AS session_table_exists") {
                    if (mode === 'catalog-failure') throw Object.assign(Error('synthetic catalog permission denied'), { code: '42501' });
                    return { rows: [{ session_table_exists: mode !== 'missing-session-table' }] };
                }
                if (sql.startsWith('DELETE FROM "session"')) {
                    assert.notEqual(mode, 'missing-session-table', 'Fresh CLI setup must not issue DELETE against an absent table');
                    deleted = true;
                    throw Object.assign(Error('synthetic revocation permission denied'), { code: '42501' });
                }
                if (sql === 'COMMIT') { committed = true; transaction = false; return { rows: [] }; }
                if (sql === 'ROLLBACK') { rolledBack = true; transaction = false; return { rows: [] }; }
                assert.fail('Unexpected fixture SQL: ' + sql);
            },
            release() { released = true; }
        };
        globalThis.__createAdminFixturePool = {
            query() { assert.fail('CLI must use its transaction client'); },
            async connect() { return client; },
            end() {
                assert.equal(released, true);
                assert.equal(transaction, false);
                assert.equal(committed, mode === 'missing-session-table');
                assert.equal(rolledBack, mode !== 'missing-session-table');
                assert.equal(deleted, mode === 'revocation-failure');
                console.error('CLI_FIXTURE_RESULT ' + JSON.stringify({ mode, committed, rolledBack, deleted, released }));
            }
        };
        registerHooks({
            resolve(specifier, context, nextResolve) {
                if (specifier === 'dotenv/config') return { url: 'data:text/javascript,export{}', shortCircuit: true };
                // No networking or database driver is permitted in this worker.
                if (/^(?:node:)?(?:net|tls|http|https)$/.test(specifier) || specifier === 'pg') {
                    throw Error('Forbidden fixture import: ' + specifier);
                }
                return nextResolve(specifier, context);
            },
            load(url, context, nextLoad) {
                if (url === ${JSON.stringify(dbUrl)}) return {
                    format: 'module', source: 'export default globalThis.__createAdminFixturePool;', shortCircuit: true
                };
                return nextLoad(url, context);
            }
        });
        process.argv = [process.execPath, fileURLToPath(${JSON.stringify(cliUrl)}),
            'synthetic-cli-admin', 'synthetic-cli-password', 'Synthetic CLI Admin'];
        await import(${JSON.stringify(cliUrl)});
    `;
    try {
        const output = await run(process.execPath, ['--input-type=module', '--eval', source], {
            cwd: projectRoot, env: {}, windowsHide: true, timeout: 20000
        });
        return { ...output, exitCode: 0 };
    } catch (error) {
        if (typeof error.code !== 'number') throw error;
        return { stdout: error.stdout, stderr: error.stderr, exitCode: error.code };
    }
}

for (const mode of ['missing-session-table', 'catalog-failure', 'revocation-failure']) {
    test(`Actual createAdmin CLI: ${mode}`, async () => {
        const result = await runCli(mode);
        assert.equal(result.exitCode, mode === 'missing-session-table' ? 0 : 1);
        assert.match(result.stderr, /CLI_FIXTURE_RESULT /);
        if (mode === 'missing-session-table') {
            assert.match(result.stdout, /Account ready: synthetic-cli-admin \(Synthetic CLI Admin\).*role: admin/);
            assert.doesNotMatch(result.stderr, /Failed to create account/);
        } else {
            assert.match(result.stderr, /Failed to create account: synthetic .* permission denied/);
            assert.doesNotMatch(result.stdout, /Account ready/);
        }
    });
}
