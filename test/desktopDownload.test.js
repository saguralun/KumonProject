import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveDesktopDownload, downloadFilename, installDesktopDownloads } from '../services/desktopDownloadService.js';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function fixture(t) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumondb-direct-download-'));
    const source = path.join(root, 'temporary-source'), directory = path.join(root, 'Downloads');
    const bytes = Buffer.from([80, 71, 68, 77, 80, 0, 255, 13, 10]); await fs.writeFile(source, bytes);
    t.after(async () => {
        assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}kumondb-direct-download-`));
        await fs.rm(root, { recursive: true, force: true });
    });
    const download = { url: () => 'blob:http://localhost:1234/fixture', suggestedFilename: () => 'test.backup', path: async () => source, cancel: async () => {} };
    return { root, source, directory, bytes, download, options: { download, directory, origin: 'http://localhost:1234' } };
}

test('Desktop downloads save exact bytes to Downloads without any native dialog and survive temporary-file deletion', async t => {
    const f = await fixture(t), states = [];
    const result = await saveDesktopDownload({ ...f.options, notify: state => states.push(state.status) });
    assert.equal(result.status, 'saved'); assert.deepEqual(states, ['saving', 'saved']);
    await fs.unlink(f.source); assert.deepEqual(await fs.readFile(result.path), f.bytes);
    assert.equal(downloadFilename('../folder\\bad:name.backup'), 'bad_name.backup');
});

test('Concurrent duplicate filenames create new names and never overwrite an existing backup', async t => {
    const f = await fixture(t); await fs.mkdir(f.directory); await fs.writeFile(path.join(f.directory, 'test.backup'), 'ORIGINAL');
    const results = await Promise.all([saveDesktopDownload(f.options), saveDesktopDownload(f.options)]);
    assert.ok(results.every(result => result.status === 'saved'));
    assert.deepEqual(new Set(results.map(result => path.basename(result.path))), new Set(['test (1).backup', 'test (2).backup']));
    for (const result of results) assert.deepEqual(await fs.readFile(result.path), f.bytes);
    assert.equal(await fs.readFile(path.join(f.directory, 'test.backup'), 'utf8'), 'ORIGINAL');
});

test('Failed downloads, unavailable directories and foreign origins do not report success or write a saved backup', async t => {
    for (const mode of ['transfer-error', 'disk-error', 'foreign', 'foreign-blob']) {
        const f = await fixture(t), states = []; let read = false;
        if (mode === 'disk-error') await fs.writeFile(f.directory, 'Existing file must remain intact');
        const result = await saveDesktopDownload({ ...f.options, notify: state => states.push(state.status), download: { ...f.download,
            url: () => mode === 'foreign' ? 'https://foreign.invalid/file' : mode === 'foreign-blob' ? 'blob:https://foreign.invalid/id' : f.download.url(),
            path: async () => { read = true; throw Error('Fixture transfer failed'); }
        } });
        assert.equal(result.status, 'failed'); assert.equal(states.includes('saved'), false);
        assert.equal(read, mode === 'transfer-error');
        if (mode === 'disk-error') assert.equal(await fs.readFile(f.directory, 'utf8'), 'Existing file must remain intact');
    }
});

test('The download queue remains usable after a failed transfer', async t => {
    const f = await fixture(t), page = new EventEmitter(), states = [];
    page.evaluate = async (_callback, state) => states.push(state.status);
    const manager = installDesktopDownloads({ page, directory: f.directory, origin: f.options.origin });
    page.emit('download', { ...f.download, path: async () => { throw Error('Fixture transfer interrupted'); } });
    page.emit('download', f.download); await manager.waitForIdle();
    assert.deepEqual(states, ['saving', 'failed', 'saving', 'saved']);
    assert.deepEqual(await fs.readFile(path.join(f.directory, 'test.backup')), f.bytes);
});
