import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import express from 'express';
import pool from '../config/db.js';
import { requireAdmin } from '../middleware/auth.js';

test('Restore HTTP returns the exact pre-import archive after failure and retains Admin/confirmation guards', async t => {
    t.mock.method(pool, 'query', () => assert.fail('No production queries'));
    t.mock.method(pool, 'connect', () => assert.fail('No production connections'));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumondb-restore-http-'));
    const values = { BACKUP_DIR: root, DB_NAME: 'fixture_only', DB_HOST: 'fixture.invalid', DB_PORT: '1', DB_USER: 'fixture-user', DB_PASSWORD: 'fixture-password', PG_RESTORE_PATH: process.execPath };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    t.after(async () => {
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
        const relative = path.relative(os.tmpdir(), root);
        assert.ok(relative.startsWith('kumondb-restore-http-') && !path.isAbsolute(relative));
        await fs.rm(root, { recursive: true, force: true });
    });
    const filename = 'fixture_only_2026-11-24_120000.backup';
    const cp = createRequire(import.meta.url)('node:child_process');
    let dumps = 0, restores = 0, upload;
    // Intercept the actual subprocess boundary before importing the router.
    // Neither PowerShell nor pg_restore is ever launched.
    const originalExecFile = cp.execFile;
    // mock.method proxies retain execFile's custom promisifier, which closes
    // over the original native function. Use a fresh function instead, assert
    // it has no native custom hook, and poison every other process entry point.
    cp.execFile = (executable, args, _options, callback) => {
        void (async () => {
            if (executable === 'powershell.exe') {
                dumps++; await fs.writeFile(path.join(root, filename), 'synthetic pre-import archive');
                callback(null, '', '');
            } else {
                assert.equal(executable, process.execPath);
                assert.deepEqual(args.slice(0, 8), ['-h', 'fixture.invalid', '-p', '1', '-U', process.env.DB_USER, '-d', 'fixture_only']);
                restores++; upload = args.at(-1);
                callback(Object.assign(Error('Synthetic pg_restore failure'), { stderr: 'Synthetic pg_restore failure' }), '', 'Synthetic pg_restore failure');
            }
        })().catch(error => callback(error));
        return { stdout: null, stderr: null };
    };
    assert.equal(cp.execFile[promisify.custom], undefined);
    for (const method of ['spawn', 'spawnSync', 'execFileSync', 'exec', 'execSync']) {
        t.mock.method(cp, method, () => assert.fail('Unexpected subprocess entry: ' + method));
    }
    syncBuiltinESMExports();
    t.after(() => { cp.execFile = originalExecFile; t.mock.restoreAll(); syncBuiltinESMExports(); });
    t.mock.method(console, 'error', () => {});
    const { default: router } = await import('../routes/backupRoutes.js');
    const app = express();
    app.use((req, _res, next) => { req.session = req.headers['x-fixture-role'] ? { user: { role: req.headers['x-fixture-role'] } } : {}; next(); });
    app.use('/backup', requireAdmin, router);
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
    const request = (role, name = 'fixture_only') => fetch(`http://127.0.0.1:${server.address().port}/backup/import?confirmDbName=${name}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(role ? { 'x-fixture-role': role } : {}) }, body: Buffer.from('synthetic upload')
    });
    assert.equal((await request()).status, 401);
    assert.equal((await request('staff')).status, 403);
    assert.equal((await request('admin', 'wrong')).status, 400);
    assert.equal(dumps, 0); assert.equal(restores, 0);
    const response = await request('admin'); assert.equal(response.status, 500);
    const result = await response.json();
    assert.match(result.error, /Synthetic pg_restore failure/);
    assert.equal(result.preImportBackup.filename, filename);
    assert.equal(result.preImportBackup.sizeBytes, Buffer.byteLength('synthetic pre-import archive'));
    assert.equal(dumps, 1); assert.equal(restores, 1);
    assert.equal(await fs.readFile(path.join(root, filename), 'utf8'), 'synthetic pre-import archive');
    await assert.rejects(fs.stat(upload), { code: 'ENOENT' });
});
