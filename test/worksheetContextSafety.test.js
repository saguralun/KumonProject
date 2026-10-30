import assert from 'node:assert/strict';
import { test } from 'node:test';
import productionPool from '../config/db.js';
import { saveWorksheetEntries, saveAtCompletion, completeWorksheetLevelWithoutAt, completeZunLevel } from '../services/worksheetService.js';

// A missing mock must fail locally; this file can never fall through to .env's DB.
productionPool.query = () => assert.fail('Production pool.query is poisoned');
productionPool.connect = () => assert.fail('Production pool.connect is poisoned');

const wsPayload = { enrollmentId: 1, receiveDate: '2026-10-30', patternCode: 'daily10', mainWorksheetNos: [191], expectedMainLevelMasterId: 10, expectedZunLevelMasterId: null };
const atPayload = { enrollmentId: 1, atDate: '2026-10-30', score: 90, usedTime: 10, atGroup: 1, isPass: true, expectedLevelMasterId: 10, expectedAtMasterId: 110 };

function fixture(t, { kc = false, zun = null, changeAtLock, historical = null, atMaster = false } = {}) {
    const enrollment = { enrollment_id: 1, student_id: 1, subject_id: 1, subject_code: 'ME', status_code: 'C', current_level_master_id: 10,
        current_level_code: '6A', current_zun_level_master_id: zun, current_zun_level_code: zun ? 'ZI' : null, is_kumon_connect: kc };
    const worksheets = [], attempts = [], queries = [];
    let committed = 0, rolledBack = 0, held = 0;
    const readEnrollment = () => ({ rows: enrollment.status_code === 'C' ? [{ ...enrollment }] : [] });
    t.mock.method(productionPool, 'query', async (sql, p) => {
        assert.equal(held, 0, 'No extra pooled query while holding a transaction');
        if (sql.includes('FROM kumon.enrollment e')) return readEnrollment();
        if (sql.includes('FROM kumon.worksheet_master')) return { rows: [{ worksheet_master_id: p[0] * 1000 + 191, level_master_id: p[0], worksheet_no: 191 }] };
        assert.fail(`Unexpected pool query: ${sql}`);
    });
    t.mock.method(productionPool, 'connect', async () => {
        held++;
        return { release() { held--; }, async query(sql, p = []) {
            queries.push(sql);
            if (sql === 'COMMIT') { committed++; return { rows: [] }; }
            if (sql === 'ROLLBACK') { rolledBack++; return { rows: [] }; }
            if (sql.startsWith('SELECT enrollment_id FROM kumon.enrollment')) {
                changeAtLock?.(enrollment);
                return { rows: [{ enrollment_id: 1 }] };
            }
            if (sql.includes('FROM kumon.at_used at_used') && sql.includes('FOR UPDATE OF at_used')) return { rows: historical ? [{ ...historical, current_level_master_id: enrollment.current_level_master_id }] : [] };
            if (sql.includes('FROM kumon.enrollment e') && sql.includes('at_master.at_master_id')) return { rows: enrollment.status_code === 'C' ? [{ ...enrollment, at_master_id: enrollment.current_level_master_id + 100, max_score: 100, next_level_master_id: enrollment.current_level_master_id + 1 }] : [] };
            if (sql.includes('AS has_worksheet_191')) return { rows: [{ ...enrollment, next_level_master_id: 11, has_at_master: false,
                has_worksheet_191: worksheets.some(row => row.worksheet_master_id === 10191 && (row.cpws || kc)) }] };
            if (sql.includes('AS can_complete_zun_level') && sql.includes('FROM kumon.enrollment e')) return { rows: [{ ...enrollment, next_level_master_id: null,
                can_complete_zun_level: worksheets.some(row => row.zun && (row.cpws || kc)) }] };
            if (sql.includes('FROM kumon.enrollment e')) return readEnrollment();
            if (sql.includes('WITH inserted AS')) {
                for (let index = 0; index < p.length; index += 8) worksheets.push({ worksheet_used_id: worksheets.length + 1, enrollment_id: 1,
                    worksheet_master_id: p[index + 1], actual_worksheet_no: p[index + 2], worksheet_date: p[index + 3], cpws: p[index + 6] });
                return { rows: worksheets.slice(-p.length / 8) };
            }
            if (sql.includes('can_complete_ws_level')) return { rows: [{ current_level_code: enrollment.current_level_code, next_level_master_id: 11, at_master_id: atMaster ? 110 : null,
                can_complete_ws_level: worksheets.some(row => row.cpws || p[4]), can_complete_zun_level: false }] };
            if (sql.includes('INSERT INTO kumon.at_used')) { attempts.push({ at_master_id: p[1], score: p[3] }); return { rows: [{ at_used_id: attempts.length }] }; }
            if (sql.includes('UPDATE kumon.at_used')) { attempts.push({ edited: p[5] }); return { rows: [], rowCount: 1 }; }
            if (sql.includes('UPDATE kumon.enrollment')) {
                if (sql.includes('current_zun_level_master_id = $1')) enrollment.current_zun_level_master_id = p[0];
                else enrollment.current_level_master_id = p[0];
            }
            return { rows: [], rowCount: 1 };
        } };
    });
    return { enrollment, worksheets, attempts, queries, get committed() { return committed; }, get rolledBack() { return rolledBack; }, get held() { return held; } };
}

test('WS rejects stale main level and explicit no-Zun snapshots without inserting', async t => {
    const db = fixture(t);
    await assert.rejects(saveWorksheetEntries({ ...wsPayload, expectedMainLevelMasterId: 9 }), { statusCode: 409 });
    db.enrollment.current_zun_level_master_id = 20;
    await assert.rejects(saveWorksheetEntries(wsPayload), { statusCode: 409 });
    assert.equal(db.worksheets.length, 0);
});

