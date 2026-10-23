import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import pg from 'pg';
import productionPool from '../config/db.js';
import { receiveReceiptPayment, cancelReceiptPayment } from '../services/paymentService.js';
import { saveWorksheetEntries } from '../services/worksheetService.js';
import { processPendingDates } from '../services/stockCutService.js';
import { restoreBackupFile } from '../services/backupService.js';
import { applyEnrollmentStatusAction } from '../services/studentService.js';

const run = promisify(execFile);
const enabled = process.platform === 'win32' && process.env.TEST_ISOLATED_PG === '1';

test('Transactions, migrations, concurrent payments/stock/WS and failed restore on a disposable PostgreSQL cluster', {
    skip: !enabled, timeout: 120000
}, async (t) => {
    // Never derive any connection or path below from DB_* or the production pool.
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumondb-isolated-pg-'));
    const data = path.join(root, 'data');
    const bin = process.env.TEST_PG_BIN || 'C:/Program Files/PostgreSQL/18/bin';
    const pgctl = path.join(bin, 'pg_ctl.exe');
    const probe = net.createServer();
    await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
    assert.ok(port !== 5432 && port !== 3000);
    const username = 'kumondb_isolated_test';
    const environment = { ...process.env, PGHOST: '127.0.0.1', PGPORT: String(port), PGUSER: username, PGDATABASE: 'postgres', PGPASSWORD: '' };
    let started = false, database;
    try {
        await run(path.join(bin, 'initdb.exe'), ['-D', data, '-U', username, '--auth=trust', '--encoding=UTF8', '--locale=C'], { env: environment, windowsHide: true, timeout: 30000 });
        await run(pgctl, ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -F -c max_connections=30`, '-w', 'start'], { env: environment, windowsHide: true, timeout: 30000 });
        started = true;
        database = new pg.Pool({ host: '127.0.0.1', port, user: username, password: '', database: 'postgres', max: 10,
            connectionTimeoutMillis: 4000, options: '-c search_path=kumon,public -c statement_timeout=15000' });
        const identity = (await database.query(`SELECT current_user AS owner, inet_server_port() AS port, current_setting('data_directory') AS directory`)).rows[0];
        assert.equal(identity.owner, username); assert.equal(identity.port, port); assert.equal(path.resolve(identity.directory), path.resolve(data));
        // Intercept EVERY service query before calling any application service.
        t.mock.method(productionPool, 'query', (...args) => database.query(...args));
        t.mock.method(productionPool, 'connect', (...args) => database.connect(...args));
        await database.query('CREATE SCHEMA kumon');
        for (const name of ['001_create_master_tables.sql', '002_insert_master_data.sql', '003_create_transaction_tables.sql']) {
            await database.query(await fs.readFile(path.join('database', name), 'utf8'));
        }
        const migration = await fs.readFile('database/004_payment_status_provenance.sql', 'utf8');
        await t.test('Payment migration upgrades a legacy schema and is safe to apply twice', async () => {
            await database.query('ALTER TABLE kumon.billing_detail DROP COLUMN inserted_status_history_id, DROP COLUMN payment_status_updated_at');
            await database.query(migration); await database.query(migration);
            const columns = await database.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='kumon' AND table_name='billing_detail' AND column_name IN ('inserted_status_history_id','payment_status_updated_at')`);
            assert.equal(columns.rows.length, 2);
        });
        const statuses = new Map((await database.query('SELECT status_code,status_id FROM kumon.status_master')).rows.map((row) => [row.status_code, row.status_id]));
        const ws = (await database.query(`SELECT wm.worksheet_master_id,wm.worksheet_no,wm.level_master_id FROM kumon.worksheet_master wm JOIN kumon.level_master lm ON lm.level_master_id=wm.level_master_id WHERE lm.subject_id=1 AND lm.level_type=1 ORDER BY wm.worksheet_master_id LIMIT 1`)).rows[0];
        async function student(name) {
            const person = (await database.query(`INSERT INTO kumon.student(prefix_id,first_name,last_name,birth_date) VALUES((SELECT MIN(prefix_id) FROM kumon.prefix_master),$1,'Test','2019-01-01') RETURNING student_id`, [name])).rows[0];
            return (await database.query(`INSERT INTO kumon.enrollment(student_id,subject_id,current_level_master_id,starting_worksheet_master_id,en_start_date,current_status_group1_id) VALUES($1,1,$2,$3,'2026-10-01',$4) RETURNING enrollment_id`, [person.student_id, ws.level_master_id, ws.worksheet_master_id, statuses.get('N')])).rows[0].enrollment_id;
        }
        const payment = (enrollmentId) => receiveReceiptPayment({ enrollmentId, billingDate: '2026-10-23', billingMonth: 10, billingYear: 2026 });
        await t.test('Concurrent receipts get unique numbers, even for the first receipts of a month', async () => {
            const ids = await Promise.all(['One', 'Two', 'Three', 'Four'].map(student));
            const results = await Promise.all(ids.map(payment));
            assert.equal(new Set(results.map((result) => `${result.receipt.receiptBook}:${result.receipt.receiptNo}`)).size, 4);
        });
        await t.test('Two simultaneous payments for one student commit only one receipt', async () => {
            const id = await student('Duplicate');
            const results = await Promise.allSettled([payment(id), payment(id)]);
            assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
            assert.equal(results.find((item) => item.status === 'rejected').reason.statusCode, 409);
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.billing_detail WHERE enrollment_id=$1', [id])).rows[0].n, 1);
        });
        await t.test('Cancelling an unchanged new payment restores its status and deletes only the event it created', async () => {
            const id = await student('Unchanged'), receipt = await payment(id);
            const metadata = (await database.query('SELECT * FROM kumon.billing_detail WHERE billing_id=$1', [receipt.billingId])).rows[0];
            assert.ok(metadata.inserted_status_history_id); assert.ok(metadata.payment_status_updated_at);
            await database.query(`INSERT INTO kumon.enrollment_status(enrollment_id,status_id,status_month,status_year) VALUES($1,$2,10,2026)`, [id, statuses.get('A')]);
            const result = await cancelReceiptPayment({ billingId: receipt.billingId });
            assert.equal(result.restoredEnrollments, 1); assert.equal(result.deletedStatusHistory, 1);
            assert.equal((await database.query('SELECT current_status_group1_id AS status FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].status, statuses.get('N'));
            assert.deepEqual((await database.query('SELECT status_id FROM kumon.enrollment_status WHERE enrollment_id=$1', [id])).rows.map((row) => row.status_id), [statuses.get('A')]);
        });
        await t.test('Cancelling an older receipt cannot overwrite a later A status or delete unrelated history', async () => {
            const id = await student('Changed'), receipt = await payment(id);
            await database.query(`UPDATE kumon.enrollment SET current_status_group1_id=$2,updated_at=clock_timestamp() WHERE enrollment_id=$1`, [id, statuses.get('A')]);
            const result = await cancelReceiptPayment({ billingId: receipt.billingId });
            assert.equal(result.restoredEnrollments, 0); assert.equal(result.preservedEnrollments, 1);
            assert.equal((await database.query('SELECT current_status_group1_id AS status FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].status, statuses.get('A'));
        });
        await t.test('Legacy receipts without provenance preserve current status and pre-existing history', async () => {
            const id = await student('Legacy'), receipt = await payment(id);
            await database.query('UPDATE kumon.billing_detail SET inserted_status_history_id=NULL,payment_status_updated_at=NULL WHERE billing_id=$1', [receipt.billingId]);
            const result = await cancelReceiptPayment({ billingId: receipt.billingId });
            assert.equal(result.restoredEnrollments, 0); assert.match(result.warning, /คงสถานะ/);
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.enrollment_status WHERE enrollment_id=$1', [id])).rows[0].n, 1);
        });
        await t.test('A pre-existing N event is never claimed or deleted by a new receipt', async () => {
            const id = await student('Manual event');
            await database.query('INSERT INTO kumon.enrollment_status(enrollment_id,status_id,status_month,status_year) VALUES($1,$2,10,2026)', [id, statuses.get('N')]);
            const receipt = await payment(id);
            assert.equal((await database.query('SELECT inserted_status_history_id FROM kumon.billing_detail WHERE billing_id=$1', [receipt.billingId])).rows[0].inserted_status_history_id, null);
            await cancelReceiptPayment({ billingId: receipt.billingId });
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.enrollment_status WHERE enrollment_id=$1', [id])).rows[0].n, 1);
        });
        await t.test('Cancelling October cannot undo a newer November receipt even if current status is C', async () => {
            const id = await student('Later receipt'), older = await payment(id);
            const newer = await receiveReceiptPayment({ enrollmentId: id, billingDate: '2026-11-01', billingMonth: 11, billingYear: 2026 });
            const result = await cancelReceiptPayment({ billingId: older.billingId });
            assert.equal(result.restoredEnrollments, 0);
            assert.equal((await database.query('SELECT current_status_group1_id AS status FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].status, statuses.get('C'));
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.billing WHERE billing_id=$1', [newer.billingId])).rows[0].n, 1);
        });
        await t.test('Ten real concurrent WS transactions finish with a ten-connection pool', async () => {
            const ids = await Promise.all(Array.from({ length: 10 }, (_, index) => student(`WS${index}`)));
            const results = await Promise.all(ids.map((enrollmentId) => saveWorksheetEntries({ enrollmentId, receiveDate: '2026-10-23', patternCode: 'daily10', mainWorksheetNos: [ws.worksheet_no] })));
            assert.equal(results.length, 10);
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.worksheet_used')).rows[0].n, 10);
        });
        await t.test('A summary failure really rolls back inserted WS rows in PostgreSQL', async (sub) => {
            const id = await student('WS failure');
            sub.mock.method(productionPool, 'connect', async () => {
                const connection = await database.connect();
                return { release: () => connection.release(), query(sql, params) {
                    if (sql.includes('can_complete_ws_level')) throw new Error('injected summary failure');
                    return connection.query(sql, params);
                } };
            });
            await assert.rejects(saveWorksheetEntries({ enrollmentId: id, receiveDate: '2026-10-23', patternCode: 'daily10', mainWorksheetNos: [ws.worksheet_no] }), /injected summary failure/);
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.worksheet_used WHERE enrollment_id=$1', [id])).rows[0].n, 0);
        });
        await t.test('Concurrent student status actions return profiles without holding connections while requesting more', async () => {
            const ids = await Promise.all(Array.from({ length: 10 }, (_, index) => student(`Status${index}`)));
            const result = await database.query('SELECT enrollment_id,student_id FROM kumon.enrollment WHERE enrollment_id=ANY($1)', [ids]);
            const profiles = await Promise.all(result.rows.map((row) => applyEnrollmentStatusAction(row.student_id, row.enrollment_id, { action: 'absent' })));
            assert.equal(profiles.length, 10); assert.equal(profiles.every((item) => item.profile.enrollments[0].statusGroup1Code === 'A'), true);
        });
        await t.test('Real concurrent stock cuts deduct the locked WS rows once, including an initially missing balance', async () => {
            await database.query('DELETE FROM kumon.stock WHERE stock_type_id=1 AND master_id=$1', [ws.worksheet_master_id]);
            const results = await Promise.allSettled([processPendingDates('ws', ['2026-10-23']), processPendingDates('ws', ['2026-10-23'])]);
            assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1, JSON.stringify(results.map((item) => item.reason?.message || item.status)));
            assert.equal(results.find((item) => item.status === 'rejected').reason.statusCode, 404);
            assert.equal((await database.query('SELECT quantity FROM kumon.stock WHERE stock_type_id=1 AND master_id=$1', [ws.worksheet_master_id])).rows[0].quantity, -10);
        });
        await t.test('Payments fail before writing if the required tracking migration has not been installed', async () => {
            const id = await student('Missing migration');
            await database.query('ALTER TABLE kumon.billing_detail DROP COLUMN payment_status_updated_at');
            try {
                await assert.rejects(payment(id), { statusCode: 409 });
                assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.billing_detail WHERE enrollment_id=$1', [id])).rows[0].n, 0);
            } finally { await database.query(migration); }
        });
        await t.test('A restore that fails during COPY rolls back its earlier drops and preserves the original rows', async () => {
            await database.query(`CREATE SCHEMA restore_probe;
                CREATE FUNCTION restore_probe.allowed(integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT TRUE';
                CREATE TABLE restore_probe.items(id integer CHECK(restore_probe.allowed(id)));
                INSERT INTO restore_probe.items VALUES(1);
                CREATE OR REPLACE FUNCTION restore_probe.allowed(integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT FALSE';`);
            const archive = path.join(root, 'invalid-data.backup');
            await run(path.join(bin, 'pg_dump.exe'), ['-h', '127.0.0.1', '-p', String(port), '-U', username, '-d', 'postgres', '-Fc', '--schema=restore_probe', '-f', archive], { env: environment, windowsHide: true });
            await database.query(`CREATE OR REPLACE FUNCTION restore_probe.allowed(integer) RETURNS boolean LANGUAGE sql IMMUTABLE AS 'SELECT TRUE'; INSERT INTO restore_probe.items VALUES(2);`);
            await assert.rejects(restoreBackupFile({ executable: path.join(bin, 'pg_restore.exe'), host: '127.0.0.1', port, user: username, dbName: 'postgres', tempFile: archive, env: environment }));
            assert.deepEqual((await database.query('SELECT id FROM restore_probe.items ORDER BY id')).rows.map((row) => row.id), [1, 2]);
        });
    } finally {
        await database?.end();
        // Both shutdown and cleanup are restricted to the uniquely generated test directory.
        assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}kumondb-isolated-pg-`));
        if (started) await run(pgctl, ['-D', data, '-m', 'fast', '-w', 'stop'], { env: environment, windowsHide: true, timeout: 20000 });
        await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});
