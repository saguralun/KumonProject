// "Add Enrollment" modal: populating master-data selects (both this
// modal's own selects and, via fillMasterSelects, several selects shared
// with the main Student/Enrollment forms), the opening-schedule day/time
// picker, half-month start-date logic, field validation, and defaults.
//
// defaultEnrollmentDate() lives in student-manager.js (it's part of the
// student/enrollment "core", not specific to this modal) — importing it
// back creates a circular import with student-manager.js, which also
// imports from this file. Safe for the same reason as every other
// circular import in this app: both directions are only ever invoked from
// event handlers, never at module-evaluation time.
import { defaultEnrollmentDate, els, state } from "./student-manager.js";
import {
    clearAutoFilled,
    clearFieldError,
    clearFormErrors,
    escapeHtml,
    focusFirstInvalidField,
    markFieldError,
    optionHtml,
    readForm,
    setAddEnrollmentMessage,
    setAutoFilled,
    setFormValue
} from "./studentFormUtil.js";
import {
    addZunChoicesForSubject,
    dtMastersForSubject,
    formatDateInput,
    isHalfMonthStatusId,
    levelById,
    levelsForSubject,
    localDateParts,
    matchingSchedule,
    scheduleTimesForWeekday,
    scheduleWeekdays,
    selectedCurrentLevelId,
    selectedSubjectId,
    statusByCode,
    worksheetById,
    worksheetsForDtMaster,
    worksheetsForLevel,
    worksheetsForSubject
} from "./studentMasters.js";

function addFormSubjectId() {
    return Number(els.addEnrollmentForm.elements.subjectId.value || 0);
}

function existingSubjectIds() {
    return new Set(
        (state.profile?.enrollments || []).map((enrollment) =>
            Number(enrollment.subjectId)
        )
    );
}

export function fillMasterSelects() {
    const form = els.studentForm;
    const addStudentForm = els.addStudentForm;
    const enrollmentForm = els.enrollmentForm;
    const masters = state.masters;

    [form, addStudentForm].forEach((studentForm) => {
        studentForm.elements.prefixId.innerHTML = optionHtml(masters.prefixes, {
            value: (row) => row.id,
            label: (row) => row.name,
            includeBlank: false
        });
        studentForm.elements.genderId.innerHTML = optionHtml(masters.genders, {
            value: (row) => row.id,
            label: (row) => row.name
        });
        studentForm.elements.schoolGradeId.innerHTML = optionHtml(masters.grades, {
            value: (row) => row.id,
            label: (row) => row.label
        });
    });
    Object.entries({
        schools: "schools",
        roads: "roads",
        subdistricts: "subdistricts",
        districts: "districts",
        provinces: "provinces",
        zipcodes: "zipcodes"
    }).forEach(([hintKey, dataKey]) => {
        const values = state.masters.studentHints?.[dataKey] || [];

        els.hintLists[hintKey].innerHTML = values
            .filter(Boolean)
            .sort((a, b) => String(a).localeCompare(String(b), "th"))
            .map((value) => `<option value="${escapeHtml(value)}"></option>`)
            .join("");
    });
    enrollmentForm.elements.subjectId.innerHTML = optionHtml(masters.subjects, {
        value: (row) => row.id,
        label: (row) => `${row.code} - ${row.name}`,
        includeBlank: false
    });
    enrollmentForm.elements.currentStatusGroup1Id.innerHTML = optionHtml(
        masters.statuses.filter((row) => Number(row.group) === 1),
        {
            value: (row) => row.id,
            label: (row) => `${row.code} - ${row.name}`,
            includeBlank: false
        }
    );
    enrollmentForm.elements.currentStatusGroup2Id.innerHTML = optionHtml(
        masters.statuses.filter((row) => Number(row.group) === 2),
        {
            value: (row) => row.id,
            label: (row) => `${row.code} - ${row.name}`
        }
    );
    ["openingScheduleId1", "openingScheduleId2"].forEach((fieldName) => {
        enrollmentForm.elements[fieldName].innerHTML = optionHtml(masters.schedules, {
            value: (row) => row.id,
            label: (row) => row.label
        });
    });
    els.addEnrollmentForm.elements.currentStatusGroup1Id.innerHTML = optionHtml(
        masters.statuses.filter((row) => Number(row.group) === 1),
        {
            value: (row) => row.id,
            label: (row) => `${row.code} - ${row.name}`,
            includeBlank: false
        }
    );
    els.addEnrollmentForm.elements.currentStatusGroup2Id.innerHTML = optionHtml(
        masters.statuses.filter((row) => Number(row.group) === 2),
        {
            value: (row) => row.id,
            label: (row) => `${row.code} - ${row.name}`
        }
    );
    refreshAddOpeningScheduleOptions();
    refreshLevelSelects();
}

