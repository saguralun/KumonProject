import assert from 'node:assert/strict';
import { test } from 'node:test';
import { saveDesktopDownload, downloadFilename, installDesktopDownloads } from '../services/desktopDownloadService.js';
import { EventEmitter } from 'node:events';

test('Desktop downloads persist only to the selected destination and report success after the copy completes', async () => {
    const events = [];
    const result = await saveDesktopDownload({ origin: 'http://localhost:1234',
        download: { url: () => 'http://localhost:1234/api/backup/download/test.backup', suggestedFilename: () => 'test.backup',
            saveAs: async destination => { assert.equal(destination, 'chosen.backup'); events.push('copied'); }, cancel: async () => assert.fail('Must not cancel a saved download') },
        choosePath: async filename => { assert.equal(filename, 'test.backup'); return { canceled: false, filePath: 'chosen.backup' }; },
        notify: state => events.push(state.status)
    });
    assert.deepEqual(result, { status: 'saved', path: 'chosen.backup' });
    assert.deepEqual(events, ['choosing', 'saving', 'copied', 'saved']);
});

test('Desktop download cancellation, failed copies and foreign origins never report success or open an external save dialog', async () => {
    for (const mode of ['cancel', 'copy-error', 'foreign', 'foreign-blob']) {
        let copied = false, cancelled = false, chosen = false; const events = [];
        const result = await saveDesktopDownload({ origin: 'http://localhost:1234',
            download: { url: () => mode === 'foreign' ? 'https://foreign.invalid/file' : mode === 'foreign-blob' ? 'blob:https://foreign.invalid/id' : 'blob:http://localhost:1234/id', suggestedFilename: () => 'test.backup',
                saveAs: async () => { copied = true; throw Error('Fixture disk unavailable'); }, cancel: async () => { cancelled = true; } },
            choosePath: async () => { chosen = true; return mode === 'cancel' ? { canceled: true } : { canceled: false, filePath: 'test.backup' }; },
            notify: state => events.push(state.status)
        });
        assert.equal(result.status, mode === 'cancel' ? 'cancelled' : 'failed');
        assert.equal(cancelled, true); assert.equal(events.includes('saved'), false);
        assert.equal(chosen, !mode.startsWith('foreign')); assert.equal(copied, mode === 'copy-error');
    }
    assert.equal(downloadFilename('../folder\\bad:name.backup'), 'bad_name.backup');
});

test('Desktop save dialogs serialize concurrent exports and remain usable after a cancelled choice', async () => {
    const page = new EventEmitter(), events = []; let release;
    page.evaluate = async () => {};
    const manager = installDesktopDownloads({ page, origin: 'http://localhost:1234', choosePath: async filename => {
        events.push(filename);
        if (filename === 'first.csv') await new Promise(resolve => { release = resolve; });
        return { canceled: true };
    } });
    const item = name => ({ suggestedFilename: () => name, url: () => 'http://localhost:1234/export', cancel: async () => {} });
    page.emit('download', item('first.csv')); page.emit('download', item('second.csv'));
    await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(events, ['first.csv']);
    release(); await manager.waitForIdle(); assert.deepEqual(events, ['first.csv', 'second.csv']);
});
