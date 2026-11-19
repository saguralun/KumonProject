import assert from "node:assert/strict";
import { test } from "node:test";
import { createKsisMatchingPreview, proposeKsisMatches, saveKsisMatchingPreview } from "../services/ksisMatchingService.js";

const kumonId = "7642650000001";
const student = (studentId = 1, extras = {}) => ({ studentId, firstName: "ตัวอย่าง", lastName: "ทดสอบ", birthDate: "2020-01-01",
    enrollments: [{ id: studentId * 10, subject: "ME", kumonId: null }, { id: studentId * 10 + 1, subject: "EFL", kumonId: null }], ...extras });
const source = (extras = {}) => ({ fullName: "ตัวอย่าง ทดสอบ", birthDate: "2020-01-01", kumonId, ...extras });

test('Matching excludes trial-only children before grouping and keeps mixed and regular subjects', () => {
    const real = source({ subjects: [{ subject: 'ME', status: 'N' }] });
    const trial = source({ fullName: 'กรอกชื่อผิด', birthDate: '', subjects: [{ subject: 'EFL', status: ' T ' }] });
    assert.deepEqual(proposeKsisMatches([trial], [student()]), []);
    const rows = proposeKsisMatches([trial, real], [student()]);
    assert.equal(rows.length, 1); assert.equal(rows[0].status, 'exact');
    for (const status of ['N', 'EO', 'C', 'A']) {
        const mixed = source({ kumonId: '', subjects: [{ subject: 'ME', status: 'T' }, { subject: 'EFL', status }] });
        assert.equal(proposeKsisMatches([mixed], [student()])[0].status, 'missing_id');
    }
    assert.equal(proposeKsisMatches([source({ subjects: [] })], [student()])[0].status, 'exact');
});

function database(initial) {
    let students = structuredClone(initial);
    let backup;
    const calls = [];
    const client = { async query(sql, params) {
        calls.push(sql);
        if (sql.startsWith("SELECT s.student_id")) return { rows: structuredClone(students) };
        if (sql === "BEGIN") backup = structuredClone(students);
        if (sql === "ROLLBACK") students = backup;
        if (sql.startsWith("UPDATE kumon.enrollment")) {
            let rowCount = 0;
            for (const enrollment of students.find((row) => row.studentId === params[1]).enrollments) {
                if (enrollment.kumonId !== params[0]) { enrollment.kumonId = params[0]; rowCount++; }
            }
            return { rowCount };
        }
        return { rows: [], rowCount: 0 };
    }, release() {} };
    return { ...client, connect: async () => client, calls, get students() { return students; } };
}

test("KSIS matching normalizes whitespace but requires both full name and birth date for bulk exact", () => {
    const rows = proposeKsisMatches([source({ fullName: " ตัวอย่าง   ทดสอบ " })], [student()]);
    assert.equal(rows[0].status, "exact");
    assert.equal(rows[0].candidates.length, 1);
    assert.equal(proposeKsisMatches([source({ birthDate: "2021-01-01" })], [student()])[0].status, "review");
    assert.equal(proposeKsisMatches([source({ fullName: "ไม่ตรง ทดสอบ" })], [student()])[0].status, "unmatched");
});

test("KSIS matching isolates ambiguous names, invalid source data and existing code conflicts", () => {
    assert.equal(proposeKsisMatches([source()], [student(), student(2)])[0].status, "ambiguous");
    assert.equal(proposeKsisMatches([source({ birthDate: "" })], [student()])[0].status, "invalid");
    assert.equal(proposeKsisMatches([source(), source({ birthDate: "2021-01-01" })], [student()])[0].status, "invalid");
    const local = student(); local.enrollments[0].kumonId = "7642650000002";
    assert.equal(proposeKsisMatches([source()], [local])[0].status, "conflict");
    const other = student(2, { firstName: "อื่น" }); other.enrollments[0].kumonId = kumonId;
    assert.equal(proposeKsisMatches([source()], [student(), other])[0].status, "conflict");
    assert.ok(proposeKsisMatches([source(), source({ kumonId: "7642650000002" })], [student()]).every((row) => row.status === "ambiguous"));
});

