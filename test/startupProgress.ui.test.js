import assert from 'node:assert/strict';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { startupStatusPath } from '../services/startupProgressService.js';
const execute = promisify(execFile);
const invoke = async (mode, image, directory) => {
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.resolve('test/support/startupProgressHarness.ps1'), '-Mode', mode, ...(image ? ['-ImagePath', image] : []), ...(directory ? ['-FixtureDirectory', directory] : [])], { windowsHide: true, timeout: 30000 });
    return JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
};

test('Launcher progress keeps timings, shares repeated double-clicks and cannot turn success into failure', { skip: process.platform !== 'win32', timeout: 35000 }, async () => {
    const result = await invoke('state');
    assert.equal(result.firstPath, startupStatusPath(process.cwd(), process.env.LOCALAPPDATA));
    assert.equal(result.starts.length, 1); assert.equal(result.starts[0].style, 'Hidden');
    assert.equal(result.secondShared, true); assert.equal(result.sameAttempt, true);
    assert.equal(result.initial.stage, 'checking'); assert.equal(result.pending.stage, 'starting');
    assert.equal(result.final.status, 'ready'); assert.equal(result.writes, 3);
    assert.deepEqual(result.final.history.map(row => row.stage), ['checking', 'starting', 'ready']);
});

test('Native startup dialog shows the actual stage, elapsed time and slow-start guidance; hiding it only dismisses feedback', {
    skip: process.platform !== 'win32' || process.env.TEST_BROWSER_UI !== '1', timeout: 35000
}, async () => {
    const image = path.join(os.tmpdir(), `kumon-startup-dialog-${process.pid}.png`);
    try {
        const result = await invoke('view', image);
        assert.match(result.stage, /โหลดส่วนประกอบโปรแกรม/); assert.match(result.elapsed, /4[2-9] วินาที/);
        assert.match(result.hint, /ไม่ต้องเปิดโปรแกรมซ้ำ/); assert.equal(result.hidden, true);
        assert.deepEqual(result.buttons.sort(), ['คัดลอกรายละเอียด', 'ซ่อนหน้าต่างนี้'].sort());
        assert.match(result.diagnostics, /KumonDB/);
        assert.ok((await fs.stat(image)).size > 1000);
    } finally { await fs.rm(image, { force: true }); }
});

test('A known module-loading failure is reported immediately instead of waiting for the startup deadline', { skip: process.platform !== 'win32', timeout: 35000 }, async () => {
    const result = await invoke('failure');
    assert.match(result.message, /server could not finish loading/);
});

test('The shortcut feedback process actually opens and closes on readiness using only a private fixture status file', {
    skip: process.platform !== 'win32' || process.env.TEST_BROWSER_UI !== '1', timeout: 35000
}, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumon-startup-viewer-'));
    try {
        const result = await invoke('actual-viewer', null, root);
        assert.equal(result.visible, true); assert.equal(result.closedWhenReady, true);
        assert.ok(result.path.startsWith(root + path.sep));
        const state = JSON.parse((await fs.readFile(result.path, 'utf8')).replace(/^\uFEFF/, ''));
        assert.equal(state.status, 'ready');
    } finally {
        assert.ok(root.startsWith(path.join(os.tmpdir(), 'kumon-startup-viewer-')));
        await fs.rm(root, { recursive: true, force: true });
    }
});