test('WS revalidates main/Zun/KC/status changes after acquiring the enrollment lock, including legacy requests', async t => {
    for (const change of [row => { row.current_level_master_id = 11; }, row => { row.current_zun_level_master_id = 20; }, row => { row.is_kumon_connect = true; }, row => { row.status_code = 'A'; }]) {
        const db = fixture(t, { changeAtLock: change });
        const { expectedMainLevelMasterId, expectedZunLevelMasterId, ...legacy } = wsPayload;
        await assert.rejects(saveWorksheetEntries(legacy), { statusCode: 409 });
        assert.equal(db.worksheets.length, 0); assert.equal(db.rolledBack, 1); assert.equal(db.held, 0);
    }
});

test('WS accepts matching expected context and omitted fields for older clients', async t => {
    const db = fixture(t);
    await saveWorksheetEntries(wsPayload);
    const { expectedMainLevelMasterId, expectedZunLevelMasterId, ...legacy } = wsPayload;
    await saveWorksheetEntries(legacy);
    assert.equal(db.worksheets.length, 2); assert.equal(db.committed, 2);
});

test('Malformed expected context is rejected instead of treated as an omitted legacy field', async t => {
    const db = fixture(t);
    for (const expectedMainLevelMasterId of [null, false, 0, 1.5, 'bad']) {
        await assert.rejects(saveWorksheetEntries({ ...wsPayload, expectedMainLevelMasterId }), { statusCode: 400 });
    }
    assert.equal(db.worksheets.length, 0);
});

test('Retrying a passed AT form cannot create an attempt for or advance the next level', async t => {
    const db = fixture(t);
    await saveAtCompletion(atPayload);
    await assert.rejects(saveAtCompletion(atPayload), { statusCode: 409 });
    assert.equal(db.enrollment.current_level_master_id, 11);
    assert.deepEqual(db.attempts, [{ at_master_id: 110, score: 90 }]);
    assert.equal(db.committed, 1); assert.equal(db.rolledBack, 1);
});

test('AT checks the master independently of level and after waiting for the enrollment lock', async t => {
    const db = fixture(t, { changeAtLock: row => { row.current_level_master_id = 11; } });
    await assert.rejects(saveAtCompletion({ ...atPayload, expectedLevelMasterId: 11 }), { statusCode: 409 });
    assert.equal(db.attempts.length, 0);
});

test('Editing a historical AT checks its own master and level, preserving previous-level editing', async t => {
    const historical = { at_used_id: 77, at_master_id: 109, level_master_id: 9, next_level_master_id: 10, max_score: 100, is_pass: true };
    const db = fixture(t, { historical });
    await saveAtCompletion({ ...atPayload, atUsedId: 77, expectedAtMasterId: 109, expectedLevelMasterId: 9 });
    await assert.rejects(saveAtCompletion({ ...atPayload, atUsedId: 77 }), { statusCode: 409 });
    assert.deepEqual(db.attempts, [{ edited: 77 }]);
});

test('AT legacy callers without expected fields still save a valid current attempt', async t => {
    const db = fixture(t);
    const { expectedAtMasterId, expectedLevelMasterId, ...legacy } = atPayload;
    await saveAtCompletion(legacy);
    assert.equal(db.attempts.length, 1);
});

test('KC packet 191 enables and completes a no-AT level without consuming physical stock', async t => {
    const db = fixture(t, { kc: true });
    const result = await saveWorksheetEntries(wsPayload);
    assert.equal(db.worksheets[0].cpws, false);
    assert.equal(result.completionState.freeLevelCompletion.canComplete, true);
    await completeWorksheetLevelWithoutAt({ enrollmentId: 1, expectedMainLevelMasterId: 10 });
    assert.equal(db.enrollment.current_level_master_id, 11);
});

test('KC still requires the completion packet and non-KC continuation rows do not qualify', async t => {
    for (const kc of [true, false]) {
        const db = fixture(t, { kc });
        if (!kc) db.worksheets.push({ worksheet_master_id: 10191, cpws: false });
        await assert.rejects(completeWorksheetLevelWithoutAt({ enrollmentId: 1 }), { statusCode: 400 });
        assert.equal(db.enrollment.current_level_master_id, 10);
    }
});

test('Saving KC packet 191 preserves the AT button bypass while its physical progress graph remains empty', async t => {
    fixture(t, { kc: true, atMaster: true });
    const result = await saveWorksheetEntries(wsPayload);
    assert.equal(result.completionState.atCompletion.canComplete, true);
    assert.equal(result.completionState.atCompletion.hasWorksheet191, true);
    assert.equal(result.completionState.atCompletion.bypassWorksheet191, true);
    assert.equal(result.worksheetProgress.main.percent, 0);
});

test('KC Zun completion accepts its digital final packet; stale completion requests are rejected', async t => {
    const db = fixture(t, { kc: true, zun: 20 });
    db.worksheets.push({ zun: true, cpws: false });
    await assert.rejects(completeZunLevel({ enrollmentId: 1, expectedZunLevelMasterId: 19 }), { statusCode: 409 });
    await completeZunLevel({ enrollmentId: 1, expectedZunLevelMasterId: 20 });
    assert.equal(db.enrollment.current_zun_level_master_id, null);
    await assert.rejects(completeWorksheetLevelWithoutAt({ enrollmentId: 1, expectedMainLevelMasterId: 9 }), { statusCode: 409 });
});