test("KSIS duplicate rows collapse and already matched enrollments are not written again", () => {
    const local = student(); for (const enrollment of local.enrollments) enrollment.kumonId = kumonId;
    const rows = proposeKsisMatches([source(), source()], [local]);
    assert.equal(rows.length, 1); assert.equal(rows[0].status, "matched");
});

test("Missing 764 is not a conflict, but another student's legacy code still owns its full ID", () => {
    const local = student();
    local.enrollments[0].kumonId = kumonId.slice(3);
    assert.equal(proposeKsisMatches([source()], [local])[0].status, "exact");
    const other = student(2, { firstName: "อื่น" });
    other.enrollments[0].kumonId = kumonId.slice(3);
    assert.equal(proposeKsisMatches([source()], [student(), other])[0].status, "conflict");
});

test("Preview never writes; confirmation updates all enrollments atomically and consumes its token", async () => {
    const db = database([student()]);
    const preview = await createKsisMatchingPreview({ roster: { rows: [source()], pagesRead: 1 }, userId: 101 }, db);
    assert.ok(!db.calls.some((sql) => sql.startsWith("UPDATE")));
    const selections = [{ kumonId, studentId: 1 }];
    await assert.rejects(saveKsisMatchingPreview({ previewId: preview.previewId, selections, userId: 102 }, db), { statusCode: 409 });
    await assert.rejects(saveKsisMatchingPreview({ previewId: preview.previewId, selections: [{ kumonId, studentId: 999 }], userId: 101 }, db), { statusCode: 400 });
    const result = await saveKsisMatchingPreview({ previewId: preview.previewId, selections, userId: 101 }, db);
    assert.deepEqual(result, { studentsUpdated: 1, enrollmentsUpdated: 2 });
    assert.ok(db.students[0].enrollments.every((enrollment) => enrollment.kumonId === kumonId));
    assert.equal(db.students[0].studentId, 1);
    await assert.rejects(saveKsisMatchingPreview({ previewId: preview.previewId, selections, userId: 101 }, db), { statusCode: 409 });
});

test("Stale records and codes claimed after preview cause rollback without updates", async () => {
    for (const mutate of [
        (db) => { db.students[0].birthDate = "2021-01-01"; },
        (db) => { db.students[1].enrollments[0].kumonId = kumonId; }
    ]) {
        const db = database([student(), student(2, { firstName: "อื่น" })]);
        const preview = await createKsisMatchingPreview({ roster: { rows: [source()] }, userId: 103 }, db);
        mutate(db);
        await assert.rejects(saveKsisMatchingPreview({ previewId: preview.previewId, selections: [{ kumonId, studentId: 1 }], userId: 103 }, db), { statusCode: 409 });
        assert.ok(db.calls.includes("ROLLBACK"));
        assert.ok(!db.calls.some((sql) => sql.startsWith("UPDATE")));
    }
});

test("One local student cannot be assigned two KSIS codes in one confirmation", async () => {
    const db = database([student()]);
    const preview = await createKsisMatchingPreview({ roster: { rows: [source(), source({ kumonId: "7642650000002" })] }, userId: 104 }, db);
    await assert.rejects(saveKsisMatchingPreview({ previewId: preview.previewId, userId: 104,
        selections: [{ kumonId, studentId: 1 }, { kumonId: "7642650000002", studentId: 1 }] }, db), { statusCode: 409 });
    assert.ok(!db.calls.includes("BEGIN"));
});