export function refreshLevelSelects({
    keepLevel = false,
    keepZun = false,
    keepWorksheet = false,
    allSubjectWorksheets = false
} = {}) {
    const form = els.enrollmentForm;
    const subjectId = selectedSubjectId() || state.masters.subjects[0]?.id;
    const previousLevelId = form.elements.currentLevelMasterId.value;
    const previousZunId = form.elements.currentZunLevelMasterId.value;
    const previousWorksheetId = form.elements.startingWorksheetMasterId.value;
    const mainLevels = levelsForSubject(subjectId, 1);
    const zunLevels = levelsForSubject(subjectId, 2);

    form.elements.currentLevelMasterId.innerHTML = optionHtml(mainLevels, {
        value: (row) => row.id,
        label: (row) => row.code,
        includeBlank: false
    });

    if (keepLevel && mainLevels.some((row) => String(row.id) === String(previousLevelId))) {
        form.elements.currentLevelMasterId.value = previousLevelId;
    }

    form.elements.currentZunLevelMasterId.innerHTML = optionHtml(zunLevels, {
        value: (row) => row.id,
        label: (row) => row.code,
        blankLabel: "No Zun"
    });

    if (keepZun && zunLevels.some((row) => String(row.id) === String(previousZunId))) {
        form.elements.currentZunLevelMasterId.value = previousZunId;
    }

    const levelId = selectedCurrentLevelId();
    const worksheets = allSubjectWorksheets
        ? worksheetsForSubject(subjectId)
        : worksheetsForLevel(levelId);

    form.elements.startingWorksheetMasterId.innerHTML = optionHtml(worksheets, {
        value: (row) => row.id,
        label: (row) => `${levelById(row.levelMasterId)?.code || "-"}${row.worksheetNo}`,
        includeBlank: false
    });

    if (
        keepWorksheet
        && worksheets.some((row) => String(row.id) === String(previousWorksheetId))
    ) {
        form.elements.startingWorksheetMasterId.value = previousWorksheetId;
    }
}

export function updateAddEnrollmentDerivedFields() {
    const form = els.addEnrollmentForm;
    const subjectId = addFormSubjectId();
    const worksheet = worksheetById(form.elements.startingWorksheetMasterId.value);
    const level = worksheet ? levelById(worksheet.levelMasterId) : null;
    const dtMaster = (state.masters?.dtMasters || []).find((item) =>
        Number(item.id) === Number(form.elements.dtMasterId.value)
    );
    const levelMatchesSubject = !level || Number(level.subjectId) === Number(subjectId);

    setFormValue(form, "currentLevelMasterId", levelMatchesSubject ? (level?.id || "") : "");

    if (dtMaster) {
        form.elements.score.max = dtMaster.maxScore;
        form.elements.usedTime.removeAttribute("max");
        setFormValue(form, "maxScore", dtMaster.maxScore);
        setFormValue(form, "maxTime", dtMaster.maxTime);
        setAutoFilled(form, "maxScore", true);
        setAutoFilled(form, "maxTime", true);
        form.elements.score.disabled = false;
        form.elements.usedTime.disabled = false;
        form.elements.score.required = true;
        form.elements.usedTime.required = true;
        els.addEnrollmentDtHelp.textContent = `DT ${dtMaster.testLevel}: Max Score ${dtMaster.maxScore}, Max Time ${dtMaster.maxTime}`;
    } else {
        form.elements.score.removeAttribute("max");
        form.elements.usedTime.removeAttribute("max");
        setFormValue(form, "maxScore", "");
        setFormValue(form, "maxTime", "");
        setFormValue(form, "score", "");
        setFormValue(form, "usedTime", "");
        setAutoFilled(form, "maxScore", false);
        setAutoFilled(form, "maxTime", false);
        form.elements.score.disabled = true;
        form.elements.usedTime.disabled = true;
        form.elements.score.required = false;
        form.elements.usedTime.required = false;
        els.addEnrollmentDtHelp.textContent = "ถ้าไม่กรอก DT ระบบจะเพิ่ม enrollment อย่างเดียว";
    }
}

