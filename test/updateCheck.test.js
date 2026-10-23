import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkForUpdate } from '../services/updateService.js';

test('Version checks share a bounded cache and retry failures without installing or changing data', async t => {
  let now = 0, calls = 0, valid = true;
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
