import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeKumonStudentId, planKumonIdNormalization } from "../services/kumonStudentId.js";

test("Kumon ID adds 764 only to exactly ten digits and never adds it twice", () => {
    assert.equal(normalizeKumonStudentId("2650000001"), "7642650000001");
    assert.equal(normalizeKumonStudentId(" 7642650000001 "), "7642650000001");
    assert.equal(normalizeKumonStudentId(null), "");
    assert.equal(normalizeKumonStudentId("123456789"), "123456789");
    assert.equal(normalizeKumonStudentId("ABC"), "ABC");
});

test("Prefix normalization preserves existing duplicate ownership but blocks newly colliding IDs", () => {
    const row = (enrollment_id, student_id, kumon_student_id) => ({ enrollment_id, student_id, kumon_student_id });
    const plan = planKumonIdNormalization([row(1, 1, "2650000001"), row(2, 1, "2650000001"), row(3, 2, "2650000001"), row(4, 3, "123456789")]);
    assert.equal(plan.updates.length, 3);
    assert.deepEqual(plan.invalid, [4]);
    assert.equal(plan.existingDuplicateGroups, 1);
    assert.throws(() => planKumonIdNormalization([row(1, 1, "2650000001"), row(2, 2, "7642650000001")]), /ชน/);
    assert.equal(planKumonIdNormalization([row(1, 1, "7642650000001")]).updates.length, 0);
});
