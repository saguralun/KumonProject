import fs from "node:fs/promises";
import path from "node:path";
import pool from "../config/db.js";
import { planKumonIdNormalization } from "../services/kumonStudentId.js";

const apply = process.argv.includes("--apply");
const client = await pool.connect();
try {
    await client.query("BEGIN");
    if (apply) await client.query("LOCK TABLE kumon.enrollment IN SHARE ROW EXCLUSIVE MODE");
    const { rows } = await client.query("SELECT enrollment_id, student_id, kumon_student_id FROM kumon.enrollment ORDER BY enrollment_id");
    const plan = planKumonIdNormalization(rows);
    let backup = null;
    if (apply && plan.updates.length) {
        const directory = path.resolve("backups");
        await fs.mkdir(directory, { recursive: true });
        backup = path.join(directory, `kumon-id-prefix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
        await fs.writeFile(backup, JSON.stringify({ createdAt: new Date().toISOString(), updates: plan.updates, skippedEnrollmentIds: plan.invalid }, null, 2), { flag: "wx" });
        for (const update of plan.updates) {
            const result = await client.query("UPDATE kumon.enrollment SET kumon_student_id = $1 WHERE enrollment_id = $2 AND kumon_student_id = $3", [update.normalized, update.enrollmentId, update.previous]);
            if (result.rowCount !== 1) throw new Error("ข้อมูลเปลี่ยนระหว่างปรับรหัส ยกเลิกทั้งชุด");
        }
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    console.log(JSON.stringify({ applied: apply, enrollments: plan.updates.length,
        students: new Set(plan.updates.map((row) => row.studentId)).size,
        skippedInvalid: plan.invalid.length, existingDuplicateGroups: plan.existingDuplicateGroups, backup }));
} catch (error) {
    await client.query("ROLLBACK");
    console.error(error.message);
    process.exitCode = 1;
} finally { client.release(); await pool.end(); }
