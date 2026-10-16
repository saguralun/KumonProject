import assert from "node:assert/strict";
import { test } from "node:test";
import { buildWorksheetRow } from "../migration/migrationWorksheet.js";

function buildRow(levelWS, overrides = {}) {
    const issues = {
        errors: { required: new Map(), date: new Map(), number: new Map() },
        info: {
            olderThanRetention: new Map(), missingEnrollment: new Map(),
            missingMaster: new Map(), zeroWorksheet: new Map(),
            booleanDefaults: new Map(), invalidBoolean: new Map()
        }
    };
    const masters = {
        enrollmentIds: new Set([60]),
        subjectsByCode: new Map([["me", { subject_id: 1, subject_code: "ME" }]]),
        levelCodesBySubjectId: new Map([[1, ["A"]]]),
        levelsBySubjectAndCode: new Map([["1|a", { level_master_id: 1, level_code: "A" }]]),
        worksheetsByLevelNo: new Map([["1|21", { worksheet_master_id: 3 }]])
    };
    const row = buildWorksheetRow({
        IDAdd: "1", ID: "60", Subject: "ME", Level: "A", LevelWS: levelWS,
        DateWS: "16/10/2026", MonthWS: "10", YearWS: "2026", CPWS: "1", CtrStock: "0",
        ...overrides
    }, 1, masters, issues, "2023-10-16");
    return { row, issues };
}

test("zero worksheet is skipped and recorded without a blocking number error", () => {
    const { row, issues } = buildRow(" 0 ");
    assert.equal(row.import_action, "SKIP");
    assert.equal(row.errors.length, 0);
    assert.equal(issues.info.zeroWorksheet.size, 1);
    assert.equal(row.worksheet_master_id, null);
});

test("valid worksheet is still inserted", () => {
    const { row } = buildRow("21");
    assert.equal(row.import_action, "INSERT");
    assert.equal(row.errors.length, 0);
    assert.equal(row.worksheet_master_id, 3);
    assert.equal(row.actual_worksheet_no, 21);
});

test("invalid worksheet values other than zero still block import", () => {
    for (const value of ["", "-1", "abc", "1.5"]) {
        const { row } = buildRow(value);
        assert.ok(row.errors.length > 0, `Expected error for ${JSON.stringify(value)}`);
    }
});

test("zero worksheet does not suppress other validation errors", () => {
    const { row } = buildRow("0", { MonthWS: "13" });
    assert.equal(row.import_action, "SKIP");
    assert.ok(row.errors.length > 0);
});
