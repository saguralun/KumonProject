// Pure lookups against state.masters (levels, worksheets, schedules,
// statuses, genders, prefixes) plus a few small date helpers built on top.
// Used by both the Add Enrollment and Add Student forms, but this file
// itself calls out to nothing beyond `els`/`state` — a leaf module, same
// layer as studentFormUtil.js.
import { els, state } from "./student-manager.js";

export function selectedSubjectId() {
    return Number(els.enrollmentForm.elements.subjectId.value || 0);
}

export function selectedCurrentLevelId() {
    return Number(els.enrollmentForm.elements.currentLevelMasterId.value || 0);
}

export function levelsForSubject(subjectId, type) {
    return (state.masters?.levels || []).filter((level) =>
        Number(level.subjectId) === Number(subjectId)
        && Number(level.type) === Number(type)
    );
}

export function worksheetsForLevel(levelMasterId) {
    return (state.masters?.worksheets || []).filter((worksheet) =>
        Number(worksheet.levelMasterId) === Number(levelMasterId)
    );
}

export function worksheetsForSubject(subjectId) {
    const mainLevelIds = new Set(
        levelsForSubject(subjectId, 1).map((level) => Number(level.id))
    );

    return (state.masters?.worksheets || []).filter((worksheet) =>
        mainLevelIds.has(Number(worksheet.levelMasterId))
    );
}

export function worksheetsForDtMaster(dtMasterId) {
    const worksheetIds = new Set(
        (state.masters?.dtResults || [])
            .filter((result) => Number(result.dtMasterId) === Number(dtMasterId))
            .map((result) => Number(result.worksheetMasterId))
    );

    return (state.masters?.worksheets || []).filter((worksheet) =>
        worksheetIds.has(Number(worksheet.id))
    );
}

export function levelById(levelMasterId) {
    return (state.masters?.levels || []).find((level) =>
        Number(level.id) === Number(levelMasterId)
    );
}

export function worksheetById(worksheetMasterId) {
    return (state.masters?.worksheets || []).find((worksheet) =>
        Number(worksheet.id) === Number(worksheetMasterId)
    );
}

export function dtMastersForSubject(subjectId) {
    return (state.masters?.dtMasters || []).filter((dtMaster) =>
        Number(dtMaster.subjectId) === Number(subjectId)
    );
}

export function addZunChoicesForSubject(subjectId) {
    const zunLevels = levelsForSubject(subjectId, 2);
    const zi = zunLevels.find((level) => level.code === "ZI");
    const zii = zunLevels.find((level) => level.code === "ZII");
    const choices = [];

    if (zi) {
        choices.push({ value: `${zi.id}:ZI1`, label: "ZI1", levelMasterId: zi.id });
        choices.push({ value: `${zi.id}:ZI21`, label: "ZI21", levelMasterId: zi.id });
    }

    if (zii) {
        choices.push({ value: `${zii.id}:ZII1`, label: "ZII1", levelMasterId: zii.id });
    }

    return choices;
}

export function resolveAddZunLevelId(value) {
    if (!value) {
        return "";
    }

    return String(value).split(":")[0] || "";
}

export function scheduleWeekdays() {
    const seen = new Set();

    return (state.masters?.schedules || []).reduce((rows, schedule) => {
        if (!schedule.isActive || !schedule.weekdayCode || seen.has(schedule.weekdayCode)) {
            return rows;
        }

        seen.add(schedule.weekdayCode);
        rows.push({
            code: schedule.weekdayCode,
            name: schedule.weekdayName || schedule.weekdayCode
        });
        return rows;
    }, []);
}

export function scheduleTimesForWeekday(weekdayCode) {
    const seen = new Set();

    return (state.masters?.schedules || []).reduce((rows, schedule) => {
        if (
            !schedule.isActive
            || schedule.weekdayCode !== weekdayCode
            || !schedule.startTime
            || seen.has(schedule.startTime)
        ) {
            return rows;
        }

        seen.add(schedule.startTime);
        rows.push({
            time: schedule.startTime,
            label: `${schedule.startTime}-${schedule.endTime || ""}`
        });
        return rows;
    }, []);
}

export function matchingSchedule(weekdayCode, startTime) {
    return (state.masters?.schedules || []).find((schedule) =>
        schedule.isActive
        &&
        schedule.weekdayCode === weekdayCode
        && schedule.startTime === startTime
    );
}

export function statusByCode(code, group) {
    return (state.masters?.statuses || []).find((status) =>
        status.code === code
        && Number(status.group) === Number(group)
    );
}

export function genderByName(pattern) {
    return (state.masters?.genders || []).find((gender) =>
        String(gender.name || "").includes(pattern)
    );
}

export function prefixById(prefixId) {
    return (state.masters?.prefixes || []).find((prefix) =>
        Number(prefix.id) === Number(prefixId)
    );
}

export function localDateParts(dateText) {
    const [year, month, day] = String(dateText || "").slice(0, 10).split("-").map(Number);

    if (!year || !month || !day) {
        return null;
    }

    return { year, month, day };
}

export function ageInYears(dateText) {
    const parts = localDateParts(dateText);

    if (!parts) {
        return null;
    }

    const today = new Date();
    let age = today.getFullYear() - parts.year;
    const currentMonth = today.getMonth() + 1;
    const currentDay = today.getDate();

    if (currentMonth < parts.month || (currentMonth === parts.month && currentDay < parts.day)) {
        age -= 1;
    }

    return age;
}

export function formatDateInput({ year, month, day }) {
    return [
        String(year).padStart(4, "0"),
        String(month).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}

export function isHalfMonthStatusId(statusId) {
    const status = (state.masters?.statuses || []).find((row) =>
        Number(row.id) === Number(statusId)
    );

    return ["H", "FSH"].includes(status?.code);
}
