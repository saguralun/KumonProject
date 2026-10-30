import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pool from '../config/db.js';
import { preparePaymentDatabase, prepareApplicationDatabase } from '../services/databaseUpgradeService.js';

test('Legacy preparation entry points are inert even with unusable database credentials', async t => {
    t.mock.method(pool, 'query', () => assert.fail('Retired preparation queried the database'));
    t.mock.method(pool, 'connect', () => assert.fail('Retired preparation opened a database connection'));
    const forbidden = () => assert.fail('Retired preparation attempted work');
    for (const prepare of [preparePaymentDatabase, prepareApplicationDatabase]) {
        assert.deepEqual(await prepare({ database: { query: forbidden, connect: forbidden }, backup: forbidden, report: forbidden }),
            { ready: true, applied: false, retired: true });
    }
    const source = await fs.readFile('scripts/prepare-database.js', 'utf8');
    assert.doesNotMatch(source, /\bimport\s|\brequire\(/);
    const result = await promisify(execFile)(process.execPath, ['scripts/prepare-database.js', '--update'], {
        windowsHide: true, timeout: 10000,
        env: { ...process.env, DB_HOST: 'invalid.example', DB_PORT: '1', DB_USER: 'invalid', DB_PASSWORD: 'invalid', DB_NAME: 'invalid' }
    });
    assert.deepEqual(JSON.parse(result.stdout), { ready: true, applied: false, retired: true });
    assert.equal(result.stderr, '');
});

function fixture(failure) {
    const calls = [], recovery = { files: [{ path: 'logs/database-upgrade-latest.json' }], backupDirectory: 'fixture-backup' };
    const step = name => { calls.push(name); if (failure === name) throw Error(`fixture ${name} failed`); };
    return { calls, recovery, steps: {
        runGit: async args => {
            const name = args[0] === 'pull' ? 'pull' : args.includes('--abbrev-ref') ? 'branch' : 'head';
            step(name);
            if (name === 'pull') assert.deepEqual(args, ['pull', 'origin', 'main', '--ff-only']);
            return { stdout: name === 'branch' ? 'main\n' : name === 'head' ? 'b'.repeat(40) : 'Already up to date.' };
        },
        recoverFiles: async () => { step('recover'); return recovery; },
        install: async () => { step('install'); },
        restart: async () => { step('restart'); }
    }};
}

test('The complete update sequence preserves file recovery without any schema work', async t => {
    t.mock.method(pool, 'query', () => assert.fail('Code update must not query the database'));
    t.mock.method(pool, 'connect', () => assert.fail('Code update must not connect to the database'));
    const { performUpdate } = await import('../services/updateService.js?code-only-success');
    const f = fixture(), context = {};
    const result = await performUpdate(context, f.steps);
    assert.deepEqual(f.calls, ['branch', 'recover', 'pull', 'install', 'head', 'restart']);
    assert.equal(context.fileRecovery, f.recovery); assert.equal(result.fileRecovery, f.recovery);
    assert.equal(result.success, true); assert.equal(result.restartScheduled, true);
    assert.equal(result.newCommit, 'bbbbbbb'); assert.equal(result.database, undefined);
    for (const file of ['services/updateService.js', 'launcher/restart-server.ps1']) {
        assert.doesNotMatch(await fs.readFile(file, 'utf8'), /prepare-database|prepareApplicationDatabase|databaseUpgradeService|databaseSchema|database-upgrade-latest/);
    }
});

for (const failed of ['recover', 'pull', 'install', 'head', 'restart']) {
    test(`An update stops at ${failed} failure and preserves retry after a successful pull`, async t => {
        const { performUpdate, checkForUpdate } = await import(`../services/updateService.js?code-only-${failed}`);
        const f = fixture(failed);
        await assert.rejects(performUpdate({}, f.steps), new RegExp(`fixture ${failed} failed`));
        const order = ['branch', 'recover', 'pull', 'install', 'head', 'restart'];
        assert.deepEqual(f.calls, order.slice(0, order.indexOf(failed) + 1));
        const { stdout: head } = await promisify(execFile)('git', ['rev-parse', 'HEAD'], { windowsHide: true });
        t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ sha: head.trim(), commit: { message: 'Current fixture version' } }) }));
        const status = await checkForUpdate();
        const retry = ['install', 'head', 'restart'].includes(failed);
        assert.equal(status.checked, true); assert.equal(status.retryRequired, retry); assert.equal(status.upToDate, !retry);
    });
}