test('ID-less new students stay separate by name and DOB while repeated subjects/pages collapse', () => {
    const students = [student(), student(2, { firstName: 'คนสอง' }), student(3, { birthDate: '2021-01-01' })];
    const roster = [source({ kumonId: '' }), source({ kumonId: '  ' }), source({ kumonId: '0' }), source({ kumonId: '-' }),
        source({ kumonId: null, fullName: 'คนสอง ทดสอบ' }), source({ kumonId: '', birthDate: '2021-01-01' })];
    const before = structuredClone({ roster, students });
    const rows = proposeKsisMatches(roster, students);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(row => row.status), ['missing_id', 'missing_id', 'missing_id']);
    assert.deepEqual(rows.map(row => row.candidates.map(c => c.studentId)), [[1], [2], [3]]);
    assert.ok(rows.every(row => row.kumonId === '' && row.candidates[0].sameBirthDate));
    assert.deepEqual({ roster, students }, before);
});

test('Missing IDs require exact name plus DOB and expose ambiguity without inventing a match', () => {
    const wrongDob = proposeKsisMatches([source({ kumonId: '', birthDate: '2021-01-01' })], [student()])[0];
    assert.equal(wrongDob.status, 'missing_id'); assert.deepEqual(wrongDob.candidates, []);
    const ambiguous = proposeKsisMatches([source({ kumonId: '' })], [student(), student(2)])[0];
    assert.equal(ambiguous.status, 'missing_id'); assert.equal(ambiguous.candidates.length, 2);
    assert.match(ambiguous.reason, /หลายคน/);
    const invalid = proposeKsisMatches([source({ kumonId: '', birthDate: '' }), source({ kumonId: '', fullName: '' })], [student()]);
    assert.equal(invalid.length, 2); assert.ok(invalid.every(row => row.status === 'invalid'));
    assert.equal(proposeKsisMatches([source({ kumonId: '123' })], [student()])[0].status, 'invalid');
});

test('Missing-ID previews never select, erase, generate or save a Kumon ID even with a forged confirmation', async () => {
    const local = student(); local.enrollments[0].kumonId = kumonId;
    const db = database([local]); const before = structuredClone(db.students);
    const preview = await createKsisMatchingPreview({ roster: { rows: [source({ kumonId: '' })] }, userId: 105 }, db);
    assert.equal(preview.rows[0].status, 'missing_id'); assert.equal(preview.rows[0].candidates[0].studentId, 1);
    assert.deepEqual(db.calls.length, 1);
    for (const id of ['', null, '   ']) {
        await assert.rejects(saveKsisMatchingPreview({ previewId: preview.previewId, selections: [{ kumonId: id, studentId: 1 }], userId: 105 }, db), { statusCode: 400 });
    }
    assert.ok(!db.calls.some(sql => sql === 'BEGIN' || sql.startsWith('UPDATE')));
    assert.deepEqual(db.students, before);
});

test('N/EO first-month identities become next-month ID proposals for the same student without automatic writes', async () => {
    for (const status of ['N', 'EO']) {
        const local = student();
        local.enrollments.forEach(enrollment => { enrollment.statusCode = status; });
        const db = database([local]); const before = structuredClone(db.students);
        const firstMonth = await createKsisMatchingPreview({ userId: 106,
            roster: { rows: [source({ kumonId: '' })], context: 'Nov 2026' } }, db);
        assert.equal(firstMonth.rows[0].status, 'missing_id');
        assert.equal(firstMonth.rows[0].candidates[0].studentId, local.studentId);
        assert.match(firstMonth.rows[0].reason, /ใช้จับคู่เพื่อกรอกข้อมูลได้/);
        const nextMonth = await createKsisMatchingPreview({ userId: 106,
            roster: { rows: [source()], context: 'Dec 2026' } }, db);
        assert.equal(nextMonth.rows[0].status, 'exact');
        assert.equal(nextMonth.rows[0].candidates[0].studentId, local.studentId);
        assert.deepEqual(nextMonth.rows[0].candidates[0].enrollments.map(e => e.id), local.enrollments.map(e => e.id));
        assert.deepEqual(db.students, before);
        assert.ok(db.calls.every(sql => sql.startsWith('SELECT')));
    }
});
