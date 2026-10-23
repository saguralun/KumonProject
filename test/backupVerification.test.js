import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { verifyBackupSnapshot } from '../services/backupService.js';

test('Only a fresh nonempty readable backup archive is accepted before schema changes', async t => {
    const previous = { DB_NAME: process.env.DB_NAME, PG_RESTORE_PATH: process.env.PG_RESTORE_PATH };
    process.env.DB_NAME = 'backup_fixture'; process.env.PG_RESTORE_PATH = 'fixture-pg-restore';
    t.after(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    const filename = 'backup_fixture_2026-10-23_120000.backup', calls = [];
    let mtimeMs = 10000, size = 100;
    t.mock.method(fs, 'existsSync', () => true);
    t.mock.method(fsp, 'mkdir', async () => {});
    t.mock.method(fsp, 'readdir', async () => [filename]);
    t.mock.method(fsp, 'stat', async () => ({ mtimeMs, size, mtime: new Date(mtimeMs) }));
    const run = async (...args) => calls.push(args);
    await verifyBackupSnapshot({ filename }, 10000, run); assert.equal(calls.length, 1); assert.equal(calls[0][1][0], '--list');
    mtimeMs = 1; await assert.rejects(verifyBackupSnapshot({ filename }, 10000, run)); assert.equal(calls.length, 1);
    mtimeMs = 10000; size = 0; await assert.rejects(verifyBackupSnapshot({ filename }, 10000, run)); assert.equal(calls.length, 1);
    size = 100; await assert.rejects(verifyBackupSnapshot({ filename }, 10000, async () => { throw Error('fixture corrupt archive'); }), /corrupt archive/);
});
