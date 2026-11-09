// Directory-only labels. These never change enrollment status or filtering.
export function directoryTone(enrollments = []) {
    if (!enrollments.length) return "unknown";
    if (enrollments.every(e => ["A", "OT"].includes(e.statusCode))) return "inactive";
    if (enrollments.every(e => e.statusCode === "CP")) return "complete";
    return "mixed";
}

export function absenceDuration(enrollment, now = new Date()) {
    const month = Number(enrollment.absenceSinceMonth);
    const year = Number(enrollment.absenceSinceYear);
    if (!Number.isInteger(month) || month < 1 || month > 12
        || !Number.isInteger(year) || year < 1 || year > 9999) return "ไม่ทราบงวดที่ออก";
    // History stores billing periods, not an exact departure day.
    const months = (now.getFullYear() - year) * 12 + now.getMonth() + 1 - month;
    if (months < 0) return `เริ่มงวด ${month}/${year}`;
    if (months === 0) return "ไม่ถึง 1 เดือน";
    const years = Math.floor(months / 12), remainder = months % 12;
    return [years ? `${years} ปี` : "", remainder ? `${remainder} เดือน` : ""].filter(Boolean).join(" ");
}

export function directoryStatus(enrollment, now) {
    const code = String(enrollment.statusCode || "");
    const inactive = code === "A" || code === "OT";
    return {
        tone: inactive ? "inactive" : code === "CP" ? "complete" : ["C", "N", "EO", "IT", "R"].includes(code) ? "active" : "unknown",
        label: `${enrollment.subjectCode || "วิชา"} · ${code || "—"}${inactive ? ` · ${absenceDuration(enrollment, now)}` : ""}`,
        title: inactive && enrollment.absenceSinceMonth && enrollment.absenceSinceYear
            ? `Absent รอบล่าสุดเริ่มงวด ${enrollment.absenceSinceMonth}/${enrollment.absenceSinceYear} • ไม่มีวันที่ออกแบบรายวัน`
            : code || "ไม่ทราบสถานะ"
    };
}
