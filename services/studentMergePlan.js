import { normalizeKumonStudentId } from "./kumonStudentId.js";

const empty = (value) => value == null || (typeof value === "string" && !value.trim());
const textKey = (value) => String(value || "").normalize("NFC").replace(/\s+/gu, "");

export function planStudentMerge(keep, remove, enrollments) {
    if (!keep || !remove || keep.student_id === remove.student_id) throw new Error("ต้องมี Student ต้นทางและปลายทางคนละรายการ");
    if (!keep.birth_date || keep.birth_date !== remove.birth_date || textKey(keep.first_name) !== textKey(remove.first_name)) {
        throw new Error("ชื่อหรือวันเกิดไม่ตรงกัน ไม่รวมข้อมูลอัตโนมัติ");
    }
    const own = (id) => enrollments.filter((row) => row.student_id === id);
    const kept = own(keep.student_id), moved = own(remove.student_id);
    if (!kept.length || !moved.length) throw new Error("ทั้งสอง Student ต้องมีรายวิชาสำหรับยืนยันรหัสคุมอง");
    const codes = [...kept, ...moved].map((row) => normalizeKumonStudentId(row.kumon_student_id));
    if (codes.some((code) => !/^\d{13}$/.test(code)) || new Set(codes).size !== 1) throw new Error("รหัสคุมองไม่ตรงกัน ไม่รวมข้อมูล");
    if (moved.some((row) => kept.some((other) => other.subject_id === row.subject_id))) {
        throw new Error("มีรายวิชาเดียวกันทั้งสอง Student ต้องตรวจประวัติก่อน ไม่ลบหรือรวมรายวิชาเอง");
    }
    if (!empty(keep.gender_id) && !empty(remove.gender_id) && keep.gender_id !== remove.gender_id) throw new Error("เพศไม่ตรงกัน ไม่รวมข้อมูล");
    const ignored = new Set(["student_id", "created_at", "updated_at", "remark"]);
    const changes = {};
    const alternatives = [];
    for (const key of Object.keys(keep)) {
        if (ignored.has(key) || empty(remove[key])) continue;
        if (empty(keep[key])) changes[key] = remove[key];
        else if (String(keep[key]) !== String(remove[key])) alternatives.push(`${key}: ${remove[key]}`);
    }
    const originalRemark = empty(remove.remark) || remove.remark === keep.remark ? "" : remove.remark;
    changes.remark = [keep.remark, `[รวมจาก Student #${remove.student_id}]`, originalRemark, ...alternatives].filter((value) => !empty(value)).join("\n");
    return { keepId: keep.student_id, removeId: remove.student_id, kumonId: codes[0],
        enrollmentIds: moved.map((row) => row.enrollment_id), changes };
}
