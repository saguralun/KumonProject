export function normalizeKumonStudentId(value) {
    const id = String(value ?? "").trim();
    return /^\d{10}$/.test(id) ? `764${id}` : id;
}

export function planKumonIdNormalization(rows) {
    const groups = new Map();
    const updates = [];
    const invalid = [];
    for (const row of rows) {
        const original = String(row.kumon_student_id ?? "").trim();
        if (!original) continue;
        const normalized = normalizeKumonStudentId(original);
        if (!/^\d{13}$/.test(normalized)) { invalid.push(row.enrollment_id); continue; }
        if (!groups.has(normalized)) groups.set(normalized, { students: new Set(), originals: new Set() });
        const group = groups.get(normalized);
        group.students.add(row.student_id);
        group.originals.add(original);
        if (original !== normalized) updates.push({ enrollmentId: row.enrollment_id, studentId: row.student_id,
            previous: row.kumon_student_id, normalized });
    }
    const duplicateGroups = [...groups.values()].filter((group) => group.students.size > 1);
    if (duplicateGroups.some((group) => group.originals.size > 1)) throw new Error("การเติม 764 จะทำให้รหัสต่างรูปแบบชนกับเด็กคนอื่น ยังไม่ปรับข้อมูล");
    return { updates, invalid, existingDuplicateGroups: duplicateGroups.length };
}
