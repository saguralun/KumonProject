import assert from "node:assert/strict";
import { test } from "node:test";
import { planStudentMerge } from "../services/studentMergePlan.js";

const profile = (student_id, extras = {}) => ({ student_id, first_name: "ตัวอย่าง", last_name: "ทดสอบ", birth_date: "2020-01-01", gender_id: 1,
    mobile: null, email: null, remark: "เดิม", created_at: "2026-01-01", updated_at: "2026-01-01", ...extras });
const enrollments = [{ enrollment_id: 11, student_id: 1, subject_id: 1, kumon_student_id: "7642650000001" },
    { enrollment_id: 22, student_id: 2, subject_id: 2, kumon_student_id: "7642650000001" }];

test("Student merge keeps enrollment IDs, fills missing contact fields, and preserves alternate profile in notes", () => {
    const plan = planStudentMerge(profile(1), profile(2, { last_name: "ทดสอบต่าง", mobile: "0812345678", remark: "หมายเหตุอีกวิชา" }), enrollments);
    assert.deepEqual(plan.enrollmentIds, [22]);
    assert.equal(plan.changes.mobile, "0812345678");
    assert.ok(!("last_name" in plan.changes));
    assert.match(plan.changes.remark, /ทดสอบต่าง/);
    assert.match(plan.changes.remark, /หมายเหตุอีกวิชา/);
    assert.ok(!("student_id" in plan.changes));
});

test("Student merge rejects same-subject enrollments rather than deleting any history", () => {
    assert.throws(() => planStudentMerge(profile(1), profile(2), [enrollments[0], { ...enrollments[1], subject_id: 1 }]), /รายวิชาเดียวกัน/);
});

test("Student merge requires matching first name, birth date, gender and Kumon ID", () => {
    for (const changes of [{ first_name: "คนอื่น" }, { birth_date: "2021-01-01" }, { gender_id: 2 }]) {
        assert.throws(() => planStudentMerge(profile(1), profile(2, changes), enrollments));
    }
    assert.throws(() => planStudentMerge(profile(1), profile(2), [enrollments[0], { ...enrollments[1], kumon_student_id: "7642650000002" }]), /รหัสคุมอง/);
});
