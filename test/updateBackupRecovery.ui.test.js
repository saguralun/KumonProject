import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000 };
const backup = { filename: 'fixture_only_2026-11-24_120000.backup', sizeBytes: 100, createdAt: '2026-11-24T05:00:00Z' };
for (const embedded of [false, true]) {
    test(`Backup shows server/database targets and exposes the safety archive after failed Restore (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
        let lists = 0, imported = false;
        const f = await controlFixture('backup', async (req, res) => {
            if (req.path === '/backup/list') {
                lists++; res.json({ dbName: 'fixture_only', backupDir: 'fixture',
                    target: { serverName: 'CENTER-MAIN', databaseHost: 'DATABASE-SERVER', databasePort: 5544, dbName: 'fixture_only' },
                    backups: imported ? [backup] : [] }); return true;
            }
            if (req.path === '/backup/import') { imported = true; res.status(503).json({ success: false, error: 'Synthetic restore failure', preImportBackup: backup }); return true; }
            if (req.path === '/backup/download/' + backup.filename) { res.attachment(backup.filename).send('synthetic archive'); return true; }
            return false;
        }, { embedded });
        try {
            const { page } = f;
            await page.waitForFunction(() => document.getElementById('dbNameHint').textContent === 'fixture_only');
            assert.match(await page.locator('.backup-workspace').innerText(), /CENTER-MAIN/);
            assert.match(await page.locator('.backup-workspace').innerText(), /DATABASE-SERVER:5544/);
            assert.doesNotMatch(await page.locator('.import-warning').innerText(), /ในเครื่องนี้ทั้งหมด|แก้กลับไม่ได้/);
            await page.locator('#importFile').setInputFiles({ name: 'test.backup', mimeType: 'application/octet-stream', buffer: Buffer.from('synthetic only') });
            await page.locator('#importConfirmText').fill('fixture_only');
            await page.locator('#importSubmit').click();
            assert.match(await page.locator('#appDialogMessage').innerText(), /CENTER-MAIN/);
            assert.match(await page.locator('#appDialogMessage').innerText(), /DATABASE-SERVER:5544/);
            await f.choose(false); assert.equal(f.writes().length, 0);
            await page.locator('#importSubmit').click(); await f.choose(true);
            await page.waitForFunction(() => document.getElementById('importMessage').textContent.includes('Synthetic restore failure'));
            await page.locator('#preImportRecovery [data-download-filename]').waitFor();
            assert.ok(lists >= 2, 'Failure must refresh the backup list');
            assert.match(await page.locator('#preImportRecovery').innerText(), /เลือก.*ไฟล์|เลือกไฟล์/);
            assert.equal(await page.locator('#importSubmit').isEnabled(), true);
            const downloaded = page.waitForEvent('download');
            await page.locator('#preImportRecovery [data-download-filename]').click();
            const file = await downloaded; assert.equal(file.suggestedFilename(), backup.filename);
            await f.downloadsIdle(); await file.delete();
            assert.equal(f.writes().length, 1, 'Recovery download must not trigger another Restore');
            assert.deepEqual(f.errors, []);
        } finally { await f.close(); }
    });
}

for (const embedded of [false, true]) for (const pageName of ['login', 'opening-schedule']) test(`Restart failure from the active attempt stops waiting and allows retry on ${pageName} (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    let applied = false;
    const f = await controlFixture(pageName, async (req, res) => {
        if (req.path === '/system/update-check') { res.json({ checked: true, upToDate: false, remoteMessage: 'Synthetic version' }); return true; }
        if (req.path === '/system/runtime') { res.json({ instanceId: 'old-runtime', serverName: 'CENTER-MAIN',
            update: applied ? { attemptId: 'this-attempt', phase: 'failed', message: 'เปิดรุ่นใหม่ไม่สำเร็จที่ CENTER-MAIN กรุณาลองอัปเดตอีกครั้ง' } : null }); return true; }
        if (req.path === '/system/update-apply') { applied = true; res.json({ success: true, previousInstanceId: 'old-runtime', updateAttemptId: 'this-attempt' }); return true; }
        if (req.path === '/system/opening-schedules') { res.json({ weekdays: [], schedulesByWeekday: [], summary: {} }); return true; }
        return false;
    }, { embedded });
    try {
        const { page } = f, login = pageName === 'login';
        const button = page.locator(login ? '#loginUpdateButton' : '#authUpdateButton');
        if (!login) await page.locator('.app-menu-toggle').click();
        await button.waitFor({ state: 'visible' });
        await button.click();
        assert.match(await page.locator('#appDialogMessage').innerText(), /CENTER-MAIN/);
        await f.choose(true);
        await page.waitForFunction(isLogin => (document.getElementById(isLogin ? 'loginMessage' : 'appDialogMessage')?.textContent || '').includes('เปิดรุ่นใหม่ไม่สำเร็จ'), login, { timeout: 4000 });
        if (!login) await f.choose(true);
        assert.equal(await button.isEnabled(), true);
        assert.equal(f.writes().length, 1);
        await button.click(); await f.choose(false);
        assert.equal(f.writes().length, 1); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});
