import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) {
    test(`Backup download keeps the page open, reports permission/file errors, and saves exact bytes (${embedded ? 'desktop' : 'browser'})`, {
        skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000
    }, async t => {
        const filename = 'fixture_only_2026-10-30_154550.backup', bytes = Buffer.from([80, 71, 68, 77, 80, 0, 255, 123, 10]);
        let failure = 404;
        const f = await controlFixture('backup', async (req, res) => {
            if (req.path === '/backup/list') { res.json({ success: true, dbName: 'fixture_only', backupDir: 'fixture', backups: [{ filename, sizeBytes: bytes.length, createdAt: '2026-10-30' }] }); return true; }
            if (req.path === `/backup/download/${filename}`) {
                if (failure) res.status(failure).json({ success: false, error: 'Fixture unavailable' });
                else res.attachment(filename).type('application/octet-stream').send(bytes);
                return true;
            }
        }, { embedded });
        const saved = path.join(f.downloadDirectory, filename);
        const originalCopy = fs.copyFile.bind(fs); let failCopy = false;
        t.mock.method(fs, 'copyFile', async (...args) => {
            if (failCopy && String(args[1]).startsWith(f.downloadDirectory + path.sep)) throw Error('Fixture disk unavailable');
            return originalCopy(...args);
        });
        if (embedded) await f.desktop.application.evaluate(({ dialog }) => {
            dialog.showSaveDialog = async () => { throw Error('A native save dialog must never be opened'); };
        });
        try {
            const { page } = f, link = page.locator('[data-download-filename]');
            await link.waitFor(); await link.click();
            await page.waitForFunction(() => document.getElementById('exportMessage').textContent.includes('ไม่พบไฟล์'));
            assert.equal(page.url(), `${f.origin}/backup.html`); assert.equal(await link.getAttribute('aria-disabled'), null);
            failure = 403; await link.click();
            await page.waitForFunction(() => document.getElementById('exportMessage').textContent.includes('สิทธิ์'));
            failure = 0;
            const waiting = page.waitForEvent('download'); await link.click(); const download = await waiting;
            assert.equal(download.suggestedFilename(), filename);
            assert.deepEqual(await fs.readFile(await download.path()), bytes);
            await f.downloadsIdle();
            if (embedded) {
                assert.deepEqual(await fs.readFile(saved), bytes);
                await page.waitForFunction(() => document.getElementById('exportMessage').textContent.includes('บันทึกไฟล์') && document.getElementById('exportMessage').textContent.includes('สำเร็จ'));
                failCopy = true;
                await link.click(); await page.waitForFunction(() => document.getElementById('exportMessage').textContent.includes('Fixture disk unavailable'));
                assert.equal(await link.getAttribute('aria-disabled'), null);
                failCopy = false;
                await link.click(); await page.waitForFunction(() => document.getElementById('exportMessage').textContent.includes('บันทึกไฟล์') && document.getElementById('exportMessage').textContent.includes('สำเร็จ'));
                await f.downloadsIdle();
                assert.deepEqual(await fs.readFile(path.join(f.downloadDirectory, filename.replace('.backup', ' (1).backup'))), bytes);
                assert.deepEqual(await fs.readFile(saved), bytes);
                await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-backup-download-fixture.png'), fullPage: true });
                // A saved copy must survive deletion of the controller's temp file
                // and complete shutdown of the fixture desktop/profile.
                await download.delete();
                await f.desktop.application.close();
                assert.deepEqual(await fs.readFile(saved), bytes);
            } else await download.delete();
            assert.equal(page.url(), `${f.origin}/backup.html`);
            assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
}
