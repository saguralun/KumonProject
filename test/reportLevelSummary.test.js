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
        { ID: 1, StudentId: 60, Subject: "ME", CurrentLevelCode: "4A" },
        { ID: 2, StudentId: 60, Subject: "ME", CurrentLevelCode: "J" },
        { ID: 2, StudentId: 60, Subject: "ME", CurrentLevelCode: "J" },
        { ID: 3, StudentId: 60, Subject: "EFL", CurrentLevelCode: "J" },
        { ID: 4, StudentId: 61, Subject: "ME", CurrentLevelCode: "J" },
        { ID: 5, StudentId: 62, Subject: "TRP", CurrentLevelCode: "III" },
        { ID: 6, StudentId: 63, Subject: "TRP", CurrentLevelCode: "" }
    ], levels);
    assert.deepEqual(subjects[0], { subject: "ME", rows: [{ level: "4A", count: 0 }, { level: "J", count: 2 }], total: 2 });
    assert.equal(subjects[1].total, 1);
    assert.deepEqual(subjects[2].rows, [{ level: "III", count: 1 }, { level: "ไม่มีข้อมูลเลเวล", count: 1 }]);
    for (const subject of subjects) {
        assert.equal(subject.rows.reduce((sum, row) => sum + row.count, 0), subject.total);
    }
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