export function refreshAddOpeningTimeOptions(slot, { keepTime = false } = {}) {
    const form = els.addEnrollmentForm;
    const dayField = form.elements[`openingDay${slot}`];
    const timeField = form.elements[`openingTime${slot}`];
    const previousTime = timeField.value;
    const times = scheduleTimesForWeekday(dayField.value);

    timeField.innerHTML = optionHtml(times, {
        value: (row) => row.time,
        label: (row) => row.label
    });
    timeField.disabled = !dayField.value;

    if (keepTime && times.some((row) => row.time === previousTime)) {
        timeField.value = previousTime;
    }
}

export function refreshAddOpeningDayOptions({ changedSlot = null } = {}) {
    const form = els.addEnrollmentForm;
    const weekdays = scheduleWeekdays();
    const current = {
        1: form.elements.openingDay1.value,
        2: form.elements.openingDay2.value
    };

    ["1", "2"].forEach((slot) => {
        const otherSlot = slot === "1" ? "2" : "1";
        const dayField = form.elements[`openingDay${slot}`];
        const allowedWeekdays = weekdays.filter((weekday) =>
            !current[otherSlot] || weekday.code !== current[otherSlot]
        );

        dayField.innerHTML = optionHtml(allowedWeekdays, {
            value: (row) => row.code,
            label: (row) => row.name
        });

        if (allowedWeekdays.some((weekday) => weekday.code === current[slot])) {
            dayField.value = current[slot];
        } else {
            dayField.value = "";
            if (changedSlot !== slot) {
                setFormValue(form, `openingTime${slot}`, "");
                setFormValue(form, `openingScheduleId${slot}`, "");
                setAutoFilled(form, `openingScheduleId${slot}`, false);
            }
        }
    });
}

export function updateAddOpeningSchedule(slot) {
    const form = els.addEnrollmentForm;
    const schedule = matchingSchedule(
        form.elements[`openingDay${slot}`].value,
        form.elements[`openingTime${slot}`].value
    );

    setFormValue(form, `openingScheduleId${slot}`, schedule?.id || "");
    setAutoFilled(form, `openingScheduleId${slot}`, Boolean(schedule));
    if (schedule) {
        clearFieldError(form.elements[`openingScheduleId${slot}`]);
    }
    if (state.addEnrollmentValidationActive) {
        showAddEnrollmentCurrentCheck();
    }
}

export function refreshAddOpeningScheduleOptions() {
    const form = els.addEnrollmentForm;

    ["1", "2"].forEach((slot) => {
        form.elements[`openingScheduleId${slot}`].innerHTML = optionHtml(
            state.masters.schedules.filter((schedule) => schedule.isActive),
            {
                value: (row) => row.id,
                label: (row) => row.label
            }
        );
    });

    refreshAddOpeningDayOptions();

    ["1", "2"].forEach((slot) => {
        refreshAddOpeningTimeOptions(slot);
        updateAddOpeningSchedule(slot);
    });
}

export function moveOpeningScheduleUpIfNeeded() {
    const form = els.addEnrollmentForm;

    if (form.elements.openingScheduleId1.value || !form.elements.openingScheduleId2.value) {
        return;
    }

    const day2 = form.elements.openingDay2.value;
    const time2 = form.elements.openingTime2.value;

    setFormValue(form, "openingDay2", "");
    refreshAddOpeningTimeOptions("2");
    setFormValue(form, "openingScheduleId2", "");
    setAutoFilled(form, "openingScheduleId2", false);

    refreshAddOpeningDayOptions({ changedSlot: "2" });
    setFormValue(form, "openingDay1", day2);
    refreshAddOpeningTimeOptions("1");
    setFormValue(form, "openingTime1", time2);
    updateAddOpeningSchedule("1");
    refreshAddOpeningDayOptions({ changedSlot: "1" });
}

