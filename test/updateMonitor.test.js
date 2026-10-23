import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startUpdateMonitor } from '../public/js/updateMonitor.js';

test('Update monitoring retries, throttles focus, serializes requests and never applies updates', async t => {
  const document = new EventTarget(), window = new EventTarget(), callbacks = [], requests = [], statuses = [];
  document.hidden = false;
  for (const [key, value] of Object.entries({ document, window })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; });
  }
  let now = 0, busy = false, fail = false, release;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'setInterval', callback => { callbacks.push(callback); return 1; });
  t.mock.method(globalThis, 'clearInterval', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    if (release) await new Promise(resolve => { release = resolve; });
    if (fail) throw new Error('offline');
    return { ok: true, json: async () => ({ checked: true, upToDate: requests.length === 1 }) };
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const stop = startUpdateMonitor(status => statuses.push(status), { isBusy: () => busy });
  await settle(); assert.equal(requests.length, 1); assert.equal(statuses[0].upToDate, true);
  window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('app:menu-change'));
  await settle(); assert.equal(requests.length, 1);
  now = 300000; await callbacks[0](); assert.equal(statuses.at(-1).upToDate, false);
  fail = true; now += 60000; window.dispatchEvent(new Event('online'));
  await settle(); assert.equal(statuses.length, 2);
  fail = false; busy = true; now += 60000; await callbacks[0](); assert.equal(requests.length, 3);
  busy = false; document.hidden = true; await callbacks[0](); assert.equal(requests.length, 3);
  document.hidden = false; release = true; document.dispatchEvent(new Event('visibilitychange'));
  await settle(); window.dispatchEvent(new Event('focus')); await callbacks[0](); assert.equal(requests.length, 4);
  release(); await settle(); assert.equal(statuses.length, 3);
  now += 60000; stop(); await callbacks[0](); window.dispatchEvent(new Event('focus'));
  await settle(); assert.equal(requests.length, 4);
  assert.ok(requests.every(request => request.url === '/api/system/update-check' && request.options.cache === 'no-store'));
});
