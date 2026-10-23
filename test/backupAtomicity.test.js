import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restoreBackupFile } from '../services/backupService.js';

test('Restore rejects a failed command rather than swallowing or retrying it', async () => {
    let attempts = 0;
    await assert.rejects(restoreBackupFile({ executable: 'test-only', host: '127.0.0.1', user: 'test', dbName: 'test', tempFile: 'test.backup', env: {} }, async (_exe, args) => {
        attempts++; assert.equal(args.filter((arg) => arg === '--single-transaction').length, 1);
        assert.equal(args.filter((arg) => arg === '--exit-on-error').length, 1);
        assert.ok(!args.includes('--jobs')); throw new Error('failed COPY');
    }), /failed COPY/);
    assert.equal(attempts, 1);
});
