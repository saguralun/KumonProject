import { randomUUID } from "node:crypto";
import pool from "../config/db.js";
import { httpError } from "./httpError.js";
import { normalizeKumonStudentId } from "./kumonStudentId.js";

const previews = new Map();
const TTL = 30 * 60 * 1000;
const nameKey = (name) => String(name || "").normalize("NFC").replace(/\s+/gu, "").toLocaleLowerCase("th");
const fullName = (student) => `${student.firstName} ${student.lastName}`.trim();
const snapshot = (student) => JSON.stringify([student.firstName, student.lastName, student.birthDate,
    student.enrollments.map((enrollment) => [enrollment.id, enrollment.kumonId || ""]).sort((a, b) => a[0] - b[0])]);

export async function loadKsisMatchingStudents(client = pool) {
    const { rows } = await client.query(`SELECT s.student_id AS "studentId", s.first_name AS "firstName", s.last_name AS "lastName",
        s.birth_date::text AS "birthDate", COALESCE(jsonb_agg(jsonb_build_object('id', e.enrollment_id,
            'subject', sm.subject_code, 'kumonId', e.kumon_student_id) ORDER BY e.enrollment_id)
            FILTER (WHERE e.enrollment_id IS NOT NULL), '[]'::jsonb) AS enrollments
        FROM kumon.student s LEFT JOIN kumon.enrollment e ON e.student_id = s.student_id
        LEFT JOIN kumon.subject_master sm ON sm.subject_id = e.subject_id
        GROUP BY s.student_id ORDER BY s.student_id`);
    return rows;
}

export function proposeKsisMatches(roster, students) {
    const groups = new Map();
    for (const row of roster) {
        if (!groups.has(row.kumonId)) groups.set(row.kumonId, []);
        groups.get(row.kumonId).push(row);
    }
    const idsByStudent = new Map(students.map((student) => [student.studentId, student.enrollments.map((enrollment) => normalizeKumonStudentId(enrollment.kumonId)).filter(Boolean)]));
    const proposed = [...groups].map(([kumonId, copies]) => {
        const source = copies[0];
        const invalid = !/^\d{13}$/.test(kumonId) || !source.fullName || !/^\d{4}-\d{2}-\d{2}$/.test(source.birthDate)
            || copies.some((row) => nameKey(row.fullName) !== nameKey(source.fullName) || row.birthDate !== source.birthDate);
        const byName = invalid ? [] : students.filter((student) => nameKey(fullName(student)) === nameKey(source.fullName));
        const exact = byName.filter((student) => student.birthDate === source.birthDate);
        const candidates = (exact.length ? exact : byName).map((student) => {
            const existing = idsByStudent.get(student.studentId);
            const taken = students.some((other) => other.studentId !== student.studentId && idsByStudent.get(other.studentId).includes(kumonId));
            const conflict = !student.enrollments.length || taken || existing.some((id) => id !== kumonId);
            return { ...student, name: fullName(student), conflict, sameBirthDate: student.birthDate === source.birthDate };
        });
        const safeExact = candidates.filter((student) => !student.conflict && student.sameBirthDate);
        let status = invalid ? "invalid" : !candidates.length ? "unmatched" : !safeExact.length ? candidates.every((student) => student.conflict) ? "conflict" : "review"
            : exact.length > 1 ? "ambiguous" : "exact";
        if (status === "exact" && safeExact[0].enrollments.every((enrollment) => String(enrollment.kumonId || "").trim() === kumonId)) status = "matched";
        return { kumonId, fullName: source.fullName, birthDate: source.birthDate, status, candidates };
    });
    // Two external IDs must never be preselected for the same local student.
    const counts = new Map();
    for (const row of proposed.filter((row) => row.status === "exact")) {
        const id = row.candidates[0].studentId;
        counts.set(id, (counts.get(id) || 0) + 1);
    }
    for (const row of proposed) if (row.status === "exact" && counts.get(row.candidates[0].studentId) > 1) row.status = "ambiguous";
    return proposed;
}

export async function createKsisMatchingPreview({ roster, userId }, client = pool) {
    for (const [id, preview] of previews) if (preview.expires < Date.now() || preview.userId === Number(userId)) previews.delete(id);
    const students = await loadKsisMatchingStudents(client);
    const rows = proposeKsisMatches(roster.rows, students);
    const previewId = randomUUID();
    previews.set(previewId, { userId: Number(userId), expires: Date.now() + TTL, rows,
        snapshots: new Map(students.map((student) => [student.studentId, snapshot(student)])) });
    return { previewId, rows, context: roster.context, pagesRead: roster.pagesRead };
}

export async function saveKsisMatchingPreview({ previewId, selections, userId }, database = pool) {
    const preview = previews.get(previewId);
    if (!preview || preview.userId !== Number(userId) || preview.expires < Date.now()) throw httpError(409, "Preview หมดอายุหรือถูกใช้แล้ว กรุณาอ่านรายชื่อใหม่");
    if (!Array.isArray(selections) || !selections.length || selections.length > preview.rows.length) throw httpError(400, "กรุณาเลือกรายการที่จะยืนยัน");
    const selected = selections.map((selection) => {
        const row = preview.rows.find((item) => item.kumonId === selection.kumonId);
        const student = row?.candidates.find((item) => item.studentId === Number(selection.studentId));
        if (!student || student.conflict || ["invalid", "matched"].includes(row.status)) throw httpError(400, "รายการที่เลือกไม่ตรงกับ Preview หรือมีรหัสขัดแย้ง");
        return { kumonId: row.kumonId, studentId: student.studentId };
    });
    if (new Set(selected.map((row) => row.studentId)).size !== selected.length || new Set(selected.map((row) => row.kumonId)).size !== selected.length) throw httpError(409, "เลือกเด็กหรือรหัสคุมองซ้ำกัน กรุณาตรวจรายการ");
    const client = await database.connect();
    try {
        await client.query("BEGIN");
        // Serialize this short batch with enrollment edits so uniqueness is checked against the committed roster.
        await client.query("LOCK TABLE kumon.enrollment IN SHARE ROW EXCLUSIVE MODE");
        await client.query("SELECT student_id FROM kumon.student WHERE student_id = ANY($1::int[]) ORDER BY student_id FOR UPDATE", [selected.map((row) => row.studentId)]);
        const current = await loadKsisMatchingStudents(client);
        for (const selection of selected) {
            const student = current.find((row) => row.studentId === selection.studentId);
            if (!student || snapshot(student) !== preview.snapshots.get(selection.studentId)) throw httpError(409, "ข้อมูลเด็กเปลี่ยนหลัง Preview กรุณาอ่านรายชื่อและยืนยันใหม่");
            if (current.some((other) => other.studentId !== selection.studentId && other.enrollments.some((enrollment) => normalizeKumonStudentId(enrollment.kumonId) === selection.kumonId))) throw httpError(409, "รหัสคุมองถูกใช้กับเด็กคนอื่นแล้ว ยังไม่บันทึกทั้งชุด");
        }
        let enrollmentsUpdated = 0;
        for (const selection of selected) {
            const result = await client.query("UPDATE kumon.enrollment SET kumon_student_id = $1 WHERE student_id = $2 AND COALESCE(kumon_student_id, '') <> $1", [selection.kumonId, selection.studentId]);
            enrollmentsUpdated += result.rowCount;
        }
        await client.query("COMMIT");
        previews.delete(previewId);
        return { studentsUpdated: selected.length, enrollmentsUpdated };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally { client.release(); }
}