export function getAddEnrollmentChecks() {
    const form = els.addEnrollmentForm;
    const values = readForm(form);
    const checks = [];
    const addCheck = ({
        fieldName,
        fieldNames = null,
        label,
        message,
        ok
    }) => {
        checks.push({
            fieldName,
            fieldNames: fieldNames || [fieldName],
            label,
            message,
            ok: Boolean(ok)
        });
    };

    const score = Number(values.score);
    const maxScore = Number(form.elements.maxScore.value);
    const scoreHasValue = values.score !== "";
    const scoreIsValidBase = scoreHasValue && Number.isInteger(score) && score >= 0;
    const scoreWithinMax = scoreIsValidBase
        && (!values.dtMasterId || !Number.isFinite(maxScore) || score <= maxScore);
    const usedTime = Number(values.usedTime);
    const startingWorksheet = worksheetById(values.startingWorksheetMasterId);
    const startingLevel = startingWorksheet ? levelById(startingWorksheet.levelMasterId) : null;
    const startWorksheetMatchesSubject = Boolean(
        values.startingWorksheetMasterId
        && startingLevel
        && Number(startingLevel.subjectId) === Number(values.subjectId)
    );

    addCheck({
        fieldName: "subjectId",
        label: "Subject",
        message: "กรุณาเลือกวิชา",
        ok: Boolean(values.subjectId)
    });
    addCheck({
        fieldName: "dtMasterId",
        label: "DT test",
        message: "กรุณาเลือก DT test",
        ok: Boolean(values.dtMasterId)
    });
    addCheck({
        fieldName: "dtDate",
        label: "Date DT",
        message: "กรุณาใส่ Date DT",
        ok: Boolean(values.dtDate)
    });
    addCheck({
        fieldName: "enStartDate",
        label: "Starting Date",
        message: "กรุณาใส่ Starting Date",
        ok: Boolean(values.enStartDate)
    });
    addCheck({
        fieldName: "dtDate",
        fieldNames: ["dtDate", "enStartDate"],
        label: "Date DT <= Starting Date",
        message: "Date DT ต้องน้อยกว่าหรือเท่ากับ Starting Date",
        ok: Boolean(values.dtDate && values.enStartDate && values.dtDate <= values.enStartDate)
    });
    addCheck({
        fieldName: "score",
        label: "Score",
        message: scoreHasValue && scoreIsValidBase
            ? `Score ต้องไม่เกิน ${maxScore}`
            : "Score ต้องเป็น 0 หรือมากกว่า",
        ok: scoreWithinMax
    });
    addCheck({
        fieldName: "usedTime",
        label: "Time",
        message: "Time ต้องมากกว่า 0",
        ok: values.usedTime !== "" && Number.isInteger(usedTime) && usedTime > 0
    });
    addCheck({
        fieldName: "startingWorksheetMasterId",
        label: "Start Worksheet",
        message: "กรุณาเลือก Start Worksheet",
        ok: Boolean(values.startingWorksheetMasterId)
    });
    addCheck({
        fieldName: "startingWorksheetMasterId",
        fieldNames: ["startingWorksheetMasterId"],
        label: "Start Worksheet",
        message: "Start Worksheet ต้องตรงกับวิชาที่เลือก",
        ok: startWorksheetMatchesSubject
    });
    addCheck({
        fieldName: "currentStatusGroup1Id",
        label: "Status",
        message: "Status ต้องมีค่า",
        ok: Boolean(values.currentStatusGroup1Id)
    });
    addCheck({
        fieldName: "openingDay1",
        label: "Date Open 1",
        message: "กรุณาเลือก Date Open 1",
        ok: Boolean(values.openingDay1)
    });
    addCheck({
        fieldName: "openingTime1",
        label: "Time 1",
        message: "กรุณาเลือก Time 1",
        ok: Boolean(values.openingTime1)
    });
    addCheck({
        fieldName: "openingScheduleId1",
        label: "Schedule 1",
        message: "Schedule 1 ต้องมีค่า",
        ok: Boolean(values.openingScheduleId1)
    });

    return checks;
}

