import assert from "node:assert/strict";
import { test } from "node:test";
import pool from "../config/db.js";
import { returnStudentCd } from "../services/studentService.js";
import { requireStaff } from "../middleware/auth.js";

function mockCdClient(t, cd) {
    let existing = cd;
    let stock = 5;
    const calls = [];
    const client = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (sql.includes("FOR UPDATE OF used")) {
                return { rows: params[1] === 60 && existing ? [existing] : [] };
            }
            if (sql.includes("SELECT stock_type_id")) return { rows: [{ stock_type_id: 2 }] };
            if (sql.includes("INSERT INTO kumon.stock")) stock++;
            if (sql.includes("DELETE FROM kumon.cd_used")) existing = null;
            return { rows: [], rowCount: 1 };
        },
        release() { calls.push({ sql: "RELEASE" }); }
    };
    t.mock.method(pool, "connect", async () => client);
    return { calls, get stock() { return stock; } };
}

test("returning a processed physical CD restores one stock unit and cannot be repeated", async (t) => {
    const db = mockCdClient(t, { cd_used_id: 1, cd_master_id: 8, cpcd: true, is_stock_processed: true });
    assert.deepEqual(await returnStudentCd(60, 1), { cdUsedId: 1, stockReturned: true });
    assert.equal(db.stock, 6);
    assert.deepEqual(db.calls.find((call) => call.sql.includes("INSERT INTO kumon.stock")).params, [2, 8]);
    await assert.rejects(returnStudentCd(60, 1), { statusCode: 404 });
    assert.equal(db.stock, 6);
    assert.ok(db.calls.some((call) => call.sql === "ROLLBACK"));
});

test("returning an unprocessed CD cancels its pending stock cut without adding stock", async (t) => {
    const db = mockCdClient(t, { cd_used_id: 1, cd_master_id: 8, cpcd: true, is_stock_processed: false });
    assert.equal((await returnStudentCd(60, 1)).stockReturned, false);
    assert.equal(db.stock, 5);
    assert.ok(db.calls.some((call) => call.sql.includes("DELETE FROM kumon.cd_used")));
});

test("a CD belonging to another student cannot be returned", async (t) => {
    const db = mockCdClient(t, { cd_used_id: 1, cd_master_id: 8, cpcd: true, is_stock_processed: true });
    await assert.rejects(returnStudentCd(61, 1), { statusCode: 404 });
    assert.equal(db.stock, 5);
    assert.ok(!db.calls.some((call) => call.sql.includes("DELETE FROM")));
});

test("no-physical-CD records cannot restore stock", async (t) => {
    const db = mockCdClient(t, { cd_used_id: 1, cd_master_id: 8, cpcd: false, is_stock_processed: true });
    await assert.rejects(returnStudentCd(60, 1), { statusCode: 409 });
    assert.equal(db.stock, 5);
});

test("CD return permission allows only Admin and Instructor", () => {
    for (const role of ["admin", "instructor", "staff", "guest", "custom", null]) {
        let allowed = false;
        let status;
        const res = { status(code) { status = code; return this; }, json() {} };
        requireStaff({ session: role ? { user: { role } } : {} }, res, () => { allowed = true; });
        assert.equal(allowed, ["admin", "instructor"].includes(role));
        if (!allowed) assert.equal(status, role ? 403 : 401);
    }
});
