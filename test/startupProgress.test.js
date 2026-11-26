import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStartupReporter, startupStatusPath } from '../services/startupProgressService.js';

test('Startup timing records real stages, finishes once, and cannot overwrite a newer launch', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kumon-startup-status-'));
    const file = startupStatusPath(process.cwd(), root), attempt = '12345678-1234-1234-1234-123456789012';
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const seed = { attemptId: attempt, status: 'loading', startedAt: '2026-11-26T00:00:00.000Z', stage: 'checking', history: [] };
    const write = state => fs.writeFileSync(file, JSON.stringify(state));
    const read = () => JSON.parse(fs.readFileSync(file, 'utf8'));
    const report = createStartupReporter({ env: { LOCALAPPDATA: root, KUMON_STARTUP_STATUS: file, KUMON_STARTUP_ATTEMPT: attempt }, now: () => Date.parse(seed.startedAt) + 1350 });
    try {
        write(seed);
        for (const stage of ['modules', 'server', 'desktop', 'login', 'ready']) report(stage);
        assert.equal(read().status, 'ready');
        assert.deepEqual(read().history.map(row => row.stage), ['modules', 'server', 'desktop', 'login', 'ready']);
        assert.equal(read().elapsedMs, 1350);
        report('desktop'); assert.equal(read().stage, 'ready');
        write({ ...seed, attemptId: 'another-launch' });
        report('ready'); assert.equal(read().attemptId, 'another-launch'); assert.equal(read().status, 'loading');
        write(seed); report('unknown'); assert.deepEqual(read(), seed);
        report('error'); report('ready'); assert.equal(read().status, 'error');
    } finally {
        assert.ok(root.startsWith(path.join(os.tmpdir(), 'kumon-startup-status-')));
        fs.rmSync(root, { recursive: true, force: true });
    }
});

test('Optional startup feedback rejects arbitrary output paths and tolerates unusable storage', () => {
    let reads = 0, writes = 0;
    const storage = { readFileSync() { reads++; throw Error('fixture storage unavailable'); }, writeFileSync() { writes++; } };
    createStartupReporter({ env: { LOCALAPPDATA: os.tmpdir(), KUMON_STARTUP_STATUS: path.resolve('server.js'), KUMON_STARTUP_ATTEMPT: '12345678-1234-1234-1234-123456789012' }, storage })('modules');
    assert.equal(reads, 0); assert.equal(writes, 0);
    const env = { LOCALAPPDATA: os.tmpdir(), KUMON_STARTUP_STATUS: startupStatusPath(process.cwd(), os.tmpdir()), KUMON_STARTUP_ATTEMPT: '12345678-1234-1234-1234-123456789012' };
    assert.doesNotThrow(() => createStartupReporter({ env, storage })('modules'));
    assert.equal(reads, 1); assert.equal(writes, 0);
});
