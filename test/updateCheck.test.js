import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkForUpdate } from '../services/updateService.js';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

test('Version checks share a bounded cache and retry failures without installing or changing data', async t => {
  let now = 0, calls = 0, valid = true;
    t.mock.method(fs, 'readFile', async () => '{"ready":true}');
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/saguralun/KumonProject/commits/main');
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => valid ? { sha: 'a'.repeat(40), commit: { message: 'New fixture version\nDetails' } } : {} };
  });
  const statuses = await Promise.all(Array.from({ length: 8 }, () => checkForUpdate()));
  assert.equal(calls, 1); assert.ok(statuses.every(status => status.checked));
  assert.equal(statuses[0].remoteMessage, 'New fixture version');
  await checkForUpdate(); assert.equal(calls, 1);
  now = 60000; valid = false;
  const unavailable = await checkForUpdate(); assert.equal(calls, 2); assert.equal(unavailable.checked, false);
  now += 60000; valid = true;
  assert.equal((await checkForUpdate()).checked, true); assert.equal(calls, 3);
});

test('A failed database preparation keeps Update available even when the pulled commit is current', async t => {
    const { checkForUpdate: freshCheck } = await import('../services/updateService.js?retry-fixture');
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim();
    let ready = false;
    t.mock.method(fs, 'readFile', async () => JSON.stringify({ ready }));
    t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => ({ sha: head, commit: { message: 'Current version' } }) }));
    const blocked = await freshCheck();
    assert.equal(blocked.checked, true); assert.equal(blocked.upToDate, false); assert.equal(blocked.preparationRequired, true);
    ready = true;
    const prepared = await freshCheck(); assert.equal(prepared.upToDate, true); assert.equal(prepared.preparationRequired, false);
});
