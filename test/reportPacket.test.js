import assert from "node:assert/strict";
import { test } from "node:test";
import pool from "../config/db.js";
import { buildMonthlyReport } from "../services/reportService.js";

test("Monthly current/previous WS use packet master +9, not the daily sheet number", async (t) => {
    t.mock.method(pool, "query", async (sql) => {
        if (sql.includes("SELECT bd.enrollment_id")) return { rows: [{ enrollment_id: 1 }] };
        if (sql.includes("e.kumon_student_id")) return { rows: [{ enrollment_id: 1, student_id: 10, first_name: "ตัวอย่าง", last_name: "ทดสอบ", subject_code: "ME", status1_code: "C" }] };
        if (sql.includes("AS wks_used")) return { rows: [{ enrollment_id: 1, wks_used: 8, used_zi: 2, used_zii: 3, zi_packet_no: 21, zii_packet_no: 41 }] };
        if (sql.includes("FULL OUTER JOIN current")) {
            assert.ok(sql.includes("wm.worksheet_no AS actual_worksheet_no"));
            assert.ok(!sql.includes("wu.actual_worksheet_no"));
            return { rows: [{ enrollment_id: 1, prev_level_code: "C", prev_worksheet_no: 71, current_level_code: "C", current_worksheet_no: 81 }] };
        }
        return { rows: [] };
    });
    const [record] = await buildMonthlyReport({ month: 9, year: 2026 });
    assert.equal(record.CurrentLevel, "C90");
    assert.equal(record.PrevLevel, "C80");
    assert.equal(record.WksUsed, 8);
    assert.equal(record.ZIWorksheetNo, 30);
    assert.equal(record.ZIIWorksheetNo, 50);
});

test("Zun packet 91 becomes page 100; invalid packets do not become fabricated progress", async (t) => {
    let packet = 91;
    t.mock.method(pool, "query", async (sql) => {
        if (sql.includes("SELECT bd.enrollment_id")) return { rows: [{ enrollment_id: 1 }] };
        if (sql.includes("e.kumon_student_id")) return { rows: [{ enrollment_id: 1, subject_code: "ME", status1_code: "C" }] };
        if (sql.includes("AS wks_used")) return { rows: [{ enrollment_id: 1, used_zi: 2, used_zii: 10, zi_packet_no: 1, zii_packet_no: packet }] };
        return { rows: [] };
    });
    const [record] = await buildMonthlyReport({ month: 9, year: 2026 });
    assert.equal(record.ZIWorksheetNo, 10);
    assert.equal(record.ZIIWorksheetNo, 100);
    assert.equal(record.UsedZII, 10);
    for (packet of [101, 181, 0, 90, null]) {
        const [invalid] = await buildMonthlyReport({ month: 9, year: 2026 });
        assert.equal(invalid.ZIIWorksheetNo, null);
        assert.equal(invalid.UsedZII, 10);
    }
});
