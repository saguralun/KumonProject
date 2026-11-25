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
import { saveWorksheetEntries, saveAtCompletion, completeWorksheetLevelWithoutAt, completeZunLevel, getEnrollmentContext, deleteWorksheetEntry, updateWorksheetEntryNumber, searchEnrollments, getHistory, updateWorksheetEntryDate, getIncompleteWorksheetStudents } from '../services/worksheetService.js';
import { createDeliveryOrder, processDeliveryOrder } from '../services/stockReceiveService.js';
import { processPendingDates } from '../services/stockCutService.js';
import { restoreBackupFile } from '../services/backupService.js';
import { applyEnrollmentStatusAction, previewEnrollmentStatusAction, searchStudents, updateEnrollment, createEnrollment, getStudentProfile, updateStudent } from '../services/studentService.js';
import { paymentDatabaseStatus } from '../services/databaseStatusService.js';
import { setAccountActive, updateAccountRole } from '../services/authService.js';
import { ensureFrghStatus } from '../services/specialStatusCatalogService.js';
import { buildMonthlyReport } from '../services/reportService.js';
import { receiptSnapshot } from '../public/js/receiptSnapshot.js';
import { assertPasswordResetDatabaseSafety } from './support/authPasswordResetDatabaseChecks.js';
import { assertStockReceiveRetryDatabaseSafety } from './support/stockReceiveRetryDatabaseChecks.js';
import { checkConcurrentPermissions, checkAccountSeparation } from './support/accountSeparationDatabaseChecks.js';

const run = promisify(execFile);
const enabled = process.platform === 'win32' && process.env.TEST_ISOLATED_PG === '1';

// Fail closed until this test has verified the disposable cluster's identity.
productionPool.query = () => assert.fail('Production pool.query is poisoned');
productionPool.connect = () => assert.fail('Production pool.connect is poisoned');

