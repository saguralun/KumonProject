import assert from "node:assert/strict";
import { test } from "node:test";
import { subjectReportRows, reportPage, splitReportLevel, reportDate, renderReportTable } from "../public/js/reportLayout.js";

const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const record = (ID, Status1, IDGrade, first = "ก", extra = {}) => ({ ID, Subject: "ME", Status1, IDGrade, "ชื่อจริง": first, ...extra });

test("Report B sorts status groups, then master grade, then Thai name without changing source", () => {
  const rows = [record(1, "N", 1), record(2, "C", 1, "ข"), record(3, "OT", 6), record(4, "A", 5),
    record(5, "C", 1, "ก"), record(6, "R", 2), record(7, "EO", 1, "ข"), record(8, "IT", 1, "ค"),
    record(9, "CP", 1), record(10, "C", ""), record(11, "C", 1, "ก", { Subject: "EFL" })];
  assert.deepEqual(subjectReportRows(rows, "ME").map((row) => row.ID), [4, 3, 5, 2, 10, 1, 7, 8, 6, 9]);
  assert.equal(rows[0].ID, 1);
  assert.equal(subjectReportRows(rows, "TRP").length, 0);
});

test("Report B pages count people rather than their test/detail rows", () => {
  const rows = Array.from({ length: 41 }, (_, ID) => record(ID, "C", 1));
  assert.equal(reportPage(rows, 1).rows.length, 20);
  assert.equal(reportPage(rows, 2).rows[0].ID, 20);
  assert.equal(reportPage(rows, 3).rows.length, 1);
  assert.equal(reportPage(rows, 9).page, 3);
  assert.equal(reportPage([], 0).pages, 1);
});

test("Report B level parts handle number-prefixed and Roman levels", () => {
  for (const [value, level, no] of [["6A191", "6A", "191"], ["III200", "III", "200"], ["A60", "A", "60"], ["", "", ""]]) {
    assert.deepEqual(splitReportLevel(value), [level, no]);
  }
  assert.equal(reportDate("03/09/2026"), "3-Sep-2026");
  assert.equal(reportDate(""), "");
});

test("Report B renders all tests, six CDs, both Zun totals, zero score and escaped names", () => {
  const row = record(1, "C", 1, '<script>bad</script>', { TestType: "AT", Score: 0, Time: 28, TestType2: "DT", LevelTest2: "III",
    CD6: "A", Level6: 3, UsedZI: 2, UsedZII: 4 });
  const html = renderReportTable([row], escape);
  assert.equal((html.match(/data-enrollment-id=/g) || []).length, 1);
  assert.ok(html.includes("CD A 3"));
  assert.ok(html.includes("(Lvl ZI # Used 2)"));
  assert.ok(html.includes("(Lvl ZII # Used 4)"));
  assert.ok(html.includes(">0</div>"));
  assert.ok(!html.includes("<script>"));
});
