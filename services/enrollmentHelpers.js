// Small formatting/lookup helpers shared across services that deal with
// students and enrollments — extracted here after studentService.js and
// worksheetService.js turned out to each have their own exact copy of
// both of these (drift risk: a fix to one copy silently doesn't apply to
// the other).

export const COMPLETER_LEVEL_BY_SUBJECT = new Map([
    ["ME", "O"],
    ["EFL", "O"],
    ["TRP", "III"]
]);

export function isCompleterLevel(subjectCode, levelCode) {
    return COMPLETER_LEVEL_BY_SUBJECT.get(subjectCode) === levelCode;
}

export function formatStudentName(row) {
    const firstName = row.first_name || "";
    const lastName = row.last_name || "";
    const nickname = row.nickname ? ` (น้อง${row.nickname})` : "";

    return `${firstName} ${lastName}${nickname}`.trim();
}