test('Transactions, migrations, concurrent payments/stock/WS and failed restore on a disposable PostgreSQL cluster', {
    skip: !enabled, timeout: 360000
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
    let startAttempted = false, database, primaryError;
    try {
        // This disposable cluster already uses -F; crash durability is outside
        // this fixture. Avoid flushing its initial files and allow cold Windows
        // startup to complete before applying the unchanged transaction checks.
        await run(path.join(bin, 'initdb.exe'), ['-D', data, '-U', username, '--auth=trust', '--no-sync', '--encoding=UTF8', '--locale=C'], { env: environment, windowsHide: true, timeout: 120000 });
        startAttempted = true;
        await run(pgctl, ['-D', data, '-l', path.join(root, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port} -F -c max_connections=30`, '-w', 'start'], { env: environment, windowsHide: true, timeout: 120000 });
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
        // Use the session table from the normal schema in this verified
        // disposable cluster; no additional schema migration is needed.
        await t.test('Password reset revokes sessions across machines and rejects stale session re-saves', async () => {
            await assertPasswordResetDatabaseSafety(database);
        });
        await t.test('Two real PostgreSQL permission writers reject stale snapshots and preserve deliberate retries', async () => {
            await checkConcurrentPermissions(database);
        });
        await t.test('Create-only accounts and concurrent password/role actions preserve inactive account data and schema', async () => {
            await checkAccountSeparation(database);
        });
        await t.test('WS/CD DO retries persist across restart, preserve intentional append and process only once', async () => {
            await assertStockReceiveRetryDatabaseSafety(database);
        });
        const migration = await fs.readFile('database/004_payment_status_provenance.sql', 'utf8');
        await t.test('Payment migration upgrades a legacy schema and is safe to apply twice', async () => {
            await database.query('ALTER TABLE kumon.billing_detail DROP COLUMN inserted_status_history_id, DROP COLUMN payment_status_updated_at');
            await database.query(migration); await database.query(migration);
            const columns = await database.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='kumon' AND table_name='billing_detail' AND column_name IN ('inserted_status_history_id','payment_status_updated_at')`);
            assert.equal(columns.rows.length, 2);
            assert.equal((await paymentDatabaseStatus(database)).ready, true);
        });
        await t.test('Concurrent account changes serialize on PostgreSQL and retain the final active Admin', async () => {
            const original = (await database.query('SELECT user_id,is_active FROM kumon.app_user')).rows;
            await database.query('UPDATE kumon.app_user SET is_active=FALSE');
            let ids = [];
            try {
                ids = (await database.query(`INSERT INTO kumon.app_user(username,password_hash,display_name,role,is_active)
                    VALUES ('audit_admin_one','fixture-only','Fixture One','admin',TRUE),
                           ('audit_admin_two','fixture-only','Fixture Two','admin',TRUE) RETURNING user_id`)).rows.map(row => row.user_id);
                const changes = await Promise.allSettled([setAccountActive(ids[0], false), updateAccountRole(ids[1], 'staff')]);
                assert.equal(changes.filter(change => change.status === 'fulfilled').length, 1);
                assert.equal(changes.find(change => change.status === 'rejected').reason.statusCode, 400);
                assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM kumon.app_user WHERE role='admin' AND is_active")).rows[0].n, 1);
            } finally {
                await database.query('DELETE FROM kumon.app_user WHERE user_id=ANY($1::int[])', [ids]);
                for (const row of original) await database.query('UPDATE kumon.app_user SET is_active=$2 WHERE user_id=$1', [row.user_id, row.is_active]);
            }
        });
        await t.test('FRGH catalog preparation skips existing centers, backs up missing data once and preserves a center-owned ID', async () => {
            const schemaSql="SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='kumon' ORDER BY table_name,ordinal_position";
            const schemaBefore=(await database.query(schemaSql)).rows;
            assert.equal((await ensureFrghStatus({database,backup:()=>assert.fail('Existing FRGH must not back up')})).added,false);
            await database.query("DELETE FROM kumon.status_master WHERE status_code='FRGH'");
            const before=(await database.query('SELECT * FROM kumon.status_master ORDER BY status_id')).rows;
            await assert.rejects(ensureFrghStatus({database,backup:async()=>{throw Error('fixture backup failed');}}),/fixture backup failed/);
            assert.deepEqual((await database.query('SELECT * FROM kumon.status_master ORDER BY status_id')).rows,before);
            await database.query("INSERT INTO kumon.status_master VALUES(15,'CENTER','Center custom status',2)");
            let backups=0;
            const backup=async()=>{
                backups++;assert.equal((await database.query("SELECT COUNT(*)::int AS n FROM kumon.status_master WHERE status_code='FRGH'")).rows[0].n,0);
                return {filename:'isolated-frgh.backup',sizeBytes:100};
            };
            const prepared=await Promise.all([ensureFrghStatus({database,backup}),ensureFrghStatus({database,backup})]);
            assert.equal(backups,1);assert.equal(prepared.filter(r=>r.added).length,1);
            assert.ok(prepared.every(r=>r.statusId===16));
            assert.equal((await database.query('SELECT status_code FROM kumon.status_master WHERE status_id=15')).rows[0].status_code,'CENTER');
            assert.deepEqual((await database.query(schemaSql)).rows,schemaBefore);
        });
        await t.test('Future birthday edits cannot write a student; legacy unchanged dates and valid corrections still save', async () => {
            const row = (await database.query(`INSERT INTO kumon.student(prefix_id,first_name,last_name,birth_date)
                VALUES((SELECT MIN(prefix_id) FROM kumon.prefix_master),'Birth safety','Only','2019-01-01') RETURNING student_id,prefix_id`)).rows[0];
            const payload = { prefixId: row.prefix_id, firstName: 'Birth safety', lastName: 'Only' };
            const future = `${new Date().getFullYear() + 5}-01-01`;
            await assert.rejects(updateStudent(row.student_id, { ...payload, firstName: 'Must not write', birthDate: future }), { statusCode: 400 });
            assert.equal((await database.query('SELECT first_name FROM kumon.student WHERE student_id=$1', [row.student_id])).rows[0].first_name, 'Birth safety');
            assert.equal((await updateStudent(row.student_id, { ...payload, birthDate: '2019-02-03' })).student.birthDate, '2019-02-03');
            await database.query('UPDATE kumon.student SET birth_date=$2 WHERE student_id=$1', [row.student_id, future]);
            assert.equal((await updateStudent(row.student_id, { ...payload, firstName: 'Other field', birthDate: future })).student.firstName, 'Other field');
        });
        await t.test('Appending a pending DO cannot silently change dates or add quantities on a date mismatch', async () => {
            const master = (await database.query('SELECT MIN(worksheet_master_id) AS id FROM kumon.worksheet_master')).rows[0].id;
            const payload = { doNo: 'isolated-round3-dates', outDate: '2026-11-20', receiveDate: '2026-11-20', items: [{ masterId: master, quantity: 2 }] };
            const order = await createDeliveryOrder('ws', payload);
            for (const key of ['outDate', 'receiveDate']) await assert.rejects(createDeliveryOrder('ws', { ...payload, [key]: '2026-11-21' }), { statusCode: 409 });
            assert.equal((await database.query('SELECT SUM(quantity)::int AS n FROM kumon.stock_receive WHERE stock_do_id=$1', [order.doId])).rows[0].n, 2);
            await createDeliveryOrder('ws', payload);
            assert.equal((await database.query('SELECT SUM(quantity)::int AS n FROM kumon.stock_receive WHERE stock_do_id=$1', [order.doId])).rows[0].n, 4);
            assert.equal((await database.query('SELECT receive_month FROM kumon.stock_do WHERE stock_do_id=$1', [order.doId])).rows[0].receive_month, 11);
            const legacy = { ...payload, doNo: 'isolated-round3-legacy-dates', receiveDate: '2026-11-21' };
            const legacyOrder = await createDeliveryOrder('ws', legacy);
            delete legacy.receiveDate;
            await createDeliveryOrder('ws', legacy);
            const header = (await database.query('SELECT receive_date::text,receive_month FROM kumon.stock_do WHERE stock_do_id=$1', [legacyOrder.doId])).rows[0];
            assert.deepEqual(header, { receive_date: '2026-11-21', receive_month: 12 });
        });
        const statuses = new Map((await database.query('SELECT status_code,status_id FROM kumon.status_master')).rows.map((row) => [row.status_code, row.status_id]));
        const ws = (await database.query(`SELECT wm.worksheet_master_id,wm.worksheet_no,wm.level_master_id FROM kumon.worksheet_master wm JOIN kumon.level_master lm ON lm.level_master_id=wm.level_master_id WHERE lm.subject_id=1 AND lm.level_type=1 ORDER BY wm.worksheet_master_id LIMIT 1`)).rows[0];
        async function student(name) {
            const person = (await database.query(`INSERT INTO kumon.student(prefix_id,first_name,last_name,birth_date) VALUES((SELECT MIN(prefix_id) FROM kumon.prefix_master),$1,'Test','2019-01-01') RETURNING student_id`, [name])).rows[0];
            return (await database.query(`INSERT INTO kumon.enrollment(student_id,subject_id,current_level_master_id,starting_worksheet_master_id,en_start_date,current_status_group1_id) VALUES($1,1,$2,$3,'2026-10-01',$4) RETURNING enrollment_id`, [person.student_id, ws.level_master_id, ws.worksheet_master_id, statuses.get('N')])).rows[0].enrollment_id;
        }
        const payment = (enrollmentId) => receiveReceiptPayment({ enrollmentId, billingDate: '2026-10-23', billingMonth: 10, billingYear: 2026 });
        async function enrollmentPayloadFor(id) {
            const row = (await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0];
            return { subjectId: row.subject_id, currentLevelMasterId: row.current_level_master_id, currentZunLevelMasterId: row.current_zun_level_master_id,
                startingWorksheetMasterId: row.starting_worksheet_master_id, enStartDate: '2026-10-01', currentStatusGroup1Id: row.current_status_group1_id,
                currentStatusGroup2Id: row.current_status_group2_id, kumonStudentId: row.kumon_student_id, isKumonConnect: row.is_kumon_connect,
                openingScheduleId1: row.opening_schedule_id1, openingScheduleId2: row.opening_schedule_id2, remark: row.remark };
        }
        await t.test('Unified WS search finds IDs, names and nicknames together, ranks exact IDs first, and preserves subject/status filters', async () => {
            const searchStudent = async (name, id) => {
                const temporary = await student(name);
                await database.query(`WITH moved AS (DELETE FROM kumon.enrollment WHERE enrollment_id=$1 RETURNING *)
                    INSERT INTO kumon.enrollment(enrollment_id,student_id,subject_id,current_level_master_id,starting_worksheet_master_id,en_start_date,current_status_group1_id)
                    OVERRIDING SYSTEM VALUE SELECT $2,student_id,subject_id,current_level_master_id,starting_worksheet_master_id,en_start_date,current_status_group1_id FROM moved`,[temporary,id]);
            };
            await searchStudent('ค้นรวม ไทย',500001);
            await searchStudent('ค้นรวม ก',5000011);
            const named = await student('Akira500001'), nicknamed = await student('ค้นรวม ชื่อเล่น');
            await database.query("UPDATE kumon.student SET nickname='น้อง500001' WHERE student_id=(SELECT student_id FROM kumon.enrollment WHERE enrollment_id=$1)", [nicknamed]);
            const inactive = await student('Inactive500001');
            await database.query('UPDATE kumon.enrollment SET current_status_group1_id=$2 WHERE enrollment_id=$1', [inactive,statuses.get('A')]);
            const rows = await searchEnrollments({ query:'500001',limit:30 });
            assert.deepEqual(rows.slice(0,2).map(r=>r.enrollmentId),[500001,5000011]);
            assert.deepEqual(new Set(rows.map(r=>r.enrollmentId)),new Set([500001,5000011,named,nicknamed]));
            assert.equal((await searchEnrollments({query:'#500001'}))[0].enrollmentId,500001);
            assert.equal((await searchEnrollments({query:'Akira500001'}))[0].enrollmentId,named);
            assert.equal((await searchEnrollments({query:'น้อง500001'}))[0].enrollmentId,nicknamed);
            assert.equal((await searchEnrollments({query:'ค้นรวม ไทย Test'}))[0].enrollmentId,500001);
            const efl = (await database.query('SELECT wm.worksheet_master_id,wm.level_master_id FROM kumon.worksheet_master wm JOIN kumon.level_master lm ON lm.level_master_id=wm.level_master_id WHERE lm.subject_id=2 AND lm.level_type=1 ORDER BY wm.worksheet_master_id LIMIT 1')).rows[0];
            const person=(await database.query('SELECT student_id FROM kumon.enrollment WHERE enrollment_id=500001')).rows[0].student_id;
            const added = await createEnrollment(person,{...await enrollmentPayloadFor(500001),subjectId:2,currentLevelMasterId:efl.level_master_id,startingWorksheetMasterId:efl.worksheet_master_id});
            assert.deepEqual((await searchEnrollments({query:'ค้นรวม ไทย',subject:'EFL'})).map(r=>r.enrollmentId),[added.enrollmentId]);
            assert.ok((await searchEnrollments({query:'ค้นรวม',subject:'ME'})).every(r=>r.subjectCode==='ME'));
            assert.deepEqual((await searchEnrollments({query:'500001',mode:'id'})).map(r=>r.enrollmentId),[500001,5000011]);
            assert.deepEqual(new Set((await searchEnrollments({query:'500001',mode:'name'})).map(r=>r.enrollmentId)),new Set([named,nicknamed]));
            assert.deepEqual(await searchEnrollments({query:"' OR 1=1--"}),[]);
            assert.equal((await searchEnrollments({query:'',limit:2})).length,2);
        });
        await t.test('Unused enrollment corrections sync H/FSH and preserve exemptions on the unchanged schema', async () => {
            const schemaSql = "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='kumon' ORDER BY table_name,ordinal_position";
            const schemaBefore = (await database.query(schemaSql)).rows;
            const id = await student('Editable initial data'), person = (await database.query('SELECT student_id FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].student_id;
            const data = { ...await enrollmentPayloadFor(id), enStartDate: '2026-11-15' };
            let updated = (await updateEnrollment(person, id, data)).profile.enrollments[0];
            assert.equal(updated.statusGroup2Code, 'H'); assert.equal(updated.canDeleteEnrollment, true);
            updated = (await updateEnrollment(person, id, { ...data, currentStatusGroup2Id: statuses.get('H'), enStartDate: '2026-11-21' })).profile.enrollments[0];
            assert.equal(updated.currentStatusGroup2Id, null);
            updated = (await updateEnrollment(person, id, { ...data, currentStatusGroup2Id: statuses.get('FS') })).profile.enrollments[0];
            assert.equal(updated.statusGroup2Code, 'FSH');
            updated = (await updateEnrollment(person, id, { ...data, currentStatusGroup2Id: statuses.get('FSH'), enStartDate: '2026-11-21' })).profile.enrollments[0];
            assert.equal(updated.statusGroup2Code, 'FS');
            updated = (await updateEnrollment(person, id, { ...data, currentStatusGroup2Id: statuses.get('F') })).profile.enrollments[0];
            assert.equal(updated.statusGroup2Code, 'F');
            const efl = (await database.query('SELECT wm.worksheet_master_id,wm.level_master_id FROM kumon.worksheet_master wm JOIN kumon.level_master lm ON lm.level_master_id=wm.level_master_id WHERE lm.subject_id=2 AND lm.level_type=1 ORDER BY wm.worksheet_master_id LIMIT 1')).rows[0];
            const added = await createEnrollment(person, { ...data, subjectId: 2, currentLevelMasterId: efl.level_master_id, startingWorksheetMasterId: efl.worksheet_master_id });
            const addedData = { ...data, subjectId: 2, currentLevelMasterId: efl.level_master_id, startingWorksheetMasterId: efl.worksheet_master_id, enStartDate: '2026-11-21' };
            updated = (await updateEnrollment(person, added.enrollmentId, addedData)).profile.enrollments.find(e => e.enrollmentId === added.enrollmentId);
            assert.equal(updated.enStartDate, '2026-11-21'); assert.equal(updated.canDeleteEnrollment, true);
            await saveWorksheetEntries({ enrollmentId: added.enrollmentId, receiveDate: '2026-11-22', patternCode: 'daily10', mainWorksheetNos: [1] });
            await database.query('UPDATE kumon.enrollment SET current_status_group1_id=$2 WHERE enrollment_id=$1', [added.enrollmentId, statuses.get('C')]);
            addedData.currentStatusGroup1Id = statuses.get('C');
            const before = (await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [added.enrollmentId])).rows[0];
            await assert.rejects(updateEnrollment(person, added.enrollmentId, { ...addedData, currentStatusGroup2Id: statuses.get('H') }), { statusCode: 409 });
            assert.deepEqual((await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [added.enrollmentId])).rows[0], before);
            assert.deepEqual((await database.query(schemaSql)).rows, schemaBefore);
        });
        await t.test('WS Receive Date starts at the subject Start Date only until its first WS, then follows its latest WS', async () => {
            const id = await student('First WS receive date');
            const person = (await database.query('SELECT student_id FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].student_id;
            await database.query("UPDATE kumon.enrollment SET en_start_date='2026-11-14' WHERE enrollment_id=$1", [id]);
            let context = await getEnrollmentContext(id, 30);
            assert.equal(context.history.length, 0); assert.equal(context.defaults.receiveDate, '2026-11-14');
            await updateEnrollment(person, id, { ...await enrollmentPayloadFor(id), enStartDate: '2026-11-18' });
            context = await getEnrollmentContext(id, 30);
            assert.equal(context.history.length, 0); assert.equal(context.defaults.receiveDate, '2026-11-18');
            await saveWorksheetEntries({ enrollmentId: id, receiveDate: '2026-11-20', patternCode: 'daily10', mainWorksheetNos: [1] });
            await updateEnrollment(person, id, { ...await enrollmentPayloadFor(id), enStartDate: '2026-12-05' });
            assert.equal((await getEnrollmentContext(id, 1)).defaults.receiveDate, '2026-11-21');
            // A later insert with an older WS date must not move the default back.
            await saveWorksheetEntries({ enrollmentId: id, receiveDate: '2026-11-10', patternCode: 'daily10', mainWorksheetNos: [1] });
            assert.equal((await getEnrollmentContext(id, 1)).defaults.receiveDate, '2026-11-21');
            const efl = (await database.query('SELECT wm.worksheet_master_id,wm.level_master_id FROM kumon.worksheet_master wm JOIN kumon.level_master lm ON lm.level_master_id=wm.level_master_id WHERE lm.subject_id=2 AND lm.level_type=1 ORDER BY wm.worksheet_master_id LIMIT 1')).rows[0];
            const added = await createEnrollment(person, { ...await enrollmentPayloadFor(id), subjectId: 2,
                currentLevelMasterId: efl.level_master_id, startingWorksheetMasterId: efl.worksheet_master_id,
                enStartDate: '2026-11-17', currentStatusGroup1Id: statuses.get('EO') });
            const otherContext = await getEnrollmentContext(added.enrollmentId, 30);
            assert.equal(otherContext.history.length, 0); assert.equal(otherContext.defaults.receiveDate, '2026-11-17');
            for (const [date, expected] of [['2026-11-20', '2026-11-11'], ['2026-11-10', '2026-12-05']]) {
                const record = (await database.query('SELECT worksheet_used_id FROM kumon.worksheet_used WHERE enrollment_id=$1 AND worksheet_date=$2', [id, date])).rows[0];
                await deleteWorksheetEntry({ enrollmentId: id, worksheetUsedId: record.worksheet_used_id });
                assert.equal((await getEnrollmentContext(id, 30)).defaults.receiveDate, expected);
            }
        });
        await t.test('Used N/EO enrollments can correct date and special status while history and other initial fields stay protected', async () => {
            for (const code of ['N', 'EO']) {
                const id = await student(`Correct used ${code}`);
                const person = (await database.query('SELECT student_id FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].student_id;
                await saveWorksheetEntries({ enrollmentId: id, receiveDate: '2026-10-02', patternCode: 'daily10', mainWorksheetNos: [1] });
                await database.query('UPDATE kumon.enrollment SET current_status_group1_id=$2 WHERE enrollment_id=$1', [id, statuses.get(code)]);
                await database.query('INSERT INTO kumon.enrollment_status(enrollment_id,status_id,status_month,status_year) VALUES($1,$2,10,2026)', [id, statuses.get(code)]);
                const historyBefore = {};
                for (const table of ['worksheet_used', 'enrollment_status', 'billing_detail']) {
                    historyBefore[table] = (await database.query(`SELECT * FROM kumon.${table} WHERE enrollment_id=$1`, [id])).rows;
                }
                const data = { ...await enrollmentPayloadFor(id), enStartDate: '2026-11-15' };
                let saved = (await updateEnrollment(person, id, data)).profile.enrollments[0];
                assert.equal(saved.enStartDate, '2026-11-15'); assert.equal(saved.statusGroup2Code, 'H');
                assert.equal(saved.canDeleteEnrollment, false); assert.equal(saved.statusGroup1Code, code);
                saved = (await updateEnrollment(person, id, { ...data, currentStatusGroup2Id: statuses.get('F') })).profile.enrollments[0];
                assert.equal(saved.statusGroup2Code, 'F');
                saved = (await updateEnrollment(person, id, { ...data, enStartDate: '2026-11-21', currentStatusGroup2Id: statuses.get('F') })).profile.enrollments[0];
                assert.equal(saved.statusGroup2Code, 'F');
                saved = (await updateEnrollment(person, id, { ...data, currentStatusGroup2Id: statuses.get('FS') })).profile.enrollments[0];
                assert.equal(saved.statusGroup2Code, 'FSH');
                saved = (await updateEnrollment(person, id, { ...data, enStartDate: '2026-11-21', currentStatusGroup2Id: statuses.get('FSH') })).profile.enrollments[0];
                assert.equal(saved.statusGroup2Code, 'FS');
                const currentData = { ...await enrollmentPayloadFor(id), enStartDate: saved.enStartDate };
                const before = (await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0];
                for (const change of [{ startingWorksheetMasterId: ws.worksheet_master_id + 1 }, { subjectId: 2 },
                    { currentStatusGroup1Id: statuses.get('C') }, { currentStatusGroup2Id: statuses.get('N') }]) {
                    await assert.rejects(updateEnrollment(person, id, { ...currentData, ...change }), error => [400, 409].includes(error.statusCode));
                    assert.deepEqual((await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0], before);
                }
                for (const [table, original] of Object.entries(historyBefore)) {
                    assert.deepEqual((await database.query(`SELECT * FROM kumon.${table} WHERE enrollment_id=$1`, [id])).rows, original);
                }
                await database.query('UPDATE kumon.enrollment SET current_status_group1_id=$2 WHERE enrollment_id=$1', [id, statuses.get('C')]);
                await assert.rejects(updateEnrollment(person, id, { ...currentData, currentStatusGroup2Id: statuses.get('H') }), { statusCode: 409 });
                const continueData = { ...currentData, currentStatusGroup1Id: statuses.get('C') };
                await assert.rejects(updateEnrollment(person, id, { ...continueData, currentStatusGroup2Id: statuses.get('H') }), { statusCode: 409 });
            }
        });
        await t.test('Unused edit rechecks history after waiting for a real concurrent enrollment lock', async sub => {
            const id = await student('Initial edit lock'), person = (await database.query('SELECT student_id FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].student_id;
            const data = { ...await enrollmentPayloadFor(id), enStartDate: '2026-11-15', currentStatusGroup2Id: statuses.get('H'),
                startingWorksheetMasterId: ws.worksheet_master_id + 1 };
            const blocker = await database.connect(); let reached, save;
            const lockAttempted = new Promise(resolve => { reached = resolve; });
            sub.mock.method(productionPool, 'connect', async () => {
                const connection = await database.connect();
                return { release: () => connection.release(), query(sql, params) {
                    const result = connection.query(sql, params);
                    if (sql.includes('SELECT e.*') && sql.includes('FOR UPDATE')) reached();
                    return result;
                } };
            });
            try {
                await blocker.query('BEGIN'); await blocker.query('SELECT enrollment_id FROM kumon.enrollment WHERE enrollment_id=$1 FOR UPDATE', [id]);
                save = updateEnrollment(person, id, data); save.catch(() => {}); await lockAttempted;
                await blocker.query('INSERT INTO kumon.enrollment_status(enrollment_id,status_id,status_month,status_year) VALUES($1,$2,11,2026)', [id, statuses.get('N')]);
                await blocker.query('COMMIT'); await assert.rejects(save, { statusCode: 409 });
                assert.equal((await getStudentProfile(person)).enrollments[0].enStartDate, '2026-10-01');
            } finally { await blocker.query('ROLLBACK'); blocker.release(); if (save) await Promise.allSettled([save]); }
        });
        await t.test('Date/status correction rechecks N/EO eligibility after a concurrent status change', async sub => {
            const id = await student('New status correction lock');
            const person = (await database.query('SELECT student_id FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].student_id;
            const data = { ...await enrollmentPayloadFor(id), currentStatusGroup1Id: statuses.get('C'),
                enStartDate: '2026-11-15', currentStatusGroup2Id: statuses.get('H') };
            const blocker = await database.connect(); let reached, save;
            const lockAttempted = new Promise(resolve => { reached = resolve; });
            sub.mock.method(productionPool, 'connect', async () => {
                const connection = await database.connect();
                return { release: () => connection.release(), query(sql, params) {
                    const result = connection.query(sql, params);
                    if (sql.includes('SELECT e.*') && sql.includes('FOR UPDATE')) reached();
                    return result;
                } };
            });
            try {
                await blocker.query('BEGIN'); await blocker.query('SELECT enrollment_id FROM kumon.enrollment WHERE enrollment_id=$1 FOR UPDATE', [id]);
                save = updateEnrollment(person, id, data); save.catch(() => {}); await lockAttempted;
                await blocker.query('UPDATE kumon.enrollment SET current_status_group1_id=$2 WHERE enrollment_id=$1', [id, statuses.get('C')]);
                await blocker.query('INSERT INTO kumon.enrollment_status(enrollment_id,status_id,status_month,status_year) VALUES($1,$2,11,2026)', [id, statuses.get('C')]);
                await blocker.query('COMMIT'); await assert.rejects(save, { statusCode: 409 });
                const current = (await getStudentProfile(person)).enrollments[0];
                assert.equal(current.statusGroup1Code, 'C'); assert.equal(current.enStartDate, '2026-10-01');
                assert.equal(current.currentStatusGroup2Id, null);
            } finally { await blocker.query('ROLLBACK'); blocker.release(); if (save) await Promise.allSettled([save]); }
        });
        await t.test('Student directory uses the latest uninterrupted absence per subject without changing search/filter semantics', async () => {
            const id = await student('Directory absence');
            const person = (await database.query('SELECT student_id FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].student_id;
            await database.query('UPDATE kumon.enrollment SET current_status_group1_id=$2 WHERE enrollment_id=$1', [id, statuses.get('A')]);
            for (const [code, month, year] of [['A', 1, 2020], ['R', 5, 2025], ['A', 8, 2025], ['A', 10, 2026]]) {
                await database.query('INSERT INTO kumon.enrollment_status(enrollment_id,status_id,status_month,status_year) VALUES($1,$2,$3,$4)', [id, statuses.get(code), month, year]);
            }
            const other = [];
            for (const [code, status] of [['EFL', 'C'], ['TRP', 'A']]) {
                const master = (await database.query(`SELECT lm.subject_id,wm.worksheet_master_id,wm.level_master_id FROM kumon.worksheet_master wm JOIN kumon.level_master lm ON lm.level_master_id=wm.level_master_id JOIN kumon.subject_master sm ON sm.subject_id=lm.subject_id WHERE sm.subject_code=$1 AND lm.level_type=1 ORDER BY wm.worksheet_master_id LIMIT 1`, [code])).rows[0];
                other.push((await database.query(`INSERT INTO kumon.enrollment(student_id,subject_id,current_level_master_id,starting_worksheet_master_id,en_start_date,current_status_group1_id) VALUES($1,$2,$3,$4,'2025-01-01',$5) RETURNING enrollment_id`, [person, master.subject_id, master.level_master_id, master.worksheet_master_id, statuses.get(status)])).rows[0].enrollment_id);
            }
            for (const filter of ['all', 'active', 'absent']) {
                const rows = await searchStudents({ query: 'Directory absence', status: filter });
                assert.equal(rows.length, 1); assert.equal(rows[0].studentId, person);
                const subjects = new Map(rows[0].enrollments.map(e => [e.subjectCode, e]));
                assert.deepEqual([subjects.get('ME').absenceSinceMonth, subjects.get('ME').absenceSinceYear], [8, 2025]);
                assert.equal(subjects.get('EFL').statusCode, 'C');
                assert.equal(subjects.get('EFL').absenceSinceMonth, null);
                assert.equal(subjects.get('TRP').absenceSinceMonth, null); // no invented departure date
            }
            const exact = (await searchStudents({ query: String(id), status: 'all' })).find(s => s.studentId === person);
            assert.equal(exact.matchedEnrollmentId, id);
            for (const [code, month] of [['R', 10], ['A', 10]]) {
                await database.query('INSERT INTO kumon.enrollment_status(enrollment_id,status_id,status_month,status_year) VALUES($1,$2,$3,2026)', [id, statuses.get(code), month]);
            }
            const recent = (await searchStudents({ query: 'Directory absence', status: 'absent' }))[0].enrollments.find(e => e.enrollmentId === id);
            assert.deepEqual([recent.absenceSinceMonth, recent.absenceSinceYear], [10, 2026]);
        });
        await t.test('FRGH halves tuition and additional fees, waives registration, survives Report/receipt snapshots and restores on cancellation', async () => {
            const center=(await database.query('SELECT * FROM kumon.center_master ORDER BY center_id LIMIT 1')).rows[0];
            const grade=(await database.query('SELECT school_grade_id FROM kumon.school_grade_master WHERE addition_fee=TRUE ORDER BY school_grade_id LIMIT 1')).rows[0];
            for(const code of ['FRGH','FRG','H','FSH','FS','F','P']){
                const id=await student(`Fee ${code}`);
                const person=(await database.query('SELECT student_id FROM kumon.enrollment WHERE enrollment_id=$1',[id])).rows[0].student_id;
                await database.query('UPDATE kumon.student SET school_grade_id=$2 WHERE student_id=$1',[person,grade.school_grade_id]);
                await database.query("UPDATE kumon.enrollment SET en_start_date='2026-11-15',current_status_group2_id=$2 WHERE enrollment_id=$1",[id,statuses.get(code)]);
                const payload={enrollmentId:id,billingDate:'2026-11-15',billingMonth:11,billingYear:2026};
                const draft=(await previewReceipt(payload)).receipt,detail=draft.receiptDetails[0];
                const free=['F','FS','FSH'].includes(code),half=['H','FSH','FRGH'].includes(code),waived=['FRG','FRGH'].includes(code);
                const tuition=free?0:Number(center.full_tuition)/(half?2:1),additional=free?0:Number(center.addition_full_tuition)/(half?2:1);
                assert.equal(detail.tuitionFee,tuition,code);assert.equal(detail.additionalFee,additional,code);
                assert.equal(detail.registrationFee,Number(center.registration_fee),code);
                assert.equal(detail.discountAmount,waived?Number(center.registration_fee):0,code);
                assert.equal(detail.netAmount,tuition+additional+(waived?0:Number(center.registration_fee)),code);
                if(code!=='FRGH')continue;
                const status=await getPaymentStatus({billingMonth:11,billingYear:2026,status:'unpaid'});
                assert.equal(Number(status.rows.find(r=>r.studentId===person).expectedNetAmount),tuition+additional);
                const paid=await receiveReceiptPayment(payload);
                const stored=(await database.query('SELECT * FROM kumon.billing_detail WHERE billing_id=$1',[paid.billingId])).rows[0];
                assert.equal(stored.status_group2_id,statuses.get('FRGH'));assert.equal(Number(stored.net_amount),detail.netAmount);
                const record=(await buildMonthlyReport({month:11,year:2026})).find(r=>r.ID===id);
                assert.equal(record.Status2,'FRGH');assert.equal(record.FreeEnrolment,'True');
                await updateEnrollment(person,id,{...await enrollmentPayloadFor(id),currentStatusGroup1Id:statuses.get('C'),enStartDate:'2026-11-15'});
                assert.deepEqual((await database.query('SELECT * FROM kumon.billing_detail WHERE billing_id=$1',[paid.billingId])).rows[0],stored);
                // Cancel another unchanged FRGH receipt to verify exact status restoration.
                const second=await student('FRGH cancel');
                await database.query("UPDATE kumon.enrollment SET en_start_date='2026-11-15',current_status_group2_id=$2 WHERE enrollment_id=$1",[second,statuses.get('FRGH')]);
                const receipt=await receiveReceiptPayment({...payload,enrollmentId:second});await cancelReceiptPayment({billingId:receipt.billingId});
                const restored=(await database.query('SELECT current_status_group1_id,current_status_group2_id FROM kumon.enrollment WHERE enrollment_id=$1',[second])).rows[0];
                assert.equal(restored.current_status_group1_id,statuses.get('N'));assert.equal(restored.current_status_group2_id,statuses.get('FRGH'));
            }
        });
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
        await t.test('Receipt preview changes reject before writes, while an unchanged snapshot pays normally', async () => {
            const id = await student('Printed draft conflict');
            const payload = { enrollmentId: id, billingDate: '2026-10-23', billingMonth: 10, billingYear: 2026 };
            const first = (await previewReceipt(payload)).receipt;
            // Another till takes the previously previewed receipt number.
            await payment(await student('Other till'));
            const state = async () => ({
                enrollment: (await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows,
                history: (await database.query('SELECT * FROM kumon.enrollment_status WHERE enrollment_id=$1', [id])).rows,
                bills: (await database.query('SELECT * FROM kumon.billing WHERE student_id=$1', [first.studentId])).rows
            });
            const before = await state();
            await assert.rejects(receiveReceiptPayment({ ...payload, expectedReceiptSnapshot: receiptSnapshot(first) }), { statusCode: 409 });
            assert.deepEqual(await state(), before);
            const fresh = (await previewReceipt(payload)).receipt;
            await assert.rejects(receiveReceiptPayment({ ...payload, expectedReceiptSnapshot: receiptSnapshot({ ...fresh, netAmount: fresh.netAmount + 1 }) }), { statusCode: 409 });
            await assert.rejects(receiveReceiptPayment({ ...payload, expectedReceiptSnapshot: {} }), { statusCode: 400 });
            assert.deepEqual(await state(), before);
            const paid = await receiveReceiptPayment({ ...payload, expectedReceiptSnapshot: receiptSnapshot(fresh) });
            assert.equal(paid.receipt.receiptNo, fresh.receiptNo);
            assert.equal(paid.receipt.netAmount, fresh.netAmount);
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
            const studentId = receipt.receipt.studentId;
            await assert.rejects(cancelReceiptPayment({ billingId: receipt.billingId, studentId: studentId + 1000000 }), { statusCode: 404 });
            assert.deepEqual((await database.query('SELECT * FROM kumon.billing_detail WHERE billing_id=$1', [receipt.billingId])).rows[0], metadata);
            await database.query(`INSERT INTO kumon.enrollment_status(enrollment_id,status_id,status_month,status_year) VALUES($1,$2,10,2026)`, [id, statuses.get('A')]);
            const result = await cancelReceiptPayment({ billingId: receipt.billingId, studentId });
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
        await t.test('WS history orders by ID after backdated saves, reloads and date corrections', async () => {
            const id=await student('WS history ID order');
            const first=(await saveWorksheetEntries({enrollmentId:id,receiveDate:'2027-12-20',patternCode:'daily10',mainWorksheetNos:[1]})).records[0];
            const second=(await saveWorksheetEntries({enrollmentId:id,receiveDate:'2026-10-01',patternCode:'daily10',mainWorksheetNos:[11]})).records[0];
            assert.ok(second.worksheetUsedId>first.worksheetUsedId);
            assert.deepEqual((await getHistory(id,30)).map(r=>r.worksheetUsedId),[second.worksheetUsedId,first.worksheetUsedId]);
            assert.deepEqual((await getHistory(id,1)).map(r=>r.worksheetUsedId),[second.worksheetUsedId]);
            assert.deepEqual((await getEnrollmentContext(id,30)).history.map(r=>r.worksheetUsedId),[second.worksheetUsedId,first.worksheetUsedId]);
            await updateWorksheetEntryDate({enrollmentId:id,worksheetUsedId:first.worksheetUsedId,worksheetDate:'2028-01-01'});
            assert.deepEqual((await getHistory(id,30)).map(r=>r.worksheetUsedId),[second.worksheetUsedId,first.worksheetUsedId]);
            const batch=(await saveWorksheetEntries({enrollmentId:id,receiveDate:'2026-09-01',patternCode:'twoDays10',mainWorksheetNos:[21]})).records;
            assert.equal(batch.length,2);assert.ok(batch[0].worksheetUsedId>batch[1].worksheetUsedId);
            const expected=[...batch.map(r=>r.worksheetUsedId),second.worksheetUsedId,first.worksheetUsedId];
            assert.deepEqual((await getHistory(id,30)).map(r=>r.worksheetUsedId),expected);
            const sameDay=(await saveWorksheetEntries({enrollmentId:id,receiveDate:'2028-01-01',patternCode:'daily20',mainWorksheetNos:[31,41]})).records;
            assert.ok(sameDay[0].worksheetUsedId>sameDay[1].worksheetUsedId);
            assert.deepEqual((await getHistory(id,30)).map(r=>r.worksheetUsedId),[...sameDay.map(r=>r.worksheetUsedId),...expected]);
        });
        await t.test('Latest WS follows Receive Date and same-day ID while Input history follows insertion ID', async () => {
            const id = await student('Receive Date latest WS');
            const year = new Date().getFullYear() - 2;
            const newerDate = `${year}-11-20`, olderDate = `${year}-10-20`;
            const save = async (date, number) => (await saveWorksheetEntries({
                enrollmentId: id, receiveDate: date, patternCode: 'daily10', mainWorksheetNos: [number]
            })).records[0];
            const first = await save(olderDate, 131);
            const latest = await save(newerDate, 121);
            const backdated = await save(olderDate, 151);
            const context = await getEnrollmentContext(id, 1);
            // Even with a history limit of one, the latest calculation reads all WS.
            assert.equal(context.history[0].worksheetUsedId, backdated.worksheetUsedId);
            assert.equal(context.defaults.receiveDate, `${year}-11-21`);
            assert.equal(context.defaults.mainWorksheetNo, 121);
            assert.equal(context.worksheetProgress.main.actualWorksheetNo, 121);
            assert.equal(context.worksheetProgress.main.displayWorksheetNo, 130);
            const findIncomplete = async () => {
                let result = await getIncompleteWorksheetStudents();
                for (let page = 1; page <= result.regular.totalPages; page++) {
                    if (page > 1) result = await getIncompleteWorksheetStudents({ regularPage: page });
                    const row = result.regular.rows.find(row => row.enrollmentId === id);
                    if (row) return row;
                }
                assert.fail('Fixture enrollment missing from incomplete WS');
            };
            let incomplete = await findIncomplete();
            assert.equal(incomplete.latestWorksheetDate, newerDate);
            assert.equal(incomplete.latestPacketWorksheetNo, 121);
            const sameDay = await save(newerDate, 31);
            let refreshed = await getEnrollmentContext(id, 30);
            assert.deepEqual(refreshed.history.map(row => row.worksheetUsedId),
                [sameDay.worksheetUsedId, backdated.worksheetUsedId, latest.worksheetUsedId, first.worksheetUsedId]);
            assert.equal(refreshed.defaults.mainWorksheetNo, 31);
            assert.equal(refreshed.worksheetProgress.main.actualWorksheetNo, 31);
            incomplete = await findIncomplete();
            assert.equal(incomplete.latestPacketWorksheetNo, 31);
            // A newly entered ancient date stays visible, without becoming latest.
            const incorrect = await save('0092-03-20', 191);
            refreshed = await getEnrollmentContext(id, 1);
            assert.equal(refreshed.history[0].worksheetUsedId, incorrect.worksheetUsedId);
            assert.equal(refreshed.defaults.mainWorksheetNo, 31);
            assert.equal(refreshed.worksheetProgress.main.actualWorksheetNo, 31);
            await updateWorksheetEntryDate({ enrollmentId: id, worksheetUsedId: sameDay.worksheetUsedId, worksheetDate: olderDate });
            refreshed = await getEnrollmentContext(id, 30);
            assert.equal(refreshed.history[0].worksheetUsedId, incorrect.worksheetUsedId);
            assert.equal(refreshed.worksheetProgress.main.actualWorksheetNo, 121);
            assert.equal((await findIncomplete()).latestPacketWorksheetNo, 121);
        });
        await t.test('Ten real concurrent WS transactions finish with a ten-connection pool', async () => {
            const ids = await Promise.all(Array.from({ length: 10 }, (_, index) => student(`WS${index}`)));
            const results = await Promise.all(ids.map((enrollmentId) => saveWorksheetEntries({ enrollmentId, receiveDate: '2026-10-23', patternCode: 'daily10', mainWorksheetNos: [ws.worksheet_no] })));
            assert.equal(results.length, 10);
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.worksheet_used WHERE enrollment_id=ANY($1::int[])', [ids])).rows[0].n, 10);
        });
        await t.test('Unprocessed WS number corrections retain record/date/CPWS and move the pending stock packet', async () => {
            const id = await student('Correct WS packet');
            const saved = await saveWorksheetEntries({ enrollmentId: id, receiveDate: '2027-03-03', patternCode: 'daily10', mainWorksheetNos: [1] });
            const row = saved.records[0];
            const stockBefore = (await database.query('SELECT * FROM kumon.stock ORDER BY stock_type_id,master_id')).rows;
            const payload = { enrollmentId: id, worksheetUsedId: row.worksheetUsedId, worksheetNo: 26,
                expectedWorksheetMasterId: row.worksheetMasterId, expectedActualWorksheetNo: row.actualWorksheetNo };
            const corrected = await updateWorksheetEntryNumber(payload);
            assert.equal(corrected.entry.worksheetUsedId, row.worksheetUsedId);
            assert.equal(corrected.entry.actualWorksheetNo, 26); assert.equal(corrected.entry.packetWorksheetNo, 21);
            assert.equal(corrected.entry.levelMasterId, row.levelMasterId); assert.equal(corrected.entry.worksheetDate, row.worksheetDate);
            assert.equal(corrected.entry.cpws, true); assert.equal(corrected.entry.isStockProcessed, false);
            assert.equal(corrected.worksheetProgress.main.actualWorksheetNo, 26);
            assert.deepEqual(corrected.worksheetPacketSummary.main.rows.map(r => [r.packetWorksheetNo,r.count]), [[21,1]]);
            assert.deepEqual((await database.query('SELECT * FROM kumon.stock ORDER BY stock_type_id,master_id')).rows, stockBefore);
            const continuation = (await database.query(`INSERT INTO kumon.worksheet_used(enrollment_id,worksheet_master_id,actual_worksheet_no,worksheet_date,worksheet_month,worksheet_year,cpws,is_stock_processed)
                VALUES($1,$2,6,'2027-03-03',3,2027,FALSE,FALSE) RETURNING worksheet_used_id`, [id, row.worksheetMasterId])).rows[0];
            const automatic = await updateWorksheetEntryNumber({ ...payload, worksheetUsedId: continuation.worksheet_used_id, expectedActualWorksheetNo: 6, worksheetNo: 16 });
            assert.equal(automatic.entry.cpws, false); assert.equal(automatic.entry.packetWorksheetNo, 11);
            assert.equal(automatic.worksheetProgress.main.actualWorksheetNo, 26);
            for (const worksheetNo of [0, 201, 1.5, '']) await assert.rejects(updateWorksheetEntryNumber({ ...payload, worksheetNo }), { statusCode: 400 });
            await assert.rejects(updateWorksheetEntryNumber({ ...payload, worksheetNo: 46 }), { statusCode: 409 });
            const other = await student('Wrong WS owner');
            await assert.rejects(updateWorksheetEntryNumber({ ...payload, enrollmentId: other }), { statusCode: 404 });
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.worksheet_used WHERE enrollment_id=$1', [id])).rows[0].n, 2);
            const beforeQty = (await database.query('SELECT quantity FROM kumon.stock WHERE stock_type_id=1 AND master_id=$1', [corrected.entry.worksheetMasterId])).rows[0]?.quantity || 0;
            await processPendingDates('ws', ['2027-03-03']);
            assert.equal((await database.query('SELECT quantity FROM kumon.stock WHERE stock_type_id=1 AND master_id=$1', [corrected.entry.worksheetMasterId])).rows[0].quantity, beforeQty-1);
            await assert.rejects(updateWorksheetEntryNumber({ ...payload, expectedWorksheetMasterId: corrected.entry.worksheetMasterId, expectedActualWorksheetNo: 26, worksheetNo: 46 }), { statusCode: 409 });
        });
        await t.test('Zun number corrections remain in the original level and reject numbers beyond Zun 100', async () => {
            const id = await student('Correct Zun packet');
            const zun = (await database.query("SELECT level_master_id FROM kumon.level_master WHERE level_type=2 AND level_code='ZI' ORDER BY level_master_id LIMIT 1")).rows[0];
            await database.query('UPDATE kumon.enrollment SET current_zun_level_master_id=$2 WHERE enrollment_id=$1', [id,zun.level_master_id]);
            const saved = await saveWorksheetEntries({ enrollmentId: id, receiveDate: '2027-03-04', patternCode: 'daily10', mainWorksheetNos: [1], zunWorksheetNos: [91] });
            const row = saved.records.find(r => r.worksheetType === 'ZUN');
            const payload = { enrollmentId:id, worksheetUsedId:row.worksheetUsedId, expectedWorksheetMasterId:row.worksheetMasterId, expectedActualWorksheetNo:row.actualWorksheetNo };
            await assert.rejects(updateWorksheetEntryNumber({ ...payload, worksheetNo:101 }), { statusCode:400 });
            const result = await updateWorksheetEntryNumber({ ...payload, worksheetNo:36 });
            assert.equal(result.entry.worksheetType,'ZUN'); assert.equal(result.entry.packetWorksheetNo,31);
            assert.equal(result.entry.levelMasterId,zun.level_master_id);
            assert.equal((await getEnrollmentContext(id,30)).enrollment.currentZunLevelMasterId,zun.level_master_id);
        });
        await t.test('A failed WS correction summary rolls back the number and packet together', async sub => {
            const id = await student('Correct WS rollback');
            const row = (await saveWorksheetEntries({ enrollmentId:id, receiveDate:'2027-03-05', patternCode:'daily10', mainWorksheetNos:[1] })).records[0];
            const before = (await database.query('SELECT * FROM kumon.worksheet_used WHERE worksheet_used_id=$1',[row.worksheetUsedId])).rows[0];
            sub.mock.method(productionPool,'connect',async () => {
                const connection=await database.connect();
                return { release:()=>connection.release(),query(sql,params) {
                    if (sql.includes('can_complete_ws_level')) throw new Error('correction summary failed');
                    return connection.query(sql,params);
                } };
            });
            await assert.rejects(updateWorksheetEntryNumber({ enrollmentId:id,worksheetUsedId:row.worksheetUsedId,worksheetNo:46,
                expectedWorksheetMasterId:row.worksheetMasterId,expectedActualWorksheetNo:1 }),/correction summary failed/);
            assert.deepEqual((await database.query('SELECT * FROM kumon.worksheet_used WHERE worksheet_used_id=$1',[row.worksheetUsedId])).rows[0],before);
        });
        for (const first of ['cut','edit']) await t.test(`WS correction and stock cut serialize when ${first} locks the record first`,async sub => {
            const id=await student(`Correct stock race ${first}`), date=first==='cut'?'2027-03-06':'2027-03-07';
            const row=(await saveWorksheetEntries({enrollmentId:id,receiveDate:date,patternCode:'daily10',mainWorksheetNos:[1]})).records[0];
            let reachedFirst,reachedSecond,release;
            const firstLocked=new Promise(resolve=>{reachedFirst=resolve;}),secondAttempted=new Promise(resolve=>{reachedSecond=resolve;}),hold=new Promise(resolve=>{release=resolve;});
            sub.mock.method(productionPool,'connect',async()=>{
                const connection=await database.connect();
                return {release:()=>connection.release(),async query(sql,params){
                    const operation=sql.includes('ORDER BY worksheet_used_id FOR UPDATE')?'cut':sql.includes('FOR UPDATE OF wu')?'edit':null;
                    if(operation && operation!==first) reachedSecond();
                    const result=await connection.query(sql,params);
                    if(operation===first){reachedFirst();await hold;}
                    return result;
                }};
            });
            const edit=()=>updateWorksheetEntryNumber({enrollmentId:id,worksheetUsedId:row.worksheetUsedId,worksheetNo:46,expectedWorksheetMasterId:row.worksheetMasterId,expectedActualWorksheetNo:1});
            const cut=()=>processPendingDates('ws',[date]);
            let one,two;
            try {
                one=first==='cut'?cut():edit(); one.catch(()=>{}); await firstLocked;
                two=first==='cut'?edit():cut(); two.catch(()=>{}); await secondAttempted; release();
                const results=await Promise.allSettled([one,two]);
                assert.equal(results[0].status,'fulfilled');
                if(first==='cut'){assert.equal(results[1].status,'rejected');assert.equal(results[1].reason.statusCode,409);}
                else assert.equal(results[1].status,'fulfilled');
                const current=(await database.query('SELECT * FROM kumon.worksheet_used WHERE worksheet_used_id=$1',[row.worksheetUsedId])).rows[0];
                assert.equal(current.is_stock_processed,true);assert.equal(current.actual_worksheet_no,first==='cut'?1:46);
            } finally {release();await Promise.allSettled([one,two].filter(Boolean));}
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
        await t.test('Status Preview is read-only in PostgreSQL and stale confirmations preserve enrollment data until reviewed again', async () => {
            const id = await student('Status preview');
            const before = (await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0];
            const { preview } = await previewEnrollmentStatusAction(before.student_id, id, { action: 'absent' });
            assert.equal(preview.statusCode, 'A');
            assert.deepEqual((await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0], before);
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.enrollment_status WHERE enrollment_id=$1', [id])).rows[0].n, 0);
            await database.query("UPDATE kumon.enrollment SET current_status_group2_id=(SELECT status_id FROM kumon.status_master WHERE status_code='H' AND status_group=2) WHERE enrollment_id=$1", [id]);
            const changed = (await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0];
            await assert.rejects(applyEnrollmentStatusAction(before.student_id, id, { action: 'absent', expectedPlan: preview.fingerprint }), { statusCode: 409 });
            assert.deepEqual((await database.query('SELECT * FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0], changed);
            const fresh = await previewEnrollmentStatusAction(before.student_id, id, { action: 'absent' });
            assert.equal((await applyEnrollmentStatusAction(before.student_id, id, { action: 'absent', expectedPlan: fresh.preview.fingerprint })).profile.enrollments[0].statusGroup1Code, 'A');
            const resumed = await previewEnrollmentStatusAction(before.student_id, id, { action: 'resume', resumeDate: '2027-03-15' });
            assert.equal(resumed.preview.statusCode, 'R'); assert.equal(resumed.preview.halfMonth, true);
            const result = await applyEnrollmentStatusAction(before.student_id, id, { action: 'resume', resumeDate: '2027-03-15', expectedPlan: resumed.preview.fingerprint });
            assert.equal(result.profile.enrollments[0].statusGroup1Code, 'R');
            assert.deepEqual((await database.query('SELECT en_start_date FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].en_start_date, before.en_start_date);
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
        await t.test('DO append waits for processing to commit and refuses to alter the processed order', async sub => {
            const order = await createDeliveryOrder('ws', { doNo: 'isolated-parent-lock', outDate: '2026-10-30', items: [{ masterId: ws.worksheet_master_id, quantity: 2 }] });
            const blocker = await database.connect();
            let attempted;
            const lockAttempted = new Promise(resolve => { attempted = resolve; });
            sub.mock.method(productionPool, 'connect', async () => {
                const connection = await database.connect();
                return { release: () => connection.release(), query(sql, params) {
                    const result = connection.query(sql, params);
                    if (sql.includes('stock_do WHERE do_no = $1')) attempted();
                    return result;
                } };
            });
            let append;
            try {
                await blocker.query('BEGIN');
                await blocker.query('SELECT stock_do_id FROM kumon.stock_do WHERE stock_do_id=$1 FOR UPDATE', [order.doId]);
                append = createDeliveryOrder('ws', { doNo: 'isolated-parent-lock', outDate: '2026-10-30', items: [{ masterId: ws.worksheet_master_id, quantity: 3 }] });
                // Attach a handler immediately; the result is asserted after releasing the blocker.
                append.catch(() => {});
                await lockAttempted;
                const deadline = Date.now() + 3000;
                let waiting = false;
                while (Date.now() < deadline) {
                    const result = await database.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
                        AND pid<>pg_backend_pid() AND wait_event_type='Lock' AND query LIKE '%stock_do WHERE do_no = $1%'`);
                    if (result.rows.length) { waiting = true; break; }
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
                assert.equal(waiting, true, 'Append must wait for the parent lock instead of reading pending state');
                await blocker.query('UPDATE kumon.stock_do SET is_stock_processed=TRUE WHERE stock_do_id=$1', [order.doId]);
                await blocker.query('COMMIT');
            } finally {
                await blocker.query('ROLLBACK'); blocker.release();
                if (append) await Promise.allSettled([append]);
            }
            await assert.rejects(append, { statusCode: 409 });
            assert.equal((await database.query('SELECT quantity FROM kumon.stock_receive WHERE stock_do_id=$1', [order.doId])).rows[0].quantity, 2);
            const pending = await createDeliveryOrder('ws', { doNo: 'isolated-append-first', outDate: '2026-10-30', items: [{ masterId: ws.worksheet_master_id, quantity: 2 }] });
            await createDeliveryOrder('ws', { doNo: 'isolated-append-first', outDate: '2026-10-30', items: [{ masterId: ws.worksheet_master_id, quantity: 3 }] });
            const before = (await database.query('SELECT quantity FROM kumon.stock WHERE stock_type_id=1 AND master_id=$1', [ws.worksheet_master_id])).rows[0]?.quantity || 0;
            await processDeliveryOrder(pending.doId);
            assert.equal((await database.query('SELECT quantity FROM kumon.stock WHERE stock_type_id=1 AND master_id=$1', [ws.worksheet_master_id])).rows[0].quantity, before + 5);
        });
        await t.test('Concurrent submissions of one AT form advance only its displayed level; historical AT editing remains valid', async () => {
            const master = (await database.query(`SELECT am.at_master_id, lm.level_master_id, lm.next_level_master_id
                FROM kumon.at_master am JOIN kumon.level_master lm ON lm.level_master_id=am.level_master_id
                JOIN kumon.at_master next_at ON next_at.level_master_id=lm.next_level_master_id AND next_at.subject_id=am.subject_id
                WHERE am.subject_id=1 ORDER BY lm.level_master_id LIMIT 1`)).rows[0];
            assert.ok(master);
            const id = await student('AT stale form');
            await database.query('UPDATE kumon.enrollment SET current_level_master_id=$2 WHERE enrollment_id=$1', [id, master.level_master_id]);
            const payload = { enrollmentId: id, atDate: '2026-10-30', score: 1, usedTime: 1, atGroup: 1, isPass: true,
                expectedAtMasterId: master.at_master_id, expectedLevelMasterId: master.level_master_id };
            const results = await Promise.allSettled([saveAtCompletion(payload), saveAtCompletion(payload)]);
            assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
            assert.equal(results.find(row => row.status === 'rejected').reason.statusCode, 409);
            assert.equal((await database.query('SELECT current_level_master_id FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].current_level_master_id, master.next_level_master_id);
            const attempts = (await database.query('SELECT at_used_id,at_master_id FROM kumon.at_used WHERE enrollment_id=$1', [id])).rows;
            assert.equal(attempts.length, 1); assert.equal(attempts[0].at_master_id, master.at_master_id);
            await saveAtCompletion({ ...payload, atUsedId: attempts[0].at_used_id, score: 2 });
            assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.at_used WHERE enrollment_id=$1', [id])).rows[0].n, 1);
        });
        await t.test('Passing AT starts the new level at packet 1 instead of the original enrollment packet', async () => {
            const master = (await database.query(`SELECT am.at_master_id,lm.level_master_id,lm.next_level_master_id,wm.worksheet_master_id
                FROM kumon.at_master am JOIN kumon.level_master lm ON lm.level_master_id=am.level_master_id
                JOIN kumon.worksheet_master wm ON wm.level_master_id=lm.level_master_id AND wm.worksheet_no=101
                WHERE am.subject_id=1 AND lm.next_level_master_id IS NOT NULL ORDER BY lm.level_master_id LIMIT 1`)).rows[0];
            const id = await student('Pass begins packet one');
            await database.query('UPDATE kumon.enrollment SET current_level_master_id=$2,starting_worksheet_master_id=$3 WHERE enrollment_id=$1', [id, master.level_master_id, master.worksheet_master_id]);
            assert.equal((await getEnrollmentContext(id, 30)).defaults.mainWorksheetNo, 101);
            const payload = { enrollmentId: id, atDate: '2026-10-30', score: 1, usedTime: 1, atGroup: 1, isPass: false,
                expectedAtMasterId: master.at_master_id, expectedLevelMasterId: master.level_master_id };
            const failed = await saveAtCompletion(payload);
            assert.equal((await getEnrollmentContext(id, 30)).defaults.mainWorksheetNo, 101);
            await saveAtCompletion({ ...payload, atUsedId: failed.atUsedId, isPass: true });
            const advanced = await getEnrollmentContext(id, 30);
            assert.equal(advanced.enrollment.currentLevelMasterId, master.next_level_master_id);
            assert.equal(advanced.defaults.mainWorksheetNo, 1);
            assert.equal(advanced.enrollment.startingWorksheetMasterId, master.worksheet_master_id);
            await saveWorksheetEntries({ enrollmentId: id, receiveDate: '2026-10-31', patternCode: 'daily10', mainWorksheetNos: [31] });
            assert.equal((await getEnrollmentContext(id, 30)).defaults.mainWorksheetNo, 31);
            await saveAtCompletion({ ...payload, atUsedId: failed.atUsedId, isPass: true, score: 2 });
            assert.equal((await getEnrollmentContext(id, 30)).defaults.mainWorksheetNo, 31);
        });
        await t.test('WS rechecks context after a real lock wait and rolls back both new and legacy requests', async sub => {
            const next = (await database.query('SELECT next_level_master_id FROM kumon.level_master WHERE level_master_id=$1', [ws.level_master_id])).rows[0].next_level_master_id;
            assert.ok(next);
            for (const legacy of [false, true]) {
                const id = await student(`WS stale ${legacy}`), blocker = await database.connect();
                let reached;
                const lockAttempted = new Promise(resolve => { reached = resolve; });
                sub.mock.method(productionPool, 'connect', async () => {
                    const connection = await database.connect();
                    return { release: () => connection.release(), query(sql, params) {
                        const result = connection.query(sql, params);
                        if (sql.startsWith('SELECT enrollment_id FROM kumon.enrollment')) reached();
                        return result;
                    } };
                });
                let save;
                try {
                    await blocker.query('BEGIN');
                    await blocker.query('SELECT enrollment_id FROM kumon.enrollment WHERE enrollment_id=$1 FOR UPDATE', [id]);
                    save = saveWorksheetEntries({ enrollmentId: id, receiveDate: '2026-10-30', patternCode: 'daily10', mainWorksheetNos: [ws.worksheet_no],
                        ...(legacy ? {} : { expectedMainLevelMasterId: ws.level_master_id, expectedZunLevelMasterId: null }) });
                    save.catch(() => {});
                    await lockAttempted;
                    await blocker.query('UPDATE kumon.enrollment SET current_level_master_id=$2 WHERE enrollment_id=$1', [id, next]);
                    await blocker.query('COMMIT');
                } finally {
                    await blocker.query('ROLLBACK'); blocker.release();
                    if (save) await Promise.allSettled([save]);
                }
                await assert.rejects(save, { statusCode: 409 });
                assert.equal((await database.query('SELECT COUNT(*)::int AS n FROM kumon.worksheet_used WHERE enrollment_id=$1', [id])).rows[0].n, 0);
            }
        });
        await t.test('Digital KC final packets enable main/Zun completion without deducting physical stock', async () => {
            const main = (await database.query(`SELECT lm.level_master_id,wm.worksheet_master_id FROM kumon.level_master lm
                JOIN kumon.worksheet_master wm ON wm.level_master_id=lm.level_master_id AND wm.worksheet_no=191
                WHERE lm.subject_id=1 AND lm.level_code='6A'`)).rows[0];
            const zun = (await database.query(`SELECT lm.level_master_id,wm.worksheet_master_id FROM kumon.level_master lm
                JOIN kumon.worksheet_master wm ON wm.level_master_id=lm.level_master_id AND wm.worksheet_no=91 WHERE lm.level_code='ZI'`)).rows[0];
            assert.ok(main); assert.ok(zun);
            const id = await student('KC completion');
            await database.query('UPDATE kumon.enrollment SET current_level_master_id=$2,current_zun_level_master_id=$3,is_kumon_connect=TRUE WHERE enrollment_id=$1', [id, main.level_master_id, zun.level_master_id]);
            await assert.rejects(completeWorksheetLevelWithoutAt({ enrollmentId: id }), { statusCode: 400 });
            const result = await saveWorksheetEntries({ enrollmentId: id, receiveDate: '2026-10-29', patternCode: 'daily10', mainWorksheetNos: [191], zunWorksheetNos: [91],
                expectedMainLevelMasterId: main.level_master_id, expectedZunLevelMasterId: zun.level_master_id });
            assert.equal(result.completionState.freeLevelCompletion.canComplete, true);
            assert.equal(result.completionState.zunCompletion.canComplete, true);
            assert.equal(result.records.every(row => row.cpws === false), true);
            const before = (await database.query('SELECT stock_type_id,master_id,quantity FROM kumon.stock ORDER BY stock_type_id,master_id')).rows;
            await processPendingDates('ws', ['2026-10-29']);
            assert.deepEqual((await database.query('SELECT stock_type_id,master_id,quantity FROM kumon.stock ORDER BY stock_type_id,master_id')).rows, before);
            await completeZunLevel({ enrollmentId: id, expectedZunLevelMasterId: zun.level_master_id });
            await completeWorksheetLevelWithoutAt({ enrollmentId: id, expectedMainLevelMasterId: main.level_master_id });
            assert.notEqual((await database.query('SELECT current_level_master_id FROM kumon.enrollment WHERE enrollment_id=$1', [id])).rows[0].current_level_master_id, main.level_master_id);
            const physical = await student('Physical continuation');
            await database.query('UPDATE kumon.enrollment SET current_level_master_id=$2 WHERE enrollment_id=$1', [physical, main.level_master_id]);
            await database.query(`INSERT INTO kumon.worksheet_used(enrollment_id,worksheet_master_id,actual_worksheet_no,worksheet_date,worksheet_month,worksheet_year,cpws,is_stock_processed)
                VALUES($1,$2,191,'2026-10-28',10,2026,FALSE,FALSE)`, [physical, main.worksheet_master_id]);
            await assert.rejects(completeWorksheetLevelWithoutAt({ enrollmentId: physical }), { statusCode: 400 });
            const atLevel = (await database.query('SELECT level_master_id FROM kumon.at_master WHERE subject_id=1 ORDER BY level_master_id LIMIT 1')).rows[0].level_master_id;
            const kcAt = await student('KC AT button');
            await database.query('UPDATE kumon.enrollment SET current_level_master_id=$2,is_kumon_connect=TRUE WHERE enrollment_id=$1', [kcAt, atLevel]);
            const digitalAt = await saveWorksheetEntries({ enrollmentId: kcAt, receiveDate: '2026-10-27', patternCode: 'daily10', mainWorksheetNos: [191],
                expectedMainLevelMasterId: atLevel, expectedZunLevelMasterId: null });
            assert.equal(digitalAt.completionState.atCompletion.canComplete, true);
            assert.equal(digitalAt.completionState.atCompletion.bypassWorksheet191, true);
            assert.equal(digitalAt.worksheetProgress.main.percent, 0);
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
    } catch (error) {
        primaryError = error;
        throw error;
    } finally {
        // Both shutdown and cleanup are restricted to the uniquely generated test directory.
        assert.ok(path.resolve(root).startsWith(`${path.resolve(os.tmpdir())}${path.sep}kumondb-isolated-pg-`));
        const cleanupErrors = [];
        try { await database?.end(); } catch (error) { cleanupErrors.push(error); }
        let canRemove = !startAttempted;
        if (startAttempted) {
            try {
                await run(pgctl, ['-D', data, '-m', 'fast', '-w', 'stop'], { env: environment, windowsHide: true, timeout: 60000 });
                canRemove = true;
            } catch (error) { cleanupErrors.push(error); }
        }
        if (canRemove) {
            try { await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); }
            catch (error) { cleanupErrors.push(error); }
        }
        if (cleanupErrors.length) {
            if (!primaryError) throw new AggregateError(cleanupErrors, 'Disposable PostgreSQL cleanup failed');
            for (const error of cleanupErrors) t.diagnostic(`Fixture cleanup: ${error.message}`);
        }
    }
});
