import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listBackups, importBackup } from '../services/backupService.js';

function environment(t, values) {
    const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
    Object.assign(process.env, values);
    t.after(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
}

test('Backup metadata identifies the program server and database host without credentials', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumondb-backup-target-'));
    t.after(async () => {
        const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
        assert.ok(relative.startsWith('kumondb-backup-target-') && !path.isAbsolute(relative));
        await fs.rm(root, { recursive: true, force: true });
    });
    environment(t, { BACKUP_DIR: root, DB_NAME: 'fixture_only', DB_HOST: 'db-fixture.invalid', DB_PORT: '5544', DB_USER: 'never-expose-user', DB_PASSWORD: 'never-expose-password' });
    const metadata = await listBackups();
    assert.deepEqual(metadata.target, { serverName: os.hostname(), databaseHost: 'db-fixture.invalid', databasePort: 5544, dbName: 'fixture_only' });
    assert.doesNotMatch(JSON.stringify(metadata), /never-expose/);
    assert.deepEqual(metadata.backups, []);
});

for (const fails of [false, true]) test(`Restore retains its verified pre-import archive and cleans temporary upload (restore failure: ${fails})`, async t => {
    environment(t, { DB_NAME: 'fixture_only', DB_HOST: 'fixture.invalid', DB_PORT: '1', DB_USER: 'fixture-user', DB_PASSWORD: 'fixture-password', PG_RESTORE_PATH: process.execPath });
    const archive = { filename: 'fixture_only_2026-11-24_120000.backup', sizeBytes: 100 };
    let backupCreated = false, upload;
    const steps = {
        backup: async () => { backupCreated = true; return archive; },
        restore: async options => {
            assert.equal(backupCreated, true);
            assert.equal(options.host, 'fixture.invalid'); assert.equal(options.dbName, 'fixture_only');
            upload = options.tempFile;
            assert.equal(path.dirname(upload), os.tmpdir());
            assert.match(path.basename(upload), /^kumondb-import-/);
            assert.equal(await fs.readFile(upload, 'utf8'), 'synthetic archive bytes');
            if (fails) throw Error('Synthetic restore failure');
        }
    };
    const operation = importBackup(Buffer.from('synthetic archive bytes'), { confirmDbName: 'fixture_only' }, steps);
    if (fails) await assert.rejects(operation, error => error.statusCode === 500 && error.preImportBackup === archive && /Synthetic restore failure/.test(error.message));
    else assert.deepEqual(await operation, { preImportBackup: archive });
    await assert.rejects(fs.stat(upload), { code: 'ENOENT' });
});

test('Invalid Restore confirmation and failed backup never invoke restore or claim a recovery archive', async t => {
    environment(t, { DB_NAME: 'fixture_only' });
    let backups = 0;
    const steps = { backup: async () => { backups++; throw Error('Synthetic backup failure'); }, restore: () => assert.fail('Must not restore') };
    await assert.rejects(importBackup(Buffer.from('synthetic'), { confirmDbName: 'wrong' }, steps), { statusCode: 400 });
    assert.equal(backups, 0);
    await assert.rejects(importBackup(Buffer.from('synthetic'), { confirmDbName: 'fixture_only' }, steps), error => error.statusCode === 500 && !error.preImportBackup);
    assert.equal(backups, 1);
});
