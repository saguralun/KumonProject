import assert from "node:assert/strict";
import { test } from "node:test";
import { planKsisReportDraft, ksisContextPeriod } from "../services/ksisReportDraft.js";

const record = (extra = {}) => ({ ID: 1, Subject: "ME", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ",
    "วันเกิด": "01/01/2020", CurrentLevel: "C90", WksUsed: 8, Status1: "C", UsedZI: 2, UsedZII: 3, ZIWorksheetNo: 30, ZIIWorksheetNo: 50, ...extra });
const field = (value, options = null) => ({ value, options, writable: true });
const document = () => ({ context: "ชื่อศูนย์ TEST ประจำเดือน Oct - 2026", page: 1, modalOpen: false,
    rows: [{ key: "student-me", kumonId: "7642650000001", subject: "ME", birthDate: "01/01/2020", dirty: false,
        level: field("C", ["C", "D"]), worksheet: field("80", ["80", "90", "100"]), used: field("0"), status: field("C", ["C", "A", "R", "OT"]) }] });
const period = { month: 10, year: 2026 };

test("All-subject draft plans ME, EFL and TRP separately for the same student", () => {
    const doc = document();
    doc.rows = ["ME", "EFL", "TRP"].map((subject) => ({ ...doc.rows[0], subject, key: `student-${subject}` }));
    const records = ["TRP", "EFL", "ME", "OTHER"].map((Subject, index) => record({ ID: index + 1, Subject, WksUsed: index + 4 }));
    const rows = planKsisReportDraft(records, doc, period, "ALL");
    assert.deepEqual(rows.map((row) => row.subject), ["ME", "EFL", "TRP"]);
    assert.deepEqual(rows.map((row) => row.desired.used), [6, 5, 4]);
    assert.ok(rows.every((row) => row.ready));
    for (const subject of ["ME", "EFL", "TRP"]) {
        assert.deepEqual(planKsisReportDraft(records, doc, period, subject).map((row) => row.subject), [subject]);
    }
    assert.throws(() => planKsisReportDraft(records, doc, period, "OTHER"), { statusCode: 400 });
});

test("All-subject preview keeps invalid and off-page subjects isolated", () => {
    const doc = document();
    doc.rows.push({ ...doc.rows[0], subject: "EFL", key: "student-efl" });
    const rows = planKsisReportDraft([record(), record({ ID: 2, Subject: "EFL", CurrentLevel: "C85" }), record({ ID: 3, Subject: "TRP" })], doc, period, "ALL");
    assert.equal(rows[0].ready, true);
    assert.equal(rows[1].ready, false);
    assert.match(rows[2].reason, /ไม่อยู่ในหน้า/);
});

test("Zun ends at page 100 from packet 91 and never allows a main-level page 190", () => {
    assert.equal(planKsisReportDraft([record({ ZIIWorksheetNo: 100 })], document(), period, "ME")[0].ready, true);
    for (const page of [0, -10, 95, 110, 190, null]) {
        assert.match(planKsisReportDraft([record({ ZIIWorksheetNo: page })], document(), period, "ME")[0].reason, /Zun Zun/);
    }
});

test("KSIS draft plans main fields, separate ZI/ZII and AT, excluding DT", () => {
    const [row] = planKsisReportDraft([record({ TestType: "DT", Score: 99, TestType1: "AT", DateTest1: "01/10/2569", LevelTest1: "C", Time1: 120, Score1: 0, Group1: 5 })], document(), period, "ME");
    assert.equal(row.ready, true);
    assert.equal(row.desired.worksheet, 90);
    assert.deepEqual(row.desired.zun, [{ level: "ZI", used: 2, worksheet: 30 }, { level: "ZII", used: 3, worksheet: 50 }]);
    assert.deepEqual(row.desired.at, [{ date: "2026-10-01", level: "C", time: 120, score: 0, group: 5, passed: true }]);
    assert.deepEqual(ksisContextPeriod(document().context), period);
});

test("KSIS draft validates every AT slot and rejects duplicates, but does not cap time", () => {
    const at = { TestType: "AT", DateTest: "01/10/2026", LevelTest: "C", Time: 150, Score: 71, Group: 4 };
    assert.equal(planKsisReportDraft([record(at)], document(), period, "ME")[0].ready, true);
    for (const extra of [{ Time: "" }, { Score: null }, { Group: 6 }, { DateTest: "31/02/2026" }, { LevelTest: "" }]) {
        assert.match(planKsisReportDraft([record({ ...at, ...extra })], document(), period, "ME")[0].reason, /ข้อมูล AT/);
    }
    const duplicate = Object.fromEntries(Object.entries(at).map(([key, value]) => [`${key}2`, value]));
    assert.match(planKsisReportDraft([record({ ...at, ...duplicate })], document(), period, "ME")[0].reason, /AT ซ้ำ/);
});

test("KSIS draft never rounds an invalid current WS and does not guess unsupported statuses", () => {
    assert.equal(planKsisReportDraft([record({ CurrentLevel: "C85" })], document(), period, "ME")[0].ready, false);
    assert.equal(planKsisReportDraft([record({ Status1: "N" })], document(), period, "ME")[0].ready, false);
});

test("KSIS draft blocks wrong periods and unsaved edits before any fill", () => {
    assert.throws(() => planKsisReportDraft([record()], document(), { month: 9, year: 2026 }, "ME"), { statusCode: 409 });
    const dirty = document(); dirty.rows[0].dirty = true;
    assert.throws(() => planKsisReportDraft([record()], dirty, period, "ME"), { statusCode: 409 });
});

test("KSIS draft isolates missing IDs, duplicate IDs, wrong DOB and other pages", () => {
    assert.equal(planKsisReportDraft([record({ "รหัสคุมอง": "" })], document(), period, "ME")[0].ready, false);
    assert.ok(planKsisReportDraft([record(), record({ ID: 2 })], document(), period, "ME").every((row) => !row.ready));
    assert.equal(planKsisReportDraft([record({ "วันเกิด": "01/01/2021" })], document(), period, "ME")[0].ready, false);
    assert.match(planKsisReportDraft([record({ "รหัสคุมอง": "7642650000002" })], document(), period, "ME")[0].reason, /ไม่อยู่ในหน้า/);
});
