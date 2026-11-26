import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);

test('Heavy startup dependencies load only on use and preserve printable/exported output', { timeout: 60000 }, async () => {
    const { stdout } = await execute(process.execPath, ['test/support/startupDependenciesHarness.mjs'], { windowsHide: true, timeout: 55000 });
    const result = JSON.parse(stdout.trim());
    assert.equal(result.lazyImports, true); assert.equal(result.failedCanvasLoadRetry, true);
    assert.equal(result.asciiAndThaiReceipts, true); assert.equal(result.concurrentExports, true);
    assert.equal(result.actualPrintOrDatabaseCalls, false);
});
