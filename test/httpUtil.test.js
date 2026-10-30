import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const source = await fs.readFile('public/js/httpUtil.js', 'utf8');
function fixture(response = { ok: true, json: async () => ({ success: true }) }) {
    const calls = [], context = vm.createContext({ Headers, fetch: async (...args) => { calls.push(args); return response; } });
    vm.runInContext(source, context);
    return { request: context.requestJson, calls };
}

test('JSON requests retain the default content type when callers supply other headers', async () => {
    for (const headers of [{ 'X-Request-ID': 'fixture' }, new Headers({ 'X-Request-ID': 'fixture' }), [['X-Request-ID', 'fixture']]]) {
        const f = fixture(), options = { method: 'POST', body: '{"test":true}', headers };
        await f.request('/fixture', options);
        assert.equal(f.calls[0][1].headers.get('content-type'), 'application/json');
        assert.equal(f.calls[0][1].headers.get('x-request-id'), 'fixture');
        assert.equal(f.calls[0][1].body, options.body);
        assert.equal(new Headers(headers).has('content-type'), false);
    }
});

test('JSON requests preserve explicit content types, cancellation and server errors', async () => {
    const f = fixture(), controller = new AbortController();
    await f.request('/fixture', { headers: { 'content-type': 'application/custom+json' }, signal: controller.signal });
    assert.equal(f.calls[0][1].headers.get('content-type'), 'application/custom+json');
    assert.equal(f.calls[0][1].signal, controller.signal);
    await assert.rejects(fixture({ ok: false, json: async () => ({ error: 'Fixture failure' }) }).request('/fixture'), /Fixture failure/);
    await assert.rejects(fixture({ ok: false, json: async () => { throw Error('Invalid JSON'); } }).request('/fixture', {}, 'Fallback'), /Fallback/);
});
