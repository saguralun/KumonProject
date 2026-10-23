import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import { preparePaymentDatabase } from '../services/databaseUpgradeService.js';

function fixture({ ready = false, failDdl = false } = {}) {
    const queries = []; let released = false;
    const client = {
        async query(sql) {
            queries.push(sql);
            if (sql.includes('information_schema')) return { rows: ready ? [{}, {}] : [] };
            if (sql.includes('ALTER TABLE')) { if (failDdl) throw new Error('fixture lock failed'); ready = true; }
            return { rows: [] };
        },
        release() { released = true; }
    };
    return { database: { connect: async () => client, options: {} }, queries, released: () => released };
}

test('An already-ready receipt schema never takes a backup or runs DDL', async () => {
    const f = fixture({ ready: true });
    assert.equal((await preparePaymentDatabase({ database: f.database, backup: async () => assert.fail('No backup needed') })).applied, false);
    assert.equal(f.released(), true); assert.ok(f.queries.at(-1).includes('pg_advisory_unlock'));
    assert.ok(f.queries.every((sql) => !sql.includes('ALTER TABLE')));
});

test('Schema failure rolls back and unlocks; failure to back up never sends DDL', async () => {
    for (const failDdl of [false, true]) {
        const f = fixture({ failDdl }); let backups = 0;
        await assert.rejects(preparePaymentDatabase({ database: f.database, backup: async () => {
            backups++; if (!failDdl) throw new Error('fixture backup failed');
            return { filename: 'fixture.backup', sizeBytes: 10 };
        } }));
        assert.equal(backups, 1); assert.equal(f.released(), true);
        assert.equal(f.queries.some((sql) => sql === 'ROLLBACK'), failDdl);
        assert.equal(f.queries.some((sql) => sql.includes('ALTER TABLE')), failDdl);
        assert.ok(f.queries.at(-1).includes('pg_advisory_unlock'));
    }
});

test('The default safety backup refuses a database target different from this machines .env', async (t) => {
    const f = fixture();
    t.mock.method(fs, 'readFile', async (file) => {
        assert.equal(file, '.env');
        return Buffer.from('DB_HOST=fixture-host\nDB_NAME=fixture-db\nDB_USER=fixture-user\nDB_PASSWORD=fixture-only\nDB_PORT=5432');
    });
    await assert.rejects(preparePaymentDatabase({ database: f.database }), { statusCode: 409 });
    assert.equal(f.released(), true); assert.ok(f.queries.every((sql) => !sql.includes('ALTER TABLE')));
});
