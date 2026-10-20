import assert from "node:assert/strict";
import { test } from "node:test";
import { createKsisMatchingPreview, proposeKsisMatches, saveKsisMatchingPreview } from "../services/ksisMatchingService.js";

const kumonId = "7642650000001";
const student = (studentId = 1, extras = {}) => ({ studentId, firstName: "ตัวอย่าง", lastName: "ทดสอบ", birthDate: "2020-01-01",
    enrollments: [{ id: studentId * 10, subject: "ME", kumonId: null }, { id: studentId * 10 + 1, subject: "EFL", kumonId: null }], ...extras });
const source = (extras = {}) => ({ fullName: "ตัวอย่าง ทดสอบ", birthDate: "2020-01-01", kumonId, ...extras });

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
