import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createPrinterQueue } from '../services/printerQueue.js';

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

test('Printer jobs send in order and complete independently without interleaving', async () => {
    const first = deferred(), sent = [];
    const enqueue = createPrinterQueue(async payload => { sent.push(payload); if (payload === 'first') await first.promise; return payload; });
    const a = enqueue('first'), b = enqueue('second'), c = enqueue('third');
    await nextTurn(); assert.deepEqual(sent, ['first']);
    first.resolve();
    assert.deepEqual(await Promise.all([a, b, c]), ['first', 'second', 'third']);
    assert.deepEqual(sent, ['first', 'second', 'third']);
});

test('Failed printing reports its own error, never retries, and releases the next job', async () => {
    const first = deferred(), sent = [];
    const enqueue = createPrinterQueue(async payload => { sent.push(payload); if (payload === 'first') await first.promise; return payload; });
    const a = enqueue('first'), failure = assert.rejects(a, /Fixture print failed/), b = enqueue('second');
    await nextTurn(); assert.deepEqual(sent, ['first']);
    first.reject(Error('Fixture print failed')); await failure;
    assert.equal(await b, 'second'); assert.deepEqual(sent, ['first', 'second']);
});

test('A synchronous transport error also preserves the printer queue', async () => {
    const enqueue = createPrinterQueue(payload => { if (payload === 'bad') throw Error('Invalid fixture'); return payload; });
    await assert.rejects(enqueue('bad'), /Invalid fixture/);
    assert.equal(await enqueue('next'), 'next');
});
