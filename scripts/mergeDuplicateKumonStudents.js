import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pool from "../config/db.js";
import { planStudentMerge } from "../services/studentMergePlan.js";

const apply = process.argv.includes("--apply");
const argument = process.argv.find((value) => value.startsWith("--pairs="))?.slice(8) || "";
const pairs = argument.split(",").map((part) => part.split(":").map(Number));
if (!pairs.length || pairs.some((pair) => pair.length !== 2 || pair.some((id) => !Number.isSafeInteger(id) || id < 1))
    || new Set(pairs.flat()).size !== pairs.length * 2) {
    console.error("ใช้ --pairs=keepId:removeId,keepId:removeId [--apply]");
    await pool.end(); process.exitCode = 1;
} else {
    const tables = ["student", "enrollment", "billing", "billing_detail", "enrollment_status", "worksheet_used", "cd_used", "at_used", "dt_used"];
    const key = { student: "student_id", enrollment: "enrollment_id", billing: "billing_id", billing_detail: "billing_detail_id", enrollment_status: "enrollment_status_id",
        worksheet_used: "worksheet_used_id", cd_used: "cd_used_id", at_used: "at_used_id", dt_used: "dt_used_id" };
    const ids = pairs.flat();
    const readSnapshot = async (client) => {
        const snapshot = {};
        for (const table of ["student", "enrollment", "billing"]) {
            snapshot[table] = (await client.query(`SELECT to_jsonb(t) AS row FROM kumon.${table} t WHERE student_id = ANY($1::int[]) ORDER BY ${key[table]}`, [ids])).rows.map((row) => row.row);
        }
        const enrollmentIds = snapshot.enrollment.map((row) => row.enrollment_id);
        const billingIds = snapshot.billing.map((row) => row.billing_id);
        for (const table of tables.slice(3)) {
            snapshot[table] = (await client.query(`SELECT to_jsonb(t) AS row FROM kumon.${table} t WHERE enrollment_id = ANY($1::int[])
                ${table === "billing_detail" ? "OR billing_id = ANY($2::int[])" : ""} ORDER BY ${key[table]}`, table === "billing_detail" ? [enrollmentIds, billingIds] : [enrollmentIds])).rows.map((row) => row.row);
        }
        return snapshot;
    };
    const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    const client = await pool.connect();
    try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
        await client.query("SET LOCAL lock_timeout = '5s'");
        if (apply) await client.query(`LOCK TABLE ${tables.map((table) => `kumon.${table}`).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
        const references = await client.query(`SELECT n.nspname AS schema, r.relname AS table, a.attname AS column
            FROM pg_constraint c JOIN pg_class r ON r.oid = c.conrelid JOIN pg_namespace n ON n.oid = r.relnamespace
            JOIN LATERAL unnest(c.conkey) k(attnum) ON TRUE JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum = k.attnum
            WHERE c.contype = 'f' AND c.confrelid = 'kumon.student'::regclass`);
        if (references.rows.some((row) => row.schema !== "kumon" || !["enrollment", "billing"].includes(row.table) || row.column !== "student_id")) {
            throw new Error("พบตารางอ้างอิง Student นอกขอบเขต ยังไม่รวมข้อมูล");
        }
        const columns = await client.query("SELECT table_schema, table_name FROM information_schema.columns WHERE column_name = 'student_id' AND table_schema NOT IN ('pg_catalog', 'information_schema')");
        if (columns.rows.some((row) => row.table_schema !== "kumon" || !["student", "enrollment", "billing"].includes(row.table_name))) {
            throw new Error("พบคอลัมน์ student_id นอกขอบเขต ยังไม่รวมข้อมูล");
        }
        const before = await readSnapshot(client);
        const plans = pairs.map(([keepId, removeId]) => planStudentMerge(before.student.find((row) => row.student_id === keepId), before.student.find((row) => row.student_id === removeId), before.enrollment));
        const otherCodes = await client.query("SELECT student_id, kumon_student_id FROM kumon.enrollment WHERE NOT (student_id = ANY($1::int[]))", [ids]);
        if (otherCodes.rows.some((row) => plans.some((plan) => plan.kumonId === String(row.kumon_student_id || "").trim()))) throw new Error("รหัสคุมองยังถูกใช้กับ Student คนอื่นนอกคู่ที่เลือก");
        let backup = null;
        if (apply) {
            await fs.mkdir(path.resolve("backups"), { recursive: true });
            backup = path.resolve("backups", `student-merge-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
            await fs.writeFile(backup, JSON.stringify({ createdAt: new Date().toISOString(), pairs, before }, null, 2), { flag: "wx" });
            for (const plan of plans) {
                const fields = Object.keys(plan.changes);
                // Column names come only from this table's saved profile; never from command-line input.
                const quoted = (field) => `"${field.replaceAll('"', '""')}"`;
                await client.query(`UPDATE kumon.student SET ${fields.map((field, index) => `${quoted(field)} = $${index + 1}`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE student_id = $${fields.length + 1}`, [...fields.map((field) => plan.changes[field]), plan.keepId]);
                for (const table of ["enrollment", "billing"]) await client.query(`UPDATE kumon.${table} SET student_id = $1 WHERE student_id = $2`, [plan.keepId, plan.removeId]);
                const removed = await client.query("DELETE FROM kumon.student WHERE student_id = $1", [plan.removeId]);
                assert.equal(removed.rowCount, 1, "จำนวน Student ที่รวมไม่ถูกต้อง");
            }
            const after = await readSnapshot(client);
            for (const table of tables.slice(3)) assert.equal(digest(after[table]), digest(before[table]), `ประวัติ ${table} เปลี่ยนแปลง ยกเลิกทั้งชุด`);
            for (const table of ["enrollment", "billing"]) {
                const expected = before[table].map((row) => ({ ...row, student_id: plans.find((plan) => plan.removeId === row.student_id)?.keepId ?? row.student_id }));
                assert.equal(digest(after[table]), digest(expected), `ข้อมูล ${table} ไม่ตรง ยกเลิกทั้งชุด`);
            }
            assert.equal(after.student.length, before.student.length - plans.length);
        }
        await client.query(apply ? "COMMIT" : "ROLLBACK");
        console.log(JSON.stringify({ applied: apply, pairs: plans.map((plan) => ({ keep: plan.keepId, merged: plan.removeId, movedEnrollmentIds: plan.enrollmentIds })),
            preserved: Object.fromEntries(tables.slice(1).map((table) => [table, before[table].length])), backup }));
    } catch (error) {
        await client.query("ROLLBACK"); console.error(error.message); process.exitCode = 1;
    } finally { client.release(); await pool.end(); }
}