export function showAddEnrollmentCurrentCheck() {
    const form = els.addEnrollmentForm;
    const checks = getAddEnrollmentChecks();
    const firstInvalid = checks.find((check) => !check.ok);

    clearFormErrors(form);

    if (firstInvalid) {
        firstInvalid.fieldNames.forEach((fieldName) => markFieldError(form, fieldName));
        setAddEnrollmentMessage(
            `<span>ต้องแก้</span><strong>${escapeHtml(firstInvalid.label)}</strong><em>${escapeHtml(firstInvalid.message)}</em>`,
            "error",
            { html: true }
        );
        return firstInvalid;
    }

    setAddEnrollmentMessage(
        `<span>ผ่าน</span><strong>ข้อมูลครบ</strong><em>พร้อม Add Subject</em>`,
        "neutral",
        { html: true }
    );
    return null;
}

export function validateAddEnrollmentForm() {
    const form = els.addEnrollmentForm;
    const checks = getAddEnrollmentChecks();
    const errors = checks.filter((check) => !check.ok);

    state.addEnrollmentValidationActive = true;
    showAddEnrollmentCurrentCheck();

    if (errors.length) {
        focusFirstInvalidField(form.elements[errors[0].fieldName]);
        return false;
    }

    return true;
}

export function updateHalfMonthByStartDate() {
    const form = els.addEnrollmentForm;
    const parts = localDateParts(form.elements.enStartDate.value);
    const halfStatus = statusByCode("H", 2);
    const statusField = form.elements.currentStatusGroup2Id;

    if (!parts || !halfStatus) {
        return;
    }

    if (parts.day >= 11 && parts.day <= 20) {
        setFormValue(form, "currentStatusGroup2Id", halfStatus.id);
        statusField.dataset.autoHalfMonth = "true";
        setAutoFilled(form, "currentStatusGroup2Id", true);
        setAutoFilled(form, "enStartDate", false);
    } else if (statusField.dataset.autoHalfMonth === "true") {
        setFormValue(form, "currentStatusGroup2Id", "");
        delete statusField.dataset.autoHalfMonth;
        setAutoFilled(form, "currentStatusGroup2Id", false);
        setAutoFilled(form, "enStartDate", false);
    } else if (isHalfMonthStatusId(statusField.value)) {
        alignStartDateForHalfMonth();
    } else {
        setFormValue(form, "currentStatusGroup2Id", "");
        setAutoFilled(form, "currentStatusGroup2Id", false);
        setAutoFilled(form, "enStartDate", false);
    }
}

export function alignStartDateForHalfMonth() {
    const form = els.addEnrollmentForm;
    const parts = localDateParts(form.elements.enStartDate.value);

    if (!parts || !isHalfMonthStatusId(form.elements.currentStatusGroup2Id.value)) {
        return;
    }

    if (parts.day < 11 || parts.day > 20) {
        setFormValue(form, "enStartDate", formatDateInput({ ...parts, day: 11 }));
        setAutoFilled(form, "enStartDate", true);
    } else {
        setAutoFilled(form, "enStartDate", false);
    }
}

