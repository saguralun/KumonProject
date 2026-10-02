import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeStudentsByLevel } from "../services/reportService.js";
import { buildFlatWorkbook } from "../services/excelExportService.js";

const levels = [
    { subject_code: "ME", level_code: "4A" },
    { subject_code: "ME", level_code: "J" },
    { subject_code: "EFL", level_code: "J" },
    { subject_code: "TRP", level_code: "III" }
];

test("level summary counts students once per subject and keeps master level order", () => {
    const subjects = summarizeStudentsByLevel([
        { ID: 1, StudentId: 60, Subject: "ME", EnrollmentLevelCode: "4A" },
        { ID: 2, StudentId: 60, Subject: "ME", EnrollmentLevelCode: "J" },
        { ID: 2, StudentId: 60, Subject: "ME", EnrollmentLevelCode: "J" },
        { ID: 3, StudentId: 60, Subject: "EFL", EnrollmentLevelCode: "J" },
        { ID: 4, StudentId: 61, Subject: "ME", EnrollmentLevelCode: "J" },
        { ID: 5, StudentId: 62, Subject: "TRP", EnrollmentLevelCode: "III" },
        { ID: 6, StudentId: 63, Subject: "TRP", EnrollmentLevelCode: "" }
    ].map((record) => ({ ...record, EnrollmentStatusCode: "C" })), levels);
    assert.deepEqual(subjects[0], { subject: "ME", rows: [{ level: "4A", count: 0 }, { level: "J", count: 2 }], total: 2 });
    assert.equal(subjects[1].total, 1);
    assert.deepEqual(subjects[2].rows, [{ level: "III", count: 1 }, { level: "ไม่มีข้อมูลเลเวล", count: 1 }]);
    for (const subject of subjects) {
        assert.equal(subject.rows.reduce((sum, row) => sum + row.count, 0), subject.total);
    }
});

test("level summary always uses enrollment current level even when period WS differs", () => {
    const subjects = summarizeStudentsByLevel([
        { ID: 1, StudentId: 60, Subject: "ME", CurrentLevelCode: "", EnrollmentLevelCode: "4A" },
        { ID: 2, StudentId: 61, Subject: "ME", CurrentLevelCode: "J", EnrollmentLevelCode: "4A" },
        { ID: 3, StudentId: 62, Subject: "EFL", CurrentLevelCode: "", EnrollmentLevelCode: "J" },
        { ID: 4, StudentId: 63, Subject: "TRP", CurrentLevelCode: "", EnrollmentLevelCode: "III" }
    ].map((record) => ({ ...record, EnrollmentStatusCode: "C" })), levels);
    assert.deepEqual(subjects[0].rows, [{ level: "4A", count: 2 }, { level: "J", count: 0 }]);
    assert.equal(subjects[1].rows[0].count, 1);
    assert.equal(subjects[2].rows[0].count, 1);
    assert.ok(subjects.every((subject) => !subject.rows.some((row) => row.level === "ไม่มีข้อมูลเลเวล")));
});

test("summary includes current active statuses and excludes absent, transfers and completers", () => {
    const statuses = ["N", "EO", "IT", "R", "C", "A", "OT", "CP", ""];
    const subjects = summarizeStudentsByLevel(statuses.map((status, index) => ({
        ID: index + 1, StudentId: index + 1, Subject: "ME",
        EnrollmentLevelCode: "J", EnrollmentStatusCode: status,
        Status1: status === "C" ? "A" : "C"
    })), levels);
    assert.equal(subjects[0].total, 5);
    assert.equal(subjects[0].rows.find((row) => row.level === "J").count, 5);
});

test("empty summary keeps all three subjects and zero-count master levels", async () => {
    const subjects = summarizeStudentsByLevel([], levels);
    assert.deepEqual(subjects.map((subject) => subject.subject), ["ME", "EFL", "TRP"]);
    assert.ok(subjects.every((subject) => subject.total === 0));
    const rows = subjects.flatMap((subject) => subject.rows.map((row) => [subject.subject, row.level, row.count]));
    const workbook = await buildFlatWorkbook({ sheetName: "นักเรียนตามเลเวล", columns: ["วิชา", "เลเวล", "คน"], rows });
    const buffer = await workbook.xlsx.writeBuffer();
    await workbook.xlsx.load(buffer);
    assert.equal(workbook.worksheets[0].getCell("B2").value, "4A");
    assert.equal(workbook.worksheets[0].getCell("C2").value, 0);
});
