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
import { receiveReceiptPayment, cancelReceiptPayment, previewReceipt, getPaymentStatus } from '../services/paymentService.js';
import { saveWorksheetEntries } from '../services/worksheetService.js';
import { processPendingDates } from '../services/stockCutService.js';
import { restoreBackupFile } from '../services/backupService.js';
import { applyEnrollmentStatusAction } from '../services/studentService.js';
import { preparePaymentDatabase, paymentDatabaseStatus, prepareApplicationDatabase } from '../services/databaseUpgradeService.js';
import { readSchemaSnapshot, inspectApplicationSchema, loadSchemaContract } from '../services/databaseSchema.js';

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
        if (process.env.TEST_EXPORT_SCHEMA_CONTRACT === '1') {
            // Generated only from the verified disposable cluster, never from this machine's live data.
            const contract = await readSchemaSnapshot(database);
            // Preserve the original IN syntax: round-tripping the deparsed ANY casts changes its catalog representation.
            contract.tables.find(table => table.name === 'worksheet_forecast_average').constraints
                .find(item => item.name === 'ck_worksheet_forecast_average_scope').createDefinition = "CHECK (source_scope IN ('2Y', 'ALL'))";
            await fs.writeFile('database/schema-contract.json', JSON.stringify(contract, null, 2) + '\n');
            return;
        }
        await t.test('The approved schema contract matches the current canonical schema without branch data', async () => {
            const expected = await loadSchemaContract(), actual = await readSchemaSnapshot(database);
            assert.equal((await inspectApplicationSchema(database)).ready, true);
            // Compare the remaining catalog exactly; the finite scope check may
            // be deparsed differently by supported PostgreSQL releases.
            const scope = snapshot => snapshot.tables.find(table => table.name === 'worksheet_forecast_average').constraints.find(item => item.name === 'ck_worksheet_forecast_average_scope');
            scope(expected).definition = scope(actual).definition;
            // PG18 additionally catalogs NOT NULL constraints; nullability is
            // already compared exactly in the column metadata on both releases.
            for (const table of actual.tables) table.constraints = table.constraints.filter(item => item.type !== 'n');
            for (const table of expected.tables) for (const constraint of table.constraints) delete constraint.createDefinition;
            for (const snapshot of [expected, actual]) for (const fn of snapshot.functions) fn.definition = fn.definition.replace(/\s+/g, ' ').trim();
            assert.deepEqual(actual, expected);
        });
        await t.test('Restored equivalent scope checks need no DDL or backup; genuinely different values remain blocked with original rows intact', async () => {
            const constraint = 'ck_worksheet_forecast_average_scope';
            const row = (await database.query(`INSERT INTO kumon.worksheet_forecast_average
                (subject_id,level_master_id,worksheet_packet_no,source_scope,student_count)
                SELECT subject_id,level_master_id,1,'2Y',7 FROM kumon.level_master ORDER BY level_master_id LIMIT 1 RETURNING *`)).rows[0];
            const change = async definition => database.query(`ALTER TABLE kumon.worksheet_forecast_average DROP CONSTRAINT ${constraint}, ADD CONSTRAINT ${constraint} ${definition}`);
            const unchanged = async () => {
                assert.deepEqual((await database.query('SELECT * FROM kumon.worksheet_forecast_average WHERE worksheet_forecast_average_id=$1', [row.worksheet_forecast_average_id])).rows[0], row);
            };
            try {
                for (const definition of [
                    "CHECK (source_scope::text = ANY (ARRAY['2Y'::text, 'ALL'::text]))",
                    "CHECK (source_scope IN ('ALL', '2Y'))",
                    "CHECK (((source_scope)::text = ANY ((ARRAY['2Y'::varchar, 'ALL'::varchar])::text[])))"
                ]) {
                    await change(definition);
                    const before = await readSchemaSnapshot(database);
                    const result = await prepareApplicationDatabase({ database, backup: async () => { throw Error('Equivalent constraints must not trigger a backup or repair'); }, report: async () => {} });
                    assert.deepEqual(result, { ready: true, applied: false, changes: [] });
                    assert.deepEqual(await readSchemaSnapshot(database), before); await unchanged();
                }
                await change("CHECK (source_scope IN ('2Y', 'ALL', 'OTHER'))");
                const before = await readSchemaSnapshot(database);
                await assert.rejects(prepareApplicationDatabase({ database, backup: async () => { throw Error('Conflicts must stop before backup'); }, report: async () => {} }), error => error.statusCode === 409 && error.message.includes('OTHER') && error.message.includes('คาดหวัง'));
                assert.deepEqual(await readSchemaSnapshot(database), before); await unchanged();
            } finally {
                await change("CHECK (source_scope IN ('2Y', 'ALL'))");
                await database.query('DELETE FROM kumon.worksheet_forecast_average WHERE worksheet_forecast_average_id=$1', [row.worksheet_forecast_average_id]);
            }
        });
        const migration = await fs.readFile('database/004_payment_status_provenance.sql', 'utf8');
        await t.test('Payment migration upgrades a legacy schema and is safe to apply twice', async () => {
            await database.query('ALTER TABLE kumon.billing_detail DROP COLUMN inserted_status_history_id, DROP COLUMN payment_status_updated_at');
            await database.query(migration); await database.query(migration);
            const columns = await database.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='kumon' AND table_name='billing_detail' AND column_name IN ('inserted_status_history_id','payment_status_updated_at')`);
            assert.equal(columns.rows.length, 2);
        });
        await t.test('Admin schema preparation refuses failed backups, saves a real disposable dump before DDL and is idempotent', async () => {
            await database.query('ALTER TABLE kumon.billing_detail DROP COLUMN inserted_status_history_id, DROP COLUMN payment_status_updated_at');
            await assert.rejects(preparePaymentDatabase({ database, backup: async () => { throw new Error('fixture backup failed'); } }), /fixture backup failed/);
            assert.equal((await paymentDatabaseStatus(database)).ready, false);
            await assert.rejects(preparePaymentDatabase({ database, backup: async () => ({ filename: 'empty.backup', sizeBytes: 0 }) }), { statusCode: 500 });
            assert.equal((await paymentDatabaseStatus(database)).ready, false);
            let backups = 0;
            const snapshot = path.join(root, 'before-payment-upgrade.backup');
            const backup = async () => {
                backups++;
                assert.equal((await paymentDatabaseStatus(database)).ready, false);
                await run(path.join(bin, 'pg_dump.exe'), ['-h', '127.0.0.1', '-p', String(port), '-U', username, '-d', 'postgres', '-Fc', '-f', snapshot], { env: environment, windowsHide: true, timeout: 30000 });
                return { filename: path.basename(snapshot), sizeBytes: (await fs.stat(snapshot)).size };
            };
            const result = await preparePaymentDatabase({ database, backup });
            assert.equal(result.ready, true); assert.equal(result.applied, true); assert.equal(backups, 1);
            const listing = await run(path.join(bin, 'pg_restore.exe'), ['--list', snapshot], { env: environment, windowsHide: true, timeout: 10000 });
            assert.match(listing.stdout, /TABLE DATA kumon billing_detail/);
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.billing')).rows[0].n, 0);
            assert.equal((await preparePaymentDatabase({ database, backup })).applied, false); assert.equal(backups, 1);
        });
        const statuses = new Map((await database.query('SELECT status_code,status_id FROM kumon.status_master')).rows.map((row) => [row.status_code, row.status_id]));
        const ws = (await database.query(`SELECT wm.worksheet_master_id,wm.worksheet_no,wm.level_master_id FROM kumon.worksheet_master wm JOIN kumon.level_master lm ON lm.level_master_id=wm.level_master_id WHERE lm.subject_id=1 AND lm.level_type=1 ORDER BY wm.worksheet_master_id LIMIT 1`)).rows[0];
        async function student(name) {
            const person = (await database.query(`INSERT INTO kumon.student(prefix_id,first_name,last_name,birth_date) VALUES((SELECT MIN(prefix_id) FROM kumon.prefix_master),$1,'Test','2019-01-01') RETURNING student_id`, [name])).rows[0];
            return (await database.query(`INSERT INTO kumon.enrollment(student_id,subject_id,current_level_master_id,starting_worksheet_master_id,en_start_date,current_status_group1_id) VALUES($1,1,$2,$3,'2026-10-01',$4) RETURNING enrollment_id`, [person.student_id, ws.level_master_id, ws.worksheet_master_id, statuses.get('N')])).rows[0].enrollment_id;
        }
        const payment = (enrollmentId) => receiveReceiptPayment({ enrollmentId, billingDate: '2026-10-23', billingMonth: 10, billingYear: 2026 });
        await t.test('Paying two of three subjects commits exactly two details and leaves the third for a second receipt', async () => {
            const id = await student('Partial three');
            const person = (await database.query('SELECT student_id FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].student_id;
            const ids = [id];
            for (const code of ['EFL', 'TRP']) {
                const master = (await database.query(`SELECT wm.worksheet_master_id,wm.level_master_id,lm.subject_id FROM kumon.worksheet_master wm JOIN kumon.level_master lm ON lm.level_master_id=wm.level_master_id JOIN kumon.subject_master sm ON sm.subject_id=lm.subject_id WHERE sm.subject_code=$1 AND lm.level_type=1 ORDER BY wm.worksheet_master_id LIMIT 1`, [code])).rows[0];
                ids.push((await database.query(`INSERT INTO kumon.enrollment(student_id,subject_id,current_level_master_id,starting_worksheet_master_id,en_start_date,current_status_group1_id) VALUES($1,$2,$3,$4,'2026-10-01',$5) RETURNING enrollment_id`, [person, master.subject_id, master.level_master_id, master.worksheet_master_id, statuses.get('N')])).rows[0].enrollment_id);
            }
            const payload = { enrollmentId: ids[2], billingDate: '2026-10-23', billingMonth: 10, billingYear: 2026, selectedEnrollmentIds: ids.slice(0, 2) };
            const first = await receiveReceiptPayment(payload);
            assert.deepEqual(first.receipt.receiptDetails.map((row) => row.enrollmentId), ids.slice(0, 2));
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.billing_detail WHERE billing_id=$1', [first.billingId])).rows[0].n, 2);
            const next = await previewReceipt({ ...payload, selectedEnrollmentIds: null });
            assert.equal(next.receipt.partiallyPaid, true); assert.equal(next.receipt.billingId, null);
            assert.deepEqual(next.receipt.receiptDetails.map((row) => row.enrollmentId), ids.slice(2));
            const status = await getPaymentStatus({ billingMonth: 10, billingYear: 2026, status: 'partial' });
            assert.equal(status.rows.find((row) => row.studentId === person)?.unpaidEnrollmentCount, 1);
            const second = await receiveReceiptPayment({ ...payload, selectedEnrollmentIds: ids.slice(2) });
            assert.notEqual(first.billingId, second.billingId);
            assert.deepEqual(second.receipt.receiptDetails.map((row) => row.enrollmentId), ids.slice(2));
        });
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
        await t.test('Whole-app upgrades repair missing structures after a real backup, preserve all existing rows and are idempotent', async () => {
            assert.equal((await inspectApplicationSchema(database)).ready, true);
            const before = (await database.query(`SELECT
                (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.student_id) FROM student t) AS students,
                (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.billing_id) FROM billing t) AS receipts,
                (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.enrollment_id) FROM enrollment t) AS enrollments`)).rows[0];
            await database.query(`ALTER TABLE student DROP COLUMN remark;
                ALTER TABLE billing_detail DROP COLUMN payment_status_updated_at;
                DROP TABLE worksheet_forecast_average;
                DROP TABLE stock_receive;
                DROP INDEX idx_session_expire;
                DROP FUNCTION fn_get_level_master_id(varchar,varchar);
                ALTER TABLE stock ALTER COLUMN quantity DROP DEFAULT;
                ALTER TABLE student DROP CONSTRAINT fk_student_gender;`);
            const broken = await inspectApplicationSchema(database);
            assert.deepEqual(broken.blockers, []); assert.equal(broken.ready, false);
            const report = async () => {};
            await assert.rejects(prepareApplicationDatabase({ database, report, backup: async () => { throw Error('fixture whole backup failed'); } }), /fixture whole backup failed/);
            assert.equal((await inspectApplicationSchema(database)).ready, false);
            let backups = 0;
            const archive = path.join(root, 'before-whole-upgrade.backup');
            const backup = async () => {
                backups++;
                assert.equal((await inspectApplicationSchema(database)).ready, false);
                await run(path.join(bin, 'pg_dump.exe'), ['-h','127.0.0.1','-p',String(port),'-U',username,'-d','postgres','-Fc','-f',archive], { env: environment, windowsHide: true });
                return { filename: path.basename(archive), sizeBytes: (await fs.stat(archive)).size };
            };
            const result = await prepareApplicationDatabase({ database, backup, report });
            assert.equal(result.applied, true); assert.equal(result.ready, true); assert.equal(backups, 1);
            assert.ok(result.changes.some(item => item.kind === 'function')); assert.ok(result.changes.some(item => item.kind === 'table'));
            assert.match((await run(path.join(bin, 'pg_restore.exe'), ['--list',archive], { windowsHide: true })).stdout, /TABLE DATA kumon student/);
            assert.equal((await inspectApplicationSchema(database)).ready, true);
            assert.equal((await prepareApplicationDatabase({ database, backup, report })).applied, false); assert.equal(backups, 1);
            const after = (await database.query(`SELECT
                (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.student_id) FROM student t) AS students,
                (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.billing_id) FROM billing t) AS receipts,
                (SELECT jsonb_agg(to_jsonb(t) ORDER BY t.enrollment_id) FROM enrollment t) AS enrollments`)).rows[0];
            assert.deepEqual(after, before);
        });
        await t.test('Whole-app upgrades reject unknown historical values, type conflicts and competing upgrades without changing data', async () => {
            const report = async () => {}, backup = async () => assert.fail('Unsafe structure must stop before backup or DDL');
            await database.query('ALTER TABLE student DROP COLUMN first_name');
            await assert.rejects(prepareApplicationDatabase({ database, backup, report }), /first_name/);
            assert.equal((await database.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='kumon' AND table_name='student' AND column_name='first_name'`)).rows[0].n, 0);
            await database.query("ALTER TABLE student ADD COLUMN first_name varchar(100) NOT NULL DEFAULT 'Fixture'; ALTER TABLE student ALTER COLUMN first_name DROP DEFAULT");
            await database.query('ALTER TABLE student ALTER COLUMN mobile TYPE varchar(30)');
            await assert.rejects(prepareApplicationDatabase({ database, backup, report }), /mobile/);
            await database.query('ALTER TABLE student ALTER COLUMN mobile TYPE varchar(20)');
            const holder = await database.connect();
            try {
                await holder.query('SELECT pg_advisory_lock(76401,2)');
                await assert.rejects(prepareApplicationDatabase({ database, backup, report }), { statusCode: 409 });
            } finally { await holder.query('SELECT pg_advisory_unlock(76401,2)'); holder.release(); }
        });
        await t.test('A failing added uniqueness constraint rolls back every earlier whole-app repair and retains duplicate rows for manual review', async () => {
            await database.query(`ALTER TABLE student DROP COLUMN remark; ALTER TABLE stock DROP CONSTRAINT uq_stock;
                INSERT INTO stock(stock_type_id,master_id,quantity) SELECT stock_type_id,master_id,quantity FROM stock LIMIT 1`);
            const count = (await database.query('SELECT count(*)::int AS n FROM stock')).rows[0].n;
            await assert.rejects(prepareApplicationDatabase({ database, report: async () => {}, backup: async () => ({ filename: 'fixture.backup', sizeBytes: 10 }) }), /unique|ซ้ำ|uq_stock/i);
            assert.equal((await database.query(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema='kumon' AND table_name='student' AND column_name='remark'`)).rows[0].n, 0);
            assert.equal((await database.query('SELECT count(*)::int AS n FROM stock')).rows[0].n, count);
        });
    } finally {
        await database?.end();
        // Both shutdown and cleanup are restricted to the uniquely generated test directory.
        assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}kumondb-isolated-pg-`));
        if (started) await run(pgctl, ['-D', data, '-m', 'fast', '-w', 'stop'], { env: environment, windowsHide: true, timeout: 20000 });
        await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
});