export function refreshAddEnrollmentOptions() {
    const form = els.addEnrollmentForm;
    const previousSubjectId = form.elements.subjectId.value;
    const usedSubjects = existingSubjectIds();
    const availableSubjects = (state.masters?.subjects || []).filter((subject) =>
        !usedSubjects.has(Number(subject.id))
    );

    form.elements.subjectId.innerHTML = optionHtml(availableSubjects, {
        value: (row) => row.id,
        label: (row) => `${row.code} - ${row.name}`,
        includeBlank: false
    });

    if (availableSubjects.some((subject) => String(subject.id) === String(previousSubjectId))) {
        form.elements.subjectId.value = previousSubjectId;
    }

    const subjectId = addFormSubjectId();
    const zunChoices = addZunChoicesForSubject(subjectId);
    const dtMasters = dtMastersForSubject(subjectId);

    form.elements.startingWorksheetMasterId.innerHTML = optionHtml([], {
        value: (row) => row.id,
        label: (row) => `${levelById(row.levelMasterId)?.code || "-"}${row.worksheetNo}`,
        blankLabel: "เลือก DT ก่อน"
    });
    form.elements.startingWorksheetMasterId.disabled = true;
    setAutoFilled(form, "startingWorksheetMasterId", false);
    form.elements.currentZunLevelMasterId.innerHTML = optionHtml(zunChoices, {
        value: (row) => row.value,
        label: (row) => row.label,
        blankLabel: "No Zun"
    });
    form.elements.dtMasterId.innerHTML = optionHtml(dtMasters, {
        value: (row) => row.id,
        label: (row) => `${row.testLevel} (Max ${row.maxScore}/${row.maxTime})`,
        blankLabel: "-"
    });

    updateAddEnrollmentDerivedFields();
}

export function refreshAddStartingWorksheetFromDt() {
    const form = els.addEnrollmentForm;
    const dtMasterId = form.elements.dtMasterId.value;
    const worksheets = dtMasterId ? worksheetsForDtMaster(dtMasterId) : [];

    form.elements.startingWorksheetMasterId.innerHTML = optionHtml(worksheets, {
        value: (row) => row.id,
        label: (row) => `${levelById(row.levelMasterId)?.code || "-"}${row.worksheetNo}`,
        includeBlank: !dtMasterId || !worksheets.length,
        blankLabel: dtMasterId ? "ไม่พบ start worksheet ของวิชานี้" : "เลือก DT ก่อน"
    });
    form.elements.startingWorksheetMasterId.disabled = !dtMasterId || !worksheets.length;
    setAutoFilled(form, "startingWorksheetMasterId", Boolean(dtMasterId && worksheets.length));
    if (dtMasterId && worksheets.length) {
        clearFieldError(form.elements.startingWorksheetMasterId);
    }

    updateAddEnrollmentDerivedFields();
    if (state.addEnrollmentValidationActive) {
        showAddEnrollmentCurrentCheck();
    }
}

export function fillAddEnrollmentDefaults() {
    const form = els.addEnrollmentForm;
    const student = state.profile?.student;
    const hasEnrollment = (state.profile?.enrollments || []).length > 0;
    const group1Statuses = state.masters.statuses.filter((row) => Number(row.group) === 1);
    const initialStatusRows = group1Statuses.filter((row) => ["N", "IT"].includes(row.code));
    const newStatus = group1Statuses.find((row) => row.code === "N");
    const eoStatus = group1Statuses.find((row) => row.code === "EO");
    const defaultStatus = hasEnrollment ? eoStatus : newStatus;

    form.reset();
    clearAutoFilled(form);
    form.elements.currentStatusGroup1Id.innerHTML = optionHtml(
        hasEnrollment ? [eoStatus].filter(Boolean) : initialStatusRows,
        {
            value: (row) => row.id,
            label: (row) => `${row.code} - ${row.name}`,
            includeBlank: false
        }
    );
    setFormValue(form, "studentId", student?.studentId);
    setFormValue(form, "studentName", student?.displayName);
    setFormValue(form, "enStartDate", defaultEnrollmentDate());
    setFormValue(form, "dtDate", defaultEnrollmentDate());
    setFormValue(form, "currentStatusGroup1Id", defaultStatus?.id || "");
    setFormValue(form, "isKumonConnect", false);
    form.elements.currentStatusGroup1Id.disabled = hasEnrollment;

    refreshAddEnrollmentOptions();
    refreshAddStartingWorksheetFromDt();
    refreshAddOpeningScheduleOptions();
    updateHalfMonthByStartDate();
}

export function setEnrollmentLocked(isLocked) {
    [
        "subjectId",
        "startingWorksheetMasterId",
        "currentStatusGroup1Id",
        "currentStatusGroup2Id"
    ].forEach((fieldName) => {
        const field = els.enrollmentForm.elements[fieldName];

        if (field) {
            field.disabled = isLocked;
        }
    });
}
