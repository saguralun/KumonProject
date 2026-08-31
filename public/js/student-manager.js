import { bindFourDigitYearDateInputs } from "./dateInputYear.js";

const els = {
    studentSearch: document.getElementById("studentSearch"),
    statusFilter: document.getElementById("statusFilter"),
    studentList: document.getElementById("studentList"),
    newStudentButton: document.getElementById("newStudentButton"),
    pageTitle: document.getElementById("pageTitle"),
    pageSubtitle: document.getElementById("pageSubtitle"),
    statusLine: document.getElementById("statusLine"),
    studentForm: document.getElementById("studentForm"),
    studentFormSubtitle: document.getElementById("studentFormSubtitle"),
    saveStudentButton: document.getElementById("saveStudentButton"),
    deleteStudentButton: document.getElementById("deleteStudentButton"),
    enrollmentSubtitle: document.getElementById("enrollmentSubtitle"),
    newEnrollmentButton: document.getElementById("newEnrollmentButton"),
    enrollmentTabs: document.getElementById("enrollmentTabs"),
    enrollmentForm: document.getElementById("enrollmentForm"),
    enrollmentEmpty: document.getElementById("enrollmentEmpty"),
    saveEnrollmentButton: document.getElementById("saveEnrollmentButton"),
    enrollmentActionBar: document.getElementById("enrollmentActionBar"),
    enrollmentAbsentButton: document.getElementById("enrollmentAbsentButton"),
    enrollmentResumeButton: document.getElementById("enrollmentResumeButton"),
    enrollmentCompleterButton: document.getElementById("enrollmentCompleterButton"),
    enrollmentOtButton: document.getElementById("enrollmentOtButton"),
    deleteEnrollmentButton: document.getElementById("deleteEnrollmentButton"),
    historyTabs: document.getElementById("historyTabs"),
    historySubtitle: document.getElementById("historySubtitle"),
    historyTableWrap: document.getElementById("historyTableWrap"),
    wsGraphButton: document.getElementById("wsGraphButton"),
    wsGraphModal: document.getElementById("wsGraphModal"),
    wsGraphClose: document.getElementById("wsGraphClose"),
    wsGraphSubtitle: document.getElementById("wsGraphSubtitle"),
    wsGraphWrap: document.getElementById("wsGraphWrap"),
    addEnrollmentModal: document.getElementById("addEnrollmentModal"),
    addEnrollmentForm: document.getElementById("addEnrollmentForm"),
    addEnrollmentCancel: document.getElementById("addEnrollmentCancel"),
    addEnrollmentClose: document.getElementById("addEnrollmentClose"),
    addEnrollmentSave: document.getElementById("addEnrollmentSave"),
    addEnrollmentDtHelp: document.getElementById("addEnrollmentDtHelp"),
    addEnrollmentMessage: document.getElementById("addEnrollmentMessage"),
    addStudentModal: document.getElementById("addStudentModal"),
    addStudentForm: document.getElementById("addStudentForm"),
    addStudentCancel: document.getElementById("addStudentCancel"),
    addStudentClose: document.getElementById("addStudentClose"),
    addStudentSave: document.getElementById("addStudentSave"),
    addStudentMessage: document.getElementById("addStudentMessage"),
    copyAddressSearch: document.getElementById("copyAddressSearch"),
    copyAddressSearchButton: document.getElementById("copyAddressSearchButton"),
    copyAddressSummary: document.getElementById("copyAddressSummary"),
    copyAddressStudentSelect: document.getElementById("copyAddressStudentSelect"),
    copyAddressApplyButton: document.getElementById("copyAddressApplyButton"),
    hintLists: {
        schools: document.getElementById("schoolNameHints"),
        roads: document.getElementById("roadHints"),
        subdistricts: document.getElementById("subdistrictHints"),
        districts: document.getElementById("districtHints"),
        provinces: document.getElementById("provinceHints"),
        zipcodes: document.getElementById("zipcodeHints")
    }
};

const state = {
    masters: null,
    students: [],
    selectedStudentId: null,
    profile: null,
    selectedEnrollmentId: null,
    historyType: "ws",
    wsGraphRange: "3",
    searchTimer: null,
    addEnrollmentValidationActive: false,
    addStudentValidationActive: false,
    addStudentDuplicate: null,
    addStudentDuplicateTimer: null,
    copyAddressResults: []
};

function setStatus(message, type = "neutral") {
    els.statusLine.textContent = message;
    els.statusLine.classList.toggle("is-error", type === "error");
}

function setAddEnrollmentMessage(message = "", type = "neutral", { html = false } = {}) {
    if (html) {
        els.addEnrollmentMessage.innerHTML = message;
    } else {
        els.addEnrollmentMessage.textContent = message;
    }
    els.addEnrollmentMessage.classList.toggle("hidden", !message);
    els.addEnrollmentMessage.classList.toggle("is-error", type === "error");
}

function setAddStudentMessage(message = "", type = "neutral", { html = false } = {}) {
    if (html) {
        els.addStudentMessage.innerHTML = message;
    } else {
        els.addStudentMessage.textContent = message;
    }
    els.addStudentMessage.classList.toggle("hidden", !message);
    els.addStudentMessage.classList.toggle("is-error", type === "error");
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatBoolean(value) {
    if (value === true) {
        return "จริง";
    }

    if (value === false) {
        return "ยัง";
    }

    return value ?? "";
}

function formatDate(dateText) {
    if (!dateText) {
        return "";
    }

    const [year, month, day] = String(dateText).slice(0, 10).split("-");

    if (!year || !month || !day) {
        return dateText;
    }

    return `${day}/${month}/${Number(year) + 543}`;
}

function mobileDigits(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 10);
}

function formatMobile(value) {
    const digits = mobileDigits(value);

    if (digits.length <= 3) {
        return digits;
    }

    if (digits.length <= 6) {
        return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    }

    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isValidMobile(value) {
    return mobileDigits(value).length === 10 && formatMobile(value).length === 12;
}

function formatMobileField(field) {
    field.value = formatMobile(field.value);
}

function zipcodeDigits(value) {
    return String(value || "").replace(/\D/g, "").slice(0, 5);
}

function isValidZipcode(value) {
    return /^\d{5}$/.test(String(value || ""));
}

function formatZipcodeField(field) {
    field.value = zipcodeDigits(field.value);
}

async function requestJson(url, options = {}) {
    const response = await fetch(url, {
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        },
        ...options
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || data.success === false) {
        throw new Error(data.error || "Request failed");
    }

    return data;
}

function optionHtml(rows, {
    value,
    label,
    includeBlank = true,
    blankLabel = "-"
}) {
    const blank = includeBlank ? `<option value="">${escapeHtml(blankLabel)}</option>` : "";

    return `${blank}${rows.map((row) => `
        <option value="${escapeHtml(value(row))}">${escapeHtml(label(row))}</option>
    `).join("")}`;
}

function setFormValue(form, name, value) {
    const field = form.elements[name];

    if (field) {
        if (field.type === "checkbox") {
            field.checked = value === true || value === "true" || value === "on" || value === "1";
            return;
        }

        field.value = value ?? "";
    }
}

function setAutoFilled(form, name, isAutoFilled) {
    const field = form.elements[name];

    if (field) {
        field.classList.toggle("auto-filled", Boolean(isAutoFilled));
    }
}

function clearAutoFilled(form) {
    [...form.elements].forEach((field) => {
        field.classList?.remove("auto-filled");
        if (field.dataset) {
            delete field.dataset.autoHalfMonth;
        }
    });
}

function clearFieldError(field) {
    field?.classList?.remove("field-error");
}

function clearFormErrors(form) {
    [...form.elements].forEach(clearFieldError);
}

function markFieldError(form, name) {
    const field = form.elements[name];

    if (field) {
        field.classList.add("field-error");
    }

    return field;
}

function focusFirstInvalidField(field) {
    if (!field) {
        return;
    }

    field.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => field.focus({ preventScroll: true }), 120);
}

function selectInputText(input) {
    if (!input) {
        return;
    }

    input.select();
}

function bindSelectAllInput(input, onFocus = null) {
    if (!input) {
        return;
    }

    input.addEventListener("focus", () => {
        selectInputText(input);
        onFocus?.();
    });
    input.addEventListener("mousedown", (event) => {
        if (document.activeElement === input) {
            event.preventDefault();
            selectInputText(input);
        }
    });
    input.addEventListener("click", () => selectInputText(input));
}

function readForm(form) {
    const output = {};

    [...form.elements].forEach((field) => {
        if (!field.name || field.type === "submit" || field.type === "button") {
            return;
        }

        output[field.name] = field.type === "checkbox"
            ? field.checked
            : String(field.value ?? "").trim();
    });

    return output;
}

function selectedSubjectId() {
    return Number(els.enrollmentForm.elements.subjectId.value || 0);
}

function selectedCurrentLevelId() {
    return Number(els.enrollmentForm.elements.currentLevelMasterId.value || 0);
}

function levelsForSubject(subjectId, type) {
    return (state.masters?.levels || []).filter((level) =>
        Number(level.subjectId) === Number(subjectId)
        && Number(level.type) === Number(type)
    );
}

function worksheetsForLevel(levelMasterId) {
    return (state.masters?.worksheets || []).filter((worksheet) =>
        Number(worksheet.levelMasterId) === Number(levelMasterId)
    );
}

function worksheetsForSubject(subjectId) {
    const mainLevelIds = new Set(
        levelsForSubject(subjectId, 1).map((level) => Number(level.id))
    );

    return (state.masters?.worksheets || []).filter((worksheet) =>
        mainLevelIds.has(Number(worksheet.levelMasterId))
    );
}

function worksheetsForDtMaster(dtMasterId) {
    const worksheetIds = new Set(
        (state.masters?.dtResults || [])
            .filter((result) => Number(result.dtMasterId) === Number(dtMasterId))
            .map((result) => Number(result.worksheetMasterId))
    );

    return (state.masters?.worksheets || []).filter((worksheet) =>
        worksheetIds.has(Number(worksheet.id))
    );
}

function levelById(levelMasterId) {
    return (state.masters?.levels || []).find((level) =>
        Number(level.id) === Number(levelMasterId)
    );
}

function worksheetById(worksheetMasterId) {
    return (state.masters?.worksheets || []).find((worksheet) =>
        Number(worksheet.id) === Number(worksheetMasterId)
    );
}

function dtMastersForSubject(subjectId) {
    return (state.masters?.dtMasters || []).filter((dtMaster) =>
        Number(dtMaster.subjectId) === Number(subjectId)
    );
}

function addZunChoicesForSubject(subjectId) {
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

function resolveAddZunLevelId(value) {
    if (!value) {
        return "";
    }

    return String(value).split(":")[0] || "";
}

function scheduleWeekdays() {
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

function scheduleTimesForWeekday(weekdayCode) {
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

function matchingSchedule(weekdayCode, startTime) {
    return (state.masters?.schedules || []).find((schedule) =>
        schedule.isActive
        &&
        schedule.weekdayCode === weekdayCode
        && schedule.startTime === startTime
    );
}

function statusByCode(code, group) {
    return (state.masters?.statuses || []).find((status) =>
        status.code === code
        && Number(status.group) === Number(group)
    );
}

function genderByName(pattern) {
    return (state.masters?.genders || []).find((gender) =>
        String(gender.name || "").includes(pattern)
    );
}

function prefixById(prefixId) {
    return (state.masters?.prefixes || []).find((prefix) =>
        Number(prefix.id) === Number(prefixId)
    );
}

function localDateParts(dateText) {
    const [year, month, day] = String(dateText || "").slice(0, 10).split("-").map(Number);

    if (!year || !month || !day) {
        return null;
    }

    return { year, month, day };
}

function ageInYears(dateText) {
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

function formatDateInput({ year, month, day }) {
    return [
        String(year).padStart(4, "0"),
        String(month).padStart(2, "0"),
        String(day).padStart(2, "0")
    ].join("-");
}

function isHalfMonthStatusId(statusId) {
    const status = (state.masters?.statuses || []).find((row) =>
        Number(row.id) === Number(statusId)
    );

    return ["H", "FSH"].includes(status?.code);
}

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

function fillMasterSelects() {
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

function refreshLevelSelects({
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

function updateAddEnrollmentDerivedFields() {
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

function refreshAddOpeningTimeOptions(slot, { keepTime = false } = {}) {
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

function refreshAddOpeningDayOptions({ changedSlot = null } = {}) {
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

function updateAddOpeningSchedule(slot) {
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

function refreshAddOpeningScheduleOptions() {
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

function moveOpeningScheduleUpIfNeeded() {
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

function getAddEnrollmentChecks() {
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

function showAddEnrollmentCurrentCheck() {
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

function validateAddEnrollmentForm() {
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

function getAddStudentChecks() {
    const form = els.addStudentForm;
    const values = readForm(form);
    const checks = [];
    const addCheck = ({ fieldName, fieldNames = null, label, message, ok }) => {
        checks.push({
            fieldName,
            fieldNames: fieldNames || [fieldName],
            label,
            message,
            ok: Boolean(ok)
        });
    };
    const age = values.birthDate ? ageInYears(values.birthDate) : null;

    addCheck({
        fieldName: "prefixId",
        label: "คำนำหน้า",
        message: "กรุณาเลือกคำนำหน้า",
        ok: Boolean(values.prefixId)
    });
    addCheck({
        fieldName: "firstName",
        label: "ชื่อ",
        message: "กรุณากรอกชื่อ",
        ok: Boolean(values.firstName)
    });
    addCheck({
        fieldName: "lastName",
        label: "นามสกุล",
        message: "กรุณากรอกนามสกุล",
        ok: Boolean(values.lastName)
    });
    addCheck({
        fieldName: "firstName",
        fieldNames: ["firstName", "lastName"],
        label: "ชื่อซ้ำ",
        message: state.addStudentDuplicate
            ? `มีเด็กชื่อนี้แล้ว: #${state.addStudentDuplicate.studentId} ${state.addStudentDuplicate.displayName}`
            : "ชื่อและนามสกุลต้องไม่ซ้ำพร้อมกัน",
        ok: Boolean(values.firstName && values.lastName && !state.addStudentDuplicate)
    });
    addCheck({
        fieldName: "nickname",
        label: "ชื่อเล่น",
        message: "กรุณากรอกชื่อเล่น",
        ok: Boolean(values.nickname)
    });
    addCheck({
        fieldName: "genderId",
        label: "เพศ",
        message: "กรุณาเลือกเพศ",
        ok: Boolean(values.genderId)
    });
    addCheck({
        fieldName: "birthDate",
        label: "วันเกิด",
        message: "กรุณากรอกวันเกิด",
        ok: Boolean(values.birthDate)
    });
    addCheck({
        fieldName: "birthDate",
        label: "วันเกิด",
        message: "อายุต้องมากกว่า 2 ปี",
        ok: !values.birthDate || (age !== null && age > 2)
    });
    addCheck({
        fieldName: "schoolGradeId",
        label: "ชั้น",
        message: "กรุณาเลือกชั้น",
        ok: Boolean(values.schoolGradeId)
    });
    addCheck({
        fieldName: "schoolName",
        label: "โรงเรียน",
        message: "กรุณากรอกโรงเรียน",
        ok: Boolean(values.schoolName)
    });
    addCheck({
        fieldName: "mobile",
        label: "เบอร์โทร",
        message: "กรุณากรอกเบอร์โทร",
        ok: Boolean(values.mobile)
    });
    addCheck({
        fieldName: "mobile",
        label: "เบอร์โทร",
        message: "เบอร์โทรต้องเป็น 10 หลัก เช่น 000-000-0000",
        ok: !values.mobile || isValidMobile(values.mobile)
    });
    addCheck({
        fieldName: "addressZipcode",
        label: "รหัสไปรษณีย์",
        message: "กรุณากรอกรหัสไปรษณีย์",
        ok: Boolean(values.addressZipcode)
    });
    addCheck({
        fieldName: "addressZipcode",
        label: "รหัสไปรษณีย์",
        message: "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก",
        ok: !values.addressZipcode || isValidZipcode(values.addressZipcode)
    });
    addCheck({
        fieldName: "addressProvince",
        label: "จังหวัด",
        message: "กรุณากรอกจังหวัด",
        ok: Boolean(values.addressProvince)
    });
    addCheck({
        fieldName: "addressDistrict",
        label: "อำเภอ",
        message: "กรุณากรอกอำเภอ",
        ok: Boolean(values.addressDistrict)
    });
    addCheck({
        fieldName: "addressSubdistrict",
        label: "ตำบล",
        message: "กรุณากรอกตำบล",
        ok: Boolean(values.addressSubdistrict)
    });

    return checks;
}

function showAddStudentCurrentCheck() {
    const form = els.addStudentForm;
    const checks = getAddStudentChecks();
    const firstInvalid = checks.find((check) => !check.ok);

    clearFormErrors(form);

    if (firstInvalid) {
        firstInvalid.fieldNames.forEach((fieldName) => markFieldError(form, fieldName));
        setAddStudentMessage(
            `<span>ต้องแก้</span><strong>${escapeHtml(firstInvalid.label)}</strong><em>${escapeHtml(firstInvalid.message)}</em>`,
            "error",
            { html: true }
        );
        return firstInvalid;
    }

    setAddStudentMessage(
        `<span>ผ่าน</span><strong>ข้อมูลครบ</strong><em>พร้อม Add Student</em>`,
        "neutral",
        { html: true }
    );
    return null;
}

function validateAddStudentForm() {
    const firstInvalid = showAddStudentCurrentCheck();

    state.addStudentValidationActive = true;
    if (firstInvalid) {
        focusFirstInvalidField(els.addStudentForm.elements[firstInvalid.fieldName]);
        return false;
    }

    return true;
}

function updateAddStudentGenderFromPrefix() {
    const form = els.addStudentForm;
    const prefix = prefixById(form.elements.prefixId.value);
    const prefixName = String(prefix?.name || "");
    const female = genderByName("หญิง");
    const male = genderByName("ชาย");

    if ((prefixName.includes("ด.ญ") || prefixName.includes("นาง") || prefixName.includes("น.ส")) && female) {
        setFormValue(form, "genderId", female.id);
        setAutoFilled(form, "genderId", true);
    } else if ((prefixName.includes("ด.ช") || prefixName.includes("นาย")) && male) {
        setFormValue(form, "genderId", male.id);
        setAutoFilled(form, "genderId", true);
    }
}

async function checkAddStudentDuplicateNow() {
    const form = els.addStudentForm;
    const values = readForm(form);

    state.addStudentDuplicate = null;

    if (!values.firstName || !values.lastName) {
        if (state.addStudentValidationActive) {
            showAddStudentCurrentCheck();
        }
        return;
    }

    const params = new URLSearchParams({
        firstName: values.firstName,
        lastName: values.lastName
    });
    const data = await requestJson(`/api/students/duplicate?${params.toString()}`);

    state.addStudentDuplicate = data.duplicate || null;
    if (state.addStudentValidationActive) {
        showAddStudentCurrentCheck();
    }
}

function queueAddStudentDuplicateCheck() {
    window.clearTimeout(state.addStudentDuplicateTimer);
    state.addStudentDuplicateTimer = window.setTimeout(() => {
        checkAddStudentDuplicateNow().catch((error) => setAddStudentMessage(error.message, "error"));
    }, 250);
}

function sortedUnique(values) {
    return [...new Set(values
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter((value) => value && value !== "-"))]
        .sort((a, b) => a.localeCompare(b, "th"));
}

function renderHintList(list, values) {
    list.innerHTML = sortedUnique(values)
        .map((value) => `<option value="${escapeHtml(value)}"></option>`)
        .join("");
}

function renderSelectOptions(field, values, { blankLabel = "-" } = {}) {
    const currentValue = field.value;
    const options = sortedUnique(values);

    field.innerHTML = `
        <option value="">${escapeHtml(blankLabel)}</option>
        ${options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}
    `;

    if (currentValue && options.includes(currentValue)) {
        field.value = currentValue;
    }
}

function setSelectValueWithOption(form, name, value) {
    const field = form.elements[name];
    const text = String(value || "").trim();

    if (!field || !text) {
        setFormValue(form, name, "");
        return;
    }

    if (![...field.options].some((option) => option.value === text)) {
        field.insertAdjacentHTML("beforeend", `<option value="${escapeHtml(text)}">${escapeHtml(text)}</option>`);
    }

    setFormValue(form, name, text);
}

function addStudentAddressRows(filters = {}) {
    return (state.masters?.studentHints?.addresses || []).filter((item) => {
        if (filters.zipcode && String(item.zipcode || "").trim() !== filters.zipcode) {
            return false;
        }
        if (filters.province && String(item.province || "").trim() !== filters.province) {
            return false;
        }
        if (filters.district && String(item.district || "").trim() !== filters.district) {
            return false;
        }
        return true;
    });
}

function ensureValueInOptions(form, fieldName, values) {
    const field = form.elements[fieldName];
    const allowed = new Set(sortedUnique(values));

    if (field.value && !allowed.has(field.value)) {
        field.value = "";
        setAutoFilled(form, fieldName, false);
    }
}

function updateAddStudentAddressHints(changedField = null) {
    const form = els.addStudentForm;
    const zipcode = String(form.elements.addressZipcode.value || "").trim();
    let province = String(form.elements.addressProvince.value || "").trim();
    let district = String(form.elements.addressDistrict.value || "").trim();
    let autoProvince = null;

    if (changedField === "addressZipcode") {
        const zipRows = zipcode ? addStudentAddressRows({ zipcode }) : [];
        const provinces = sortedUnique(zipRows.map((item) => item.province));

        if (zipcode && provinces.length === 1) {
            autoProvince = provinces[0];
            province = autoProvince;
        }

        form.elements.addressDistrict.value = "";
        form.elements.addressSubdistrict.value = "";
        setAutoFilled(form, "addressDistrict", false);
        setAutoFilled(form, "addressSubdistrict", false);
        district = "";
    } else if (changedField === "addressProvince") {
        form.elements.addressDistrict.value = "";
        form.elements.addressSubdistrict.value = "";
        setAutoFilled(form, "addressProvince", false);
        setAutoFilled(form, "addressDistrict", false);
        setAutoFilled(form, "addressSubdistrict", false);
        district = "";
    } else if (changedField === "addressDistrict") {
        form.elements.addressSubdistrict.value = "";
        setAutoFilled(form, "addressDistrict", false);
        setAutoFilled(form, "addressSubdistrict", false);
    } else if (changedField === "addressSubdistrict") {
        setAutoFilled(form, "addressSubdistrict", false);
    }

    province = String(form.elements.addressProvince.value || "").trim();
    district = String(form.elements.addressDistrict.value || "").trim();

    const provinceRows = province ? addStudentAddressRows({ province }) : addStudentAddressRows();
    const districtRows = addStudentAddressRows({
        ...(zipcode ? { zipcode } : {}),
        ...(province ? { province } : {})
    });
    const subdistrictRows = addStudentAddressRows({
        ...(zipcode ? { zipcode } : {}),
        ...(province ? { province } : {}),
        ...(district ? { district } : {})
    });

    renderHintList(els.hintLists.zipcodes, provinceRows.map((item) => item.zipcode));
    renderSelectOptions(form.elements.addressProvince, zipcode
        ? addStudentAddressRows({ zipcode }).map((item) => item.province)
        : addStudentAddressRows().map((item) => item.province));
    renderSelectOptions(form.elements.addressDistrict, districtRows.map((item) => item.district));
    renderSelectOptions(form.elements.addressSubdistrict, subdistrictRows.map((item) => item.subdistrict));

    ensureValueInOptions(form, "addressProvince", zipcode
        ? addStudentAddressRows({ zipcode }).map((item) => item.province)
        : addStudentAddressRows().map((item) => item.province));
    ensureValueInOptions(form, "addressDistrict", districtRows.map((item) => item.district));
    ensureValueInOptions(form, "addressSubdistrict", subdistrictRows.map((item) => item.subdistrict));

    if (autoProvince) {
        setFormValue(form, "addressProvince", autoProvince);
        setAutoFilled(form, "addressProvince", true);
        clearFieldError(form.elements.addressProvince);
    }
}

function resetCopyAddressTool() {
    state.copyAddressResults = [];
    els.copyAddressSearch.value = "";
    els.copyAddressSummary.textContent = "ฟังก์ชันเสริม: ค้นหานักเรียนเดิมเพื่อคัดลอกที่อยู่";
    els.copyAddressStudentSelect.innerHTML = `<option value="">-</option>`;
    els.copyAddressStudentSelect.disabled = true;
    els.copyAddressApplyButton.disabled = true;
}

function renderCopyAddressResults(rows = []) {
    state.copyAddressResults = rows;
    els.copyAddressSummary.textContent = rows.length
        ? `พบ ${rows.length} คน เลือกนักเรียนที่ต้องการคัดลอกที่อยู่`
        : "ไม่พบนักเรียนจากคำค้นนี้";
    els.copyAddressStudentSelect.innerHTML = `
        <option value="">-</option>
        ${rows.map((student) => `
            <option value="${escapeHtml(student.studentId)}">
                #${escapeHtml(student.studentId)} ${escapeHtml(student.displayName)}
            </option>
        `).join("")}
    `;
    els.copyAddressStudentSelect.disabled = rows.length === 0;
    els.copyAddressApplyButton.disabled = true;
}

async function searchCopyAddressStudents() {
    const query = els.copyAddressSearch.value.trim();

    if (!query) {
        renderCopyAddressResults([]);
        els.copyAddressSummary.textContent = "กรุณากรอกชื่อหรือนามสกุลก่อนค้นหา";
        setAddStudentMessage(
            `<span>ต้องแก้</span><strong>คัดลอกที่อยู่</strong><em>กรุณากรอกชื่อหรือนามสกุลเพื่อค้นหา</em>`,
            "error",
            { html: true }
        );
        els.copyAddressSearch.focus();
        return;
    }

    els.copyAddressSearchButton.disabled = true;

    try {
        const params = new URLSearchParams({
            query,
            status: "all",
            limit: "20"
        });
        const data = await requestJson(`/api/students/search?${params.toString()}`);
        renderCopyAddressResults(data.rows || []);
        setAddStudentMessage(
            data.rows?.length
                ? `<span>ผ่าน</span><strong>คัดลอกที่อยู่</strong><em>เลือกนักเรียนที่ต้องการคัดลอกที่อยู่</em>`
                : `<span>ต้องแก้</span><strong>คัดลอกที่อยู่</strong><em>ไม่พบนักเรียนจากคำค้นนี้</em>`,
            data.rows?.length ? "neutral" : "error",
            { html: true }
        );
    } catch (error) {
        setAddStudentMessage(error.message, "error");
    } finally {
        els.copyAddressSearchButton.disabled = false;
        setTimeout(() => selectInputText(els.copyAddressSearch), 0);
    }
}

function applyCopiedAddress(student) {
    const form = els.addStudentForm;
    const fields = [
        "addressZipcode",
        "addressProvince",
        "addressDistrict",
        "addressSubdistrict",
        "addressNumber",
        "addressVillage",
        "addressAlley",
        "addressRoad",
        "remark"
    ];

    setFormValue(form, "addressZipcode", student.addressZipcode);
    updateAddStudentAddressHints("addressZipcode");
    setSelectValueWithOption(form, "addressProvince", student.addressProvince);
    updateAddStudentAddressHints("addressProvince");
    setSelectValueWithOption(form, "addressDistrict", student.addressDistrict);
    updateAddStudentAddressHints("addressDistrict");
    setSelectValueWithOption(form, "addressSubdistrict", student.addressSubdistrict);
    updateAddStudentAddressHints("addressSubdistrict");
    setFormValue(form, "addressNumber", student.addressNumber);
    setFormValue(form, "addressVillage", student.addressVillage);
    setFormValue(form, "addressAlley", student.addressAlley);
    setFormValue(form, "addressRoad", student.addressRoad);
    setFormValue(form, "remark", student.remark);

    fields.forEach((fieldName) => {
        setAutoFilled(form, fieldName, Boolean(form.elements[fieldName]?.value));
        clearFieldError(form.elements[fieldName]);
    });
}

async function copyAddressFromSelectedStudent() {
    const studentId = els.copyAddressStudentSelect.value;

    if (!studentId) {
        return;
    }

    els.copyAddressApplyButton.disabled = true;

    try {
        const data = await requestJson(`/api/students/${encodeURIComponent(studentId)}`);
        applyCopiedAddress(data.student);
        setAddStudentMessage(
            `<span>ผ่าน</span><strong>คัดลอกที่อยู่</strong><em>คัดลอกจาก ${escapeHtml(data.student.displayName)} แล้ว</em>`,
            "neutral",
            { html: true }
        );
        if (state.addStudentValidationActive) {
            showAddStudentCurrentCheck();
        }
    } catch (error) {
        setAddStudentMessage(error.message, "error");
    } finally {
        els.copyAddressApplyButton.disabled = !els.copyAddressStudentSelect.value;
    }
}

function updateHalfMonthByStartDate() {
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

function alignStartDateForHalfMonth() {
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

function refreshAddEnrollmentOptions() {
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

function refreshAddStartingWorksheetFromDt() {
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

function fillAddEnrollmentDefaults() {
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

function setEnrollmentLocked(isLocked) {
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

function renderStudentList() {
    if (!state.students.length) {
        els.studentList.innerHTML = `<div class="empty-state">ไม่พบเด็ก</div>`;
        return;
    }

    els.studentList.innerHTML = state.students.map((student) => `
            <button
                type="button"
                class="student-item ${Number(student.studentId) === Number(state.selectedStudentId) ? "active" : ""}"
                data-student-id="${escapeHtml(student.studentId)}"
                data-preferred-enrollment-id="${escapeHtml(student.matchedEnrollmentId || "")}"
            >
                <div class="student-item-name">${escapeHtml(student.displayName)}</div>
            </button>
        `).join("");
}

function scrollSelectedStudentIntoView() {
    const activeItem = els.studentList.querySelector(".student-item.active");

    activeItem?.scrollIntoView({ block: "nearest" });
}

async function loadStudents() {
    const params = new URLSearchParams({
        query: els.studentSearch.value,
        status: els.statusFilter.value,
        limit: "120"
    });
    const data = await requestJson(`/api/students/search?${params.toString()}`);

    state.students = data.rows || [];
    renderStudentList();
}

function queueStudentSearch() {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(() => {
        loadStudents().catch((error) => setStatus(error.message, "error"));
    }, 160);
}

function fillStudentForm(student = {}) {
    const form = els.studentForm;
    const fields = [
        "prefixId",
        "firstName",
        "lastName",
        "nickname",
        "genderId",
        "birthDate",
        "schoolGradeId",
        "schoolName",
        "mobile",
        "email",
        "addressNumber",
        "addressVillage",
        "addressAlley",
        "addressRoad",
        "addressSubdistrict",
        "addressDistrict",
        "addressProvince",
        "addressZipcode",
        "remark"
    ];

    fields.forEach((field) => setFormValue(form, field, student[field]));
    if (form.elements.mobile.value) {
        formatMobileField(form.elements.mobile);
    }
    if (form.elements.addressZipcode.value) {
        formatZipcodeField(form.elements.addressZipcode);
    }
}

function defaultEnrollmentDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function fillEnrollmentForm(enrollment = null) {
    const form = els.enrollmentForm;

    els.enrollmentForm.classList.remove("hidden");
    els.enrollmentEmpty.classList.add("hidden");

    if (!enrollment) {
        state.isNewEnrollment = true;
        setEnrollmentLocked(false);
        form.reset();
        setFormValue(form, "enrollmentId", "");
        setFormValue(form, "enStartDate", defaultEnrollmentDate());
        setFormValue(form, "isKumonConnect", false);
        refreshLevelSelects();
        const enrollingOtherStatus = state.masters.statuses.find((row) => row.code === "EO");
        const newStatus = state.masters.statuses.find((row) => row.code === "N");
        setFormValue(
            form,
            "currentStatusGroup1Id",
            state.profile?.enrollments?.length ? enrollingOtherStatus?.id : newStatus?.id
        );
        els.saveEnrollmentButton.textContent = "💾 Add Enrollment";
        return;
    }

    state.isNewEnrollment = false;
    setEnrollmentLocked(true);
    setFormValue(form, "enrollmentId", enrollment.enrollmentId);
    setFormValue(form, "subjectId", enrollment.subjectId);
    refreshLevelSelects({
        keepLevel: false,
        keepZun: false,
        keepWorksheet: false
    });
    setFormValue(form, "kumonStudentId", enrollment.kumonStudentId);
    setFormValue(form, "isKumonConnect", enrollment.isKumonConnect);
    setFormValue(form, "currentLevelMasterId", enrollment.currentLevelMasterId);
    refreshLevelSelects({
        keepLevel: true,
        allSubjectWorksheets: true
    });
    setFormValue(form, "currentZunLevelMasterId", enrollment.currentZunLevelMasterId);
    setFormValue(form, "startingWorksheetMasterId", enrollment.startingWorksheetMasterId);
    setFormValue(form, "enStartDate", enrollment.enStartDate);
    setFormValue(form, "openingScheduleId1", enrollment.openingScheduleId1);
    setFormValue(form, "openingScheduleId2", enrollment.openingScheduleId2);
    setFormValue(form, "currentStatusGroup1Id", enrollment.currentStatusGroup1Id);
    setFormValue(form, "currentStatusGroup2Id", enrollment.currentStatusGroup2Id);
    setFormValue(form, "remark", enrollment.remark);
    els.saveEnrollmentButton.textContent = "💾 Save Enrollment";
}

function renderEnrollmentTabs() {
    const enrollments = state.profile?.enrollments || [];

    if (!enrollments.length) {
        els.enrollmentTabs.innerHTML = "";
        els.enrollmentActionBar.classList.add("hidden");
        // deleteEnrollmentButton lives in .panel-actions now, not inside
        // enrollmentActionBar, so hiding that bar alone doesn't hide it —
        // it stayed visible/enabled from whatever the last enrollment's
        // state was, letting it be clicked with nothing left to delete.
        els.deleteEnrollmentButton.classList.add("hidden");
        els.enrollmentSubtitle.textContent = "ยังไม่มีวิชา";
        els.enrollmentForm.classList.add("hidden");
        els.enrollmentEmpty.classList.remove("hidden");
        els.enrollmentEmpty.textContent = "กด + Subject เพื่อเพิ่มวิชาแรก";
        return;
    }

    els.enrollmentTabs.innerHTML = enrollments.map((enrollment) => `
        <button
            type="button"
            class="enrollment-tab ${Number(enrollment.enrollmentId) === Number(state.selectedEnrollmentId) ? "active" : ""}"
            data-enrollment-id="${escapeHtml(enrollment.enrollmentId)}"
        >
            ${escapeHtml(enrollment.subjectCode)} #${escapeHtml(enrollment.enrollmentId)}
        </button>
    `).join("");
    const active = enrollments.find((enrollment) =>
        Number(enrollment.enrollmentId) === Number(state.selectedEnrollmentId)
    ) || enrollments[0];

    state.selectedEnrollmentId = active.enrollmentId;
    const canLeave = active.statusGroup1Code === "C";
    const canResume = ["A", "OT"].includes(active.statusGroup1Code);
    const canComplete = Boolean(active.canComplete) && active.statusGroup1Code !== "CP";
    const canDeleteEnrollment = Boolean(active.canDeleteEnrollment);

    els.enrollmentAbsentButton.classList.toggle("hidden", !canLeave);
    els.enrollmentOtButton.classList.toggle("hidden", !canLeave);
    els.enrollmentResumeButton.classList.toggle("hidden", !canResume);
    els.enrollmentCompleterButton.classList.toggle("hidden", !canComplete);
    els.deleteEnrollmentButton.classList.toggle("hidden", !canDeleteEnrollment);
    els.enrollmentActionBar.classList.toggle("hidden", !(canLeave || canResume || canComplete || canDeleteEnrollment));
    els.enrollmentSubtitle.textContent = `${active.subjectCode} • ${active.currentLevelCode}${active.currentZunLevelCode ? ` • Zun ${active.currentZunLevelCode}` : ""}${active.isKumonConnect ? " • KC" : ""} • ${active.statusGroup1Name}`;
    fillEnrollmentForm(active);
}

function updateDeleteStudentButton() {
    const enrollmentCount = state.profile?.enrollments?.length || 0;
    const canDeleteStudent = Boolean(state.selectedStudentId && enrollmentCount === 0);

    els.deleteStudentButton.classList.toggle("hidden", !canDeleteStudent);
    els.deleteStudentButton.disabled = !canDeleteStudent;
}

function renderProfile() {
    const student = state.profile?.student;

    if (!student) {
        return;
    }

    fillStudentForm(student);
    els.pageTitle.textContent = student.displayName;
    els.pageSubtitle.textContent = `Student ID #${student.studentId}`;
    els.newEnrollmentButton.disabled = (state.profile.enrollments || []).length >= 3;
    updateWsGraphButtonVisibility();
    els.newEnrollmentButton.textContent = els.newEnrollmentButton.disabled
        ? "ครบ 3 วิชาแล้ว"
        : "+ Subject";
    updateDeleteStudentButton();
    renderEnrollmentTabs();
    renderStudentList();
}

async function loadProfile(studentId, {
    preferredEnrollmentId = null
} = {}) {
    setStatus("กำลังโหลดข้อมูลเด็ก...");
    const data = await requestJson(`/api/students/${encodeURIComponent(studentId)}`);

    state.selectedStudentId = data.student.studentId;
    state.profile = {
        student: data.student,
        enrollments: data.enrollments || []
    };
    const preferredEnrollment = state.profile.enrollments.find((enrollment) =>
        Number(enrollment.enrollmentId) === Number(preferredEnrollmentId)
    );

    state.selectedEnrollmentId = preferredEnrollment?.enrollmentId
        || state.profile.enrollments[0]?.enrollmentId
        || null;
    state.isNewEnrollment = false;
    renderProfile();
    await loadHistory();
    setStatus("พร้อมแก้ไข");
}

function startNewStudent() {
    openAddStudentModal();
}

function openAddStudentModal() {
    const form = els.addStudentForm;

    form.reset();
    clearFormErrors(form);
    clearAutoFilled(form);
    state.addStudentValidationActive = false;
    state.addStudentDuplicate = null;
    resetCopyAddressTool();
    setFormValue(form, "prefixId", state.masters.prefixes[0]?.id || "");
    updateAddStudentGenderFromPrefix();
    updateAddStudentAddressHints();
    setAddStudentMessage();
    els.addStudentModal.classList.remove("hidden");
    setTimeout(() => form.elements.firstName.focus(), 80);
}

function closeAddStudentModal() {
    els.addStudentModal.classList.add("hidden");
    state.addStudentValidationActive = false;
    state.addStudentDuplicate = null;
    setAddStudentMessage();
}

function showNewStudentWorkspace() {
    state.selectedStudentId = null;
    state.profile = {
        student: null,
        enrollments: []
    };
    state.selectedEnrollmentId = null;
    state.isNewEnrollment = false;
    fillStudentForm({
        prefixId: state.masters.prefixes[0]?.id || ""
    });
    els.pageTitle.textContent = "เพิ่มนักเรียนใหม่";
    els.pageSubtitle.textContent = "กรอกข้อมูลเด็ก แล้ว Save Student ก่อนเพิ่มวิชา";
    els.studentFormSubtitle.textContent = "New Student";
    els.newEnrollmentButton.disabled = true;
    updateWsGraphButtonVisibility();
    els.enrollmentTabs.innerHTML = "";
    els.enrollmentForm.classList.add("hidden");
    els.enrollmentEmpty.classList.remove("hidden");
    els.enrollmentEmpty.textContent = "บันทึก Student ก่อน แล้วค่อยเพิ่ม Subject";
    els.historyTableWrap.innerHTML = `<div class="empty-state">ยังไม่มีประวัติ</div>`;
    renderStudentList();
}

async function saveNewStudent(event) {
    event.preventDefault();
    await checkAddStudentDuplicateNow();
    if (!validateAddStudentForm()) {
        return;
    }

    setAddStudentMessage("กำลังเพิ่ม student...");
    els.addStudentSave.disabled = true;

    try {
        const payload = readForm(els.addStudentForm);
        const data = await requestJson("/api/students", {
            method: "POST",
            body: JSON.stringify(payload)
        });

        state.selectedStudentId = data.student.studentId;
        state.profile = {
            student: data.student,
            enrollments: data.enrollments || []
        };
        state.selectedEnrollmentId = null;
        closeAddStudentModal();
        renderProfile();
        // A brand-new student has no enrollments yet, so the current status
        // filter (e.g. "Active") would hide them from the sidebar list even
        // though they're now the selected/loaded student — switch to "All"
        // so they're actually visible, matching what got selected.
        els.studentSearch.value = "";
        els.statusFilter.value = "all";
        await loadStudents();
        scrollSelectedStudentIntoView();
        await loadHistory();
        setStatus("เพิ่ม student แล้ว");
    } catch (error) {
        setAddStudentMessage(error.message, "error");
    } finally {
        els.addStudentSave.disabled = false;
    }
}

async function deleteSelectedStudent() {
    const student = state.profile?.student;
    const hasEnrollment = (state.profile?.enrollments || []).length > 0;

    if (!student || hasEnrollment) {
        setStatus("ลบได้เฉพาะ student ที่ยังไม่มี enrollment", "error");
        return;
    }

    const ok = window.confirm(`ลบ student #${student.studentId} ${student.displayName} ใช่ไหม?`);

    if (!ok) {
        return;
    }

    els.deleteStudentButton.disabled = true;
    setStatus("กำลังลบ student...");

    try {
        await requestJson(`/api/students/${encodeURIComponent(student.studentId)}`, {
            method: "DELETE"
        });
        state.selectedStudentId = null;
        state.selectedEnrollmentId = null;
        state.profile = null;
        fillStudentForm({});
        els.pageTitle.textContent = "เลือกนักเรียน";
        els.pageSubtitle.textContent = "หรือกด + Student เพื่อเพิ่มเด็กใหม่";
        els.studentFormSubtitle.textContent = "Student Profile";
        els.newEnrollmentButton.disabled = true;
        updateWsGraphButtonVisibility();
        els.enrollmentTabs.innerHTML = "";
        els.enrollmentForm.classList.add("hidden");
        els.enrollmentEmpty.classList.remove("hidden");
        els.enrollmentEmpty.textContent = "เลือกเด็กก่อน";
        els.historyTableWrap.innerHTML = `<div class="empty-state">เลือกเด็กเพื่อดูประวัติ</div>`;
        updateDeleteStudentButton();
        await loadStudents();
        setStatus("ลบ student แล้ว");
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        updateDeleteStudentButton();
    }
}

async function saveStudent(event) {
    event.preventDefault();
    setStatus("กำลังบันทึก student...");

    try {
        const payload = readForm(els.studentForm);
        const data = state.selectedStudentId
            ? await requestJson(`/api/students/${encodeURIComponent(state.selectedStudentId)}`, {
                method: "PUT",
                body: JSON.stringify(payload)
            })
            : await requestJson("/api/students", {
                method: "POST",
                body: JSON.stringify(payload)
            });

        state.selectedStudentId = data.student.studentId;
        state.profile = {
            student: data.student,
            enrollments: data.enrollments || []
        };
        renderProfile();
        await loadStudents();
        setStatus("บันทึก student แล้ว");
    } catch (error) {
        setStatus(error.message, "error");
    }
}

async function saveEnrollment(event) {
    event.preventDefault();

    if (!state.selectedStudentId) {
        setStatus("กรุณาบันทึก Student ก่อน", "error");
        return;
    }

    setStatus("กำลังบันทึก enrollment...");

    try {
        const payload = readForm(els.enrollmentForm);
        const endpoint = `/api/students/${encodeURIComponent(state.selectedStudentId)}/enrollments/${encodeURIComponent(payload.enrollmentId)}`;
        const data = await requestJson(endpoint, {
            method: "PUT",
            body: JSON.stringify(payload)
        });

        state.profile = data.profile;
        state.selectedEnrollmentId = data.enrollmentId;
        state.isNewEnrollment = false;
        renderProfile();
        await loadStudents();
        setStatus("บันทึก enrollment แล้ว");
    } catch (error) {
        setStatus(error.message, "error");
    }
}

function selectedEnrollment() {
    return (state.profile?.enrollments || []).find((enrollment) =>
        Number(enrollment.enrollmentId) === Number(state.selectedEnrollmentId)
    ) || null;
}

function todayIsoDate() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

async function runEnrollmentStatusAction(action) {
    const enrollment = selectedEnrollment();

    if (!state.selectedStudentId || !enrollment) {
        setStatus("กรุณาเลือก enrollment ก่อน", "error");
        return;
    }

    const labels = {
        absent: "Absent",
        outgoingTransfer: "OT",
        completer: "Completer"
    };

    if (!window.confirm(`${labels[action] || action} enrollment #${enrollment.enrollmentId} ใช่ไหม?`)) {
        return;
    }

    setStatus(`กำลังบันทึก ${labels[action] || action}...`);

    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(state.selectedStudentId)}/enrollments/${encodeURIComponent(enrollment.enrollmentId)}/status-action`,
            {
                method: "POST",
                body: JSON.stringify({ action })
            }
        );
        state.profile = data.profile;
        state.selectedEnrollmentId = data.enrollmentId;
        renderProfile();
        await loadStudents();
        await loadHistory();
        setStatus(data.message || `บันทึก ${labels[action] || action} แล้ว`);
    } catch (error) {
        setStatus(error.message, "error");
    }
}

async function runEnrollmentResumeAction() {
    const enrollment = selectedEnrollment();

    if (!state.selectedStudentId || !enrollment) {
        setStatus("กรุณาเลือก enrollment ก่อน", "error");
        return;
    }

    const resumeDate = window.prompt(
        `กลับมาเรียนวันที่เท่าไหร่? (YYYY-MM-DD)`,
        todayIsoDate()
    );

    if (!resumeDate) {
        return;
    }

    setStatus("กำลังบันทึก Resume...");

    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(state.selectedStudentId)}/enrollments/${encodeURIComponent(enrollment.enrollmentId)}/status-action`,
            {
                method: "POST",
                body: JSON.stringify({
                    action: "resume",
                    resumeDate
                })
            }
        );
        state.profile = data.profile;
        state.selectedEnrollmentId = data.enrollmentId;
        renderProfile();
        await loadStudents();
        await loadHistory();
        setStatus(data.message || "บันทึก Resume แล้ว");
    } catch (error) {
        setStatus(error.message, "error");
    }
}

async function deleteSelectedEnrollment() {
    const enrollment = selectedEnrollment();

    if (!state.selectedStudentId || !enrollment) {
        setStatus("กรุณาเลือก enrollment ก่อน", "error");
        return;
    }

    const ok = window.confirm(`ลบ ${enrollment.subjectCode} enrollment #${enrollment.enrollmentId} ใช่ไหม?`);

    if (!ok) {
        return;
    }

    els.deleteEnrollmentButton.disabled = true;
    setStatus("กำลังลบ subject...");

    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(state.selectedStudentId)}/enrollments/${encodeURIComponent(enrollment.enrollmentId)}`,
            { method: "DELETE" }
        );
        state.profile = data.profile;
        state.selectedEnrollmentId = data.profile.enrollments[0]?.enrollmentId || null;
        renderProfile();
        await loadStudents();
        await loadHistory();
        setStatus(data.deletedDtRows
            ? `ลบ subject แล้ว (ลบ DT ${data.deletedDtRows} รายการ)`
            : "ลบ subject แล้ว");
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        els.deleteEnrollmentButton.disabled = false;
    }
}

function renderHistoryTable(data) {
    if (!data.rows?.length) {
        els.historyTableWrap.innerHTML = `<div class="empty-state">ไม่มีข้อมูล ${escapeHtml(data.type?.toUpperCase() || "")}</div>`;
        return;
    }

    els.historyTableWrap.innerHTML = `
        <table>
            <thead>
                <tr>${data.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>
            </thead>
            <tbody>
                ${data.rows.map((row) => `
                    <tr>
                        ${data.columns.map((column) => {
                            const value = row[column];
                            const text = column === "date"
                                ? formatDate(value)
                                : formatBoolean(value);
                            return `<td>${escapeHtml(text)}</td>`;
                        }).join("")}
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function updateWsGraphButtonVisibility() {
    const canShow = Boolean(state.selectedStudentId && state.historyType === "ws");

    els.wsGraphButton.classList.toggle("hidden", !canShow);
    els.wsGraphButton.disabled = !canShow;
}

function subjectColor(subjectCode) {
    return {
        ME: "#2563eb",
        EFL: "#0f8a5f",
        TRP: "#d97706"
    }[subjectCode] || "#64748b";
}

function monthYearLabel(dateText) {
    const [year, month] = String(dateText || "").slice(0, 7).split("-");

    if (!year || !month) {
        return "";
    }

    return `${month}/${String(year).slice(-2)}`;
}

// Only used for range "all" now — the numbered ranges (3/6/12) get a fixed
// window with one tick per real calendar month instead (see
// monthStartsInRange), so there's no need to thin those out.
function wsGraphTickLimit(totalTicks) {
    return Math.min(6, totalTicks);
}

function pickEvenlySpacedTicks(ticks, maxTicks) {
    if (ticks.length <= maxTicks) {
        return ticks;
    }

    if (maxTicks <= 1) {
        return ticks.slice(0, 1);
    }

    const pickedIndexes = new Set();

    for (let index = 0; index < maxTicks; index += 1) {
        const rawIndex = Math.round((index * (ticks.length - 1)) / (maxTicks - 1));
        let tickIndex = rawIndex;

        while (pickedIndexes.has(tickIndex) && tickIndex < ticks.length - 1) {
            tickIndex += 1;
        }

        while (pickedIndexes.has(tickIndex) && tickIndex > 0) {
            tickIndex -= 1;
        }

        pickedIndexes.add(tickIndex);
    }

    return [...pickedIndexes]
        .sort((left, right) => left - right)
        .map((index) => ticks[index]);
}

function localDateTime(dateText) {
    return new Date(`${dateText}T00:00:00`).getTime();
}

function isoDateFromTime(time) {
    const date = new Date(time);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

// N months before `time`, day-of-month clamped to whatever the target month
// actually has (plain Date#setMonth rolls Mar 31 - 1 month into early April
// instead of clamping to Feb 28/29 — this avoids that).
function monthsAgo(time, months) {
    const from = new Date(time);
    const targetMonthIndex = from.getMonth() - months;
    const target = new Date(from.getFullYear(), targetMonthIndex, 1);
    const daysInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();

    target.setDate(Math.min(from.getDate(), daysInTargetMonth));

    return target.getTime();
}

// One tick per calendar-month boundary that falls inside [minDate, maxDate]
// — used for a fixed N-month window so the grid always reads "one column per
// month" regardless of how much (or little) WS data the student actually has
// in that window.
function monthStartsInRange(minDate, maxDate) {
    const ticks = [];
    const first = new Date(minDate);
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1);

    while (cursor.getTime() <= maxDate) {
        if (cursor.getTime() >= minDate) {
            ticks.push({ date: isoDateFromTime(cursor.getTime()) });
        }

        cursor.setMonth(cursor.getMonth() + 1);
    }

    return ticks;
}

function academicYearForTime(time) {
    const date = new Date(time);
    const month = date.getMonth() + 1;

    return month >= 5 ? date.getFullYear() : date.getFullYear() - 1;
}

const STANDARD_PLAN_LEVEL_ORDER = [
    "7A",
    "6A",
    "5A",
    "4A",
    "3A",
    "2A",
    "AI",
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O"
];

const TRP_PLAN_LEVEL_ORDER = [
    "AI",
    "AII",
    "BI",
    "BII",
    "CI",
    "CII",
    "DI",
    "DII",
    "EI",
    "EII",
    "FI",
    "FII",
    "GI",
    "GII",
    "HI",
    "HII",
    "I",
    "II",
    "III"
];

const TRP_PLAN_GRADE_RANGES = {
    1: { startLevelCode: "AI", endLevelCode: "AII", endWorksheetNo: 191 },
    2: { startLevelCode: "BI", endLevelCode: "BII", endWorksheetNo: 191 },
    3: { startLevelCode: "CI", endLevelCode: "CII", endWorksheetNo: 191 },
    4: { startLevelCode: "DI", endLevelCode: "DII", endWorksheetNo: 191 },
    5: { startLevelCode: "EI", endLevelCode: "EII", endWorksheetNo: 191 },
    6: { startLevelCode: "FI", endLevelCode: "FII", endWorksheetNo: 191 },
    7: { startLevelCode: "GI", endLevelCode: "GII", endWorksheetNo: 191 },
    8: { startLevelCode: "HI", endLevelCode: "HII", endWorksheetNo: 191 },
    9: { startLevelCode: "II", endLevelCode: "III", endWorksheetNo: 191 }
};

function trpPlanRangeForGrade(grade) {
    const range = TRP_PLAN_GRADE_RANGES[grade];

    if (!range) {
        return null;
    }

    return {
        ...range,
        planTrack: "TRP",
        planGradeIndex: grade
    };
}

function planLevelRangeForSchoolClass(subjectCode) {
    const schoolClass = String(state.profile?.student?.schoolClass || "");
    const compactClass = schoolClass.replace(/\s+/g, "");
    const subject = String(subjectCode || selectedEnrollment()?.subjectCode || "").toUpperCase();
    const isEfl = subject === "EFL";
    const isTrp = subject === "TRP";

    if (/เตรียม/.test(compactClass)) {
        if (isTrp) {
            return null;
        }

        return { startLevelCode: isEfl ? "7A" : "6A", endLevelCode: "4A", endWorksheetNo: 1 };
    }

    const kindergarten = compactClass.match(/(?:อ\.?|อนุบาล)([1-3])/);

    if (kindergarten) {
        if (isTrp) {
            return null;
        }

        return {
            1: { startLevelCode: "4A", endLevelCode: "3A", endWorksheetNo: 1 },
            2: { startLevelCode: "3A", endLevelCode: "2A", endWorksheetNo: 1 },
            3: { startLevelCode: "2A", endLevelCode: "A", endWorksheetNo: 1 }
        }[Number(kindergarten[1])] || null;
    }

    const primary = compactClass.match(/(?:ป\.?|ประถม|p)([1-6])/i);

    if (primary) {
        if (isTrp) {
            return trpPlanRangeForGrade(Number(primary[1]));
        }

        return {
            1: { startLevelCode: "A", endLevelCode: "B", endWorksheetNo: 1 },
            2: { startLevelCode: "B", endLevelCode: "C", endWorksheetNo: 1 },
            3: { startLevelCode: "C", endLevelCode: "D", endWorksheetNo: 1 },
            4: { startLevelCode: "D", endLevelCode: "E", endWorksheetNo: 1 },
            5: { startLevelCode: "E", endLevelCode: "F", endWorksheetNo: 1 },
            6: { startLevelCode: "F", endLevelCode: "G", endWorksheetNo: 1 }
        }[Number(primary[1])] || null;
    }

    const secondary = compactClass.match(/(?:ม\.?|มัธยม|m)([1-6])/i);

    if (secondary) {
        if (isTrp) {
            return trpPlanRangeForGrade(Number(secondary[1]) + 6);
        }

        return {
            1: { startLevelCode: "G", endLevelCode: "H", endWorksheetNo: 1 },
            2: { startLevelCode: "H", endLevelCode: "I", endWorksheetNo: 1 },
            3: { startLevelCode: "I", endLevelCode: "J", endWorksheetNo: 1 },
            4: { startLevelCode: "J", endLevelCode: "L", endWorksheetNo: 1 },
            5: { startLevelCode: "L", endLevelCode: "N", endWorksheetNo: 1 },
            6: { startLevelCode: "N", endLevelCode: "O", endWorksheetNo: 191 }
        }[Number(secondary[1])] || null;
    }

    return null;
}

function levelSortValue(levelCode, subjectCode) {
    const code = String(levelCode || "").toUpperCase();
    const order = String(subjectCode || "").toUpperCase() === "TRP"
        ? TRP_PLAN_LEVEL_ORDER
        : STANDARD_PLAN_LEVEL_ORDER;
    const index = order.indexOf(code);

    return index >= 0 ? index : 999;
}

function planLevelCodesBetween(subjectCode, startLevelCode, endLevelCode) {
    const order = String(subjectCode || "").toUpperCase() === "TRP"
        ? TRP_PLAN_LEVEL_ORDER
        : STANDARD_PLAN_LEVEL_ORDER;
    const startIndex = order.indexOf(String(startLevelCode || "").toUpperCase());
    const endIndex = order.indexOf(String(endLevelCode || "").toUpperCase());

    if (startIndex < 0 || endIndex < 0) {
        return [startLevelCode, endLevelCode].filter(Boolean);
    }

    const from = Math.min(startIndex, endIndex);
    const to = Math.max(startIndex, endIndex);

    return order.slice(from, to + 1);
}

function shiftPlanSegment(subjectCode, planRange, yearOffset) {
    if (String(subjectCode || "").toUpperCase() === "TRP" && planRange?.planGradeIndex) {
        return TRP_PLAN_GRADE_RANGES[planRange.planGradeIndex + yearOffset] || null;
    }

    const order = STANDARD_PLAN_LEVEL_ORDER;
    const startIndex = order.indexOf(String(planRange.startLevelCode || "").toUpperCase());
    const endIndex = order.indexOf(String(planRange.endLevelCode || "").toUpperCase());

    if (startIndex < 0 || endIndex < 0) {
        return null;
    }

    // Chain every year onto the current bracket's own pace (its
    // start->end span) rather than shifting both endpoints by 1 level
    // index each. Shifting both by a flat 1 only stays continuous across
    // the May 1st year boundary when the current bracket spans exactly 1
    // level — true for most school years, but เตรียมอนุบาล spans 2
    // (6A->4A) and similar brackets don't — so past/future segments would
    // land a level away from where the adjacent segment ends, and the
    // dashed plan line visibly jumps at each boundary instead of
    // connecting. Scaling the shift by the span keeps every segment's end
    // exactly equal to the next segment's start, by construction.
    const span = endIndex - startIndex;
    const shiftedStartIndex = startIndex + (yearOffset * span);
    const shiftedEndIndex = shiftedStartIndex + span;

    if (
        shiftedStartIndex < 0 || shiftedStartIndex >= order.length
        || shiftedEndIndex < 0 || shiftedEndIndex >= order.length
    ) {
        return null;
    }

    return {
        startLevelCode: order[shiftedStartIndex],
        endLevelCode: order[shiftedEndIndex],
        endWorksheetNo: planRange.endWorksheetNo || 1
    };
}

function planSegmentsForRange(subjectCode, planRange, minTime, maxTime) {
    if (!planRange?.startLevelCode || !planRange?.endLevelCode) {
        return [];
    }

    const currentAcademicYear = academicYearForTime(Date.now());
    const startAcademicYear = academicYearForTime(minTime);
    const endAcademicYear = academicYearForTime(maxTime);
    const segments = [];

    for (let year = startAcademicYear; year <= endAcademicYear; year += 1) {
        const yearOffset = year - currentAcademicYear;
        const shiftedRange = shiftPlanSegment(subjectCode, planRange, yearOffset);

        if (!shiftedRange) {
            continue;
        }

        segments.push({
            academicYear: year,
            startDate: `${year}-05-01`,
            endDate: `${year + 1}-04-30`,
            startLevelCode: shiftedRange.startLevelCode,
            endLevelCode: shiftedRange.endLevelCode,
            endWorksheetNo: shiftedRange.endWorksheetNo || 1
        });
    }

    return segments;
}

function visibleLevelCodesBetween(subjectCode, levels) {
    const order = String(subjectCode || "").toUpperCase() === "TRP"
        ? TRP_PLAN_LEVEL_ORDER
        : STANDARD_PLAN_LEVEL_ORDER;
    const indexes = levels
        .map((level) => order.indexOf(String(level.levelCode || "").toUpperCase()))
        .filter((index) => index >= 0);

    if (!indexes.length) {
        return [];
    }

    return order.slice(Math.min(...indexes), Math.max(...indexes) + 1);
}

function renderWsGraph(data) {
    const rows = data.rows || [];

    const width = 900;
    const height = 430;
    const margin = {
        top: 22,
        right: 28,
        bottom: 52,
        left: 74
    };
    const activeEnrollment = selectedEnrollment();
    const activeSubjectCode = activeEnrollment?.subjectCode || "ME";
    const planRange = planLevelRangeForSchoolClass(activeEnrollment?.subjectCode);
    const dates = rows.map((row) => localDateTime(row.date));
    const hasRows = dates.length > 0;

    if (!dates.length && planRange?.startLevelCode && planRange?.endLevelCode) {
        const fallbackAcademicYear = academicYearForTime(Date.now());

        dates.push(
            localDateTime(`${fallbackAcademicYear}-05-01`),
            localDateTime(`${fallbackAcademicYear + 1}-04-30`)
        );
    }

    if (!dates.length) {
        els.wsGraphWrap.innerHTML = `<div class="empty-state">ยังไม่มีข้อมูล WS และยังทำ Plan ไม่ได้ เพราะไม่พบชั้นเรียนของนักเรียน</div>`;
        return;
    }

    // For a numbered range (3/6/12 months) the X axis is fixed to that full
    // trailing window from today — regardless of how much WS data actually
    // falls inside it — instead of stretching to fit just whatever dates the
    // student happens to have. "all" has no natural fixed window, so it
    // keeps auto-fitting to the data's own span like before.
    const requestedRange = data.range || state.wsGraphRange;
    const fixedRangeMonths = ["3", "6", "12"].includes(String(requestedRange))
        ? Number(requestedRange)
        : null;
    let minDate;
    let maxDate;

    if (fixedRangeMonths) {
        maxDate = localDateTime(isoDateFromTime(Date.now()));
        minDate = monthsAgo(maxDate, fixedRangeMonths);
    } else {
        minDate = Math.min(...dates);
        maxDate = Math.max(...dates);
    }

    const planSegments = planSegmentsForRange(activeSubjectCode, planRange, minDate, maxDate);
    const levelFirstDate = new Map();

    rows.forEach((row) => {
        const key = `${row.enrollmentId}-${row.levelMasterId || row.levelCode}`;
        const current = levelFirstDate.get(key);
        const time = localDateTime(row.date);

        if (!current || time < current.time) {
            levelFirstDate.set(key, {
                key,
                time,
                levelCode: row.levelCode,
                subjectCode: row.subjectCode,
                enrollmentId: row.enrollmentId
            });
        }
    });
    let levelOrder = [...levelFirstDate.values()]
        .sort((a, b) => a.time - b.time || String(a.levelCode).localeCompare(String(b.levelCode)))
        .map((item, index) => [item.key, index]);
    const levelIndexByKey = new Map(levelOrder);
    const levelLabels = [...levelFirstDate.values()]
        .sort((a, b) => (levelIndexByKey.get(a.key) || 0) - (levelIndexByKey.get(b.key) || 0));
    const ensurePlanLevel = (levelCode) => {
        if (!levelCode || levelLabels.some((level) => level.levelCode === levelCode)) {
            return;
        }

        const key = `plan-${levelCode}`;
        levelIndexByKey.set(key, levelLabels.length);
        levelLabels.push({
            key,
            levelCode,
            subjectCode: activeEnrollment?.subjectCode || "ME",
            enrollmentId: "plan"
        });
    };
    planSegments.forEach((segment) => {
        planLevelCodesBetween(activeSubjectCode, segment.startLevelCode, segment.endLevelCode)
            .forEach((levelCode) => ensurePlanLevel(levelCode));
    });
    visibleLevelCodesBetween(activeSubjectCode, levelLabels)
        .forEach((levelCode) => ensurePlanLevel(levelCode));
    levelLabels.sort((a, b) =>
        levelSortValue(a.levelCode, activeSubjectCode) - levelSortValue(b.levelCode, activeSubjectCode)
        || String(a.levelCode).localeCompare(String(b.levelCode))
    );
    levelIndexByKey.clear();
    levelLabels.forEach((level, index) => {
        levelIndexByKey.set(level.key, index);
    });
    const maxProgress = Math.max(191, (levelLabels.length - 1) * 200 + 191);
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const progressValue = (row) => {
        const key = `${row.enrollmentId}-${row.levelMasterId || row.levelCode}`;
        const levelIndex = levelIndexByKey.get(key) || 0;

        return levelIndex * 200 + Number(row.worksheetNo || 1);
    };
    const xForDate = (dateText) => {
        const time = localDateTime(dateText);

        if (maxDate === minDate) {
            return margin.left + plotWidth / 2;
        }

        return margin.left + ((time - minDate) / (maxDate - minDate)) * plotWidth;
    };
    const yForProgress = (value) =>
        margin.top + plotHeight - ((Number(value) - 1) / (maxProgress - 1)) * plotHeight;
    const planProgressForTime = (time, segment) => {
        const planStartTime = localDateTime(segment.startDate);
        const planEndTime = localDateTime(segment.endDate);
        const ratio = Math.min(1, Math.max(0, (time - planStartTime) / (planEndTime - planStartTime)));
        const currentKey = levelLabels.find((level) => level.levelCode === segment.startLevelCode)?.key;
        const nextKey = levelLabels.find((level) => level.levelCode === segment.endLevelCode)?.key;

        if (!currentKey || !nextKey) {
            return null;
        }

        const currentIndex = levelIndexByKey.get(currentKey) || 0;
        const nextIndex = levelIndexByKey.get(nextKey) || 0;
        const startProgress = currentIndex * 200 + 1;
        const endProgress = nextIndex * 200 + (segment.endWorksheetNo || 1);

        return startProgress + (endProgress - startProgress) * ratio;
    };
    const yTicks = levelLabels.flatMap((level, index) => [
        {
            value: index * 200 + 1,
            label: `${level.levelCode}1`
        }
    ]);
    let monthTicks;

    if (fixedRangeMonths) {
        // Fixed window — one grid line per real calendar month it spans,
        // whether or not the student has any WS records in that month.
        monthTicks = monthStartsInRange(minDate, maxDate);
    } else {
        const monthTickRows = [...rows];

        if (!hasRows && planSegments.length) {
            const firstSegment = planSegments[0];
            const lastSegment = planSegments[planSegments.length - 1];

            monthTickRows.push(
                { date: firstSegment.startDate },
                { date: lastSegment.endDate }
            );
        }

        const allMonthTicks = [...new Map(monthTickRows.map((row) => [
            String(row.date).slice(0, 7),
            row
        ])).values()];

        monthTicks = pickEvenlySpacedTicks(allMonthTicks, wsGraphTickLimit(allMonthTicks.length));
    }
    const grouped = new Map();

    rows.forEach((row) => {
        const key = `${row.enrollmentId}-${row.worksheetType}`;

        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push(row);
    });

    const lines = [...grouped.values()].map((groupRows) => {
        const points = groupRows
            .map((row) => `${xForDate(row.date).toFixed(1)},${yForProgress(progressValue(row)).toFixed(1)}`)
            .join(" ");
        const color = subjectColor(groupRows[0]?.subjectCode);

        return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2" opacity="0.42" />`;
    }).join("");
    const planLine = planSegments.length
        ? planSegments.map((segment) => {
            const currentKey = levelLabels.find((level) => level.levelCode === segment.startLevelCode)?.key;
            const nextKey = levelLabels.find((level) => level.levelCode === segment.endLevelCode)?.key;

            if (!currentKey || !nextKey) {
                return "";
            }

            const planStartTime = localDateTime(segment.startDate);
            const planEndTime = localDateTime(segment.endDate);
            const visibleStartTime = Math.max(minDate, planStartTime);
            const visibleEndTime = Math.min(maxDate, planEndTime);

            if (visibleEndTime < visibleStartTime) {
                return "";
            }

            const startDate = isoDateFromTime(visibleStartTime);
            const endDate = isoDateFromTime(visibleEndTime);
            const startProgress = planProgressForTime(visibleStartTime, segment);
            const endProgress = planProgressForTime(visibleEndTime, segment);

            if (startProgress === null || endProgress === null) {
                return "";
            }

            const startX = xForDate(startDate);
            const endX = xForDate(endDate);
            const startY = yForProgress(startProgress);
            const endY = yForProgress(endProgress);

            return `
                <line x1="${startX.toFixed(1)}" y1="${startY.toFixed(1)}" x2="${endX.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="#dc2626" stroke-width="2.5" stroke-dasharray="8 5"></line>
                <circle cx="${startX.toFixed(1)}" cy="${startY.toFixed(1)}" r="4" fill="#dc2626"></circle>
                <circle cx="${endX.toFixed(1)}" cy="${endY.toFixed(1)}" r="4" fill="#dc2626"></circle>
            `;
        }).join("")
        : "";
    const points = rows.map((row) => {
        const color = row.isKumonConnect ? "#7c3aed" : subjectColor(row.subjectCode);
        const label = `${row.subjectCode} ${row.levelCode}${row.worksheetNo} • ${formatDate(row.date)}${row.isKumonConnect ? " • KC" : ""}`;

        return `
            <circle
                cx="${xForDate(row.date).toFixed(1)}"
                cy="${yForProgress(progressValue(row)).toFixed(1)}"
                r="${row.cpws ? 4.5 : 3.6}"
                fill="${color}"
                opacity="${row.isStockProcessed ? "0.62" : "0.95"}"
            >
                <title>${escapeHtml(label)}</title>
            </circle>
        `;
    }).join("");
    const legendSubjects = [...new Set(rows.map((row) => row.subjectCode))];

    els.wsGraphWrap.innerHTML = `
        <svg class="ws-graph-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="WS graph">
            <rect x="0" y="0" width="${width}" height="${height}" rx="10" fill="#ffffff"></rect>
            ${yTicks.map((tick) => `
                <line x1="${margin.left}" y1="${yForProgress(tick.value).toFixed(1)}" x2="${width - margin.right}" y2="${yForProgress(tick.value).toFixed(1)}" stroke="#e2e8f0"></line>
                <text x="${margin.left - 12}" y="${(yForProgress(tick.value) + 4).toFixed(1)}" text-anchor="end">${escapeHtml(tick.label)}</text>
            `).join("")}
            ${monthTicks.map((row) => `
                <line x1="${xForDate(row.date).toFixed(1)}" y1="${margin.top}" x2="${xForDate(row.date).toFixed(1)}" y2="${height - margin.bottom}" stroke="#e2e8f0" stroke-width="1" opacity="0.72"></line>
                <text x="${xForDate(row.date).toFixed(1)}" y="${height - 18}" text-anchor="middle">${escapeHtml(monthYearLabel(row.date))}</text>
            `).join("")}
            <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" stroke="#94a3b8"></line>
            <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" stroke="#94a3b8"></line>
            ${planLine}
            ${lines}
            ${points}
        </svg>
        <div class="ws-graph-legend">
            ${legendSubjects.map((subject) => `
                <span><i style="background:${subjectColor(subject)}"></i>${escapeHtml(subject)}</span>
            `).join("")}
            ${rows.some((row) => row.isKumonConnect) ? `<span><i style="background:#7c3aed"></i>KC</span>` : ""}
            ${planLine ? `<span><i style="background:#dc2626"></i>Plan</span>` : ""}
            <span>รวม ${rows.length} records</span>
        </div>
        ${planLine ? `<div class="ws-graph-plan-note">Plan: ชั้น ${escapeHtml(state.profile.student.schoolClass)} เดินหน้า/ถอยหลังปีละ 1 level ตามช่วง WS ที่แสดง</div>` : ""}
    `;
}

async function loadWsGraph() {
    if (!state.selectedStudentId) {
        return;
    }

    els.wsGraphWrap.innerHTML = `<div class="empty-state">กำลังโหลดกราฟ...</div>`;
    const params = new URLSearchParams({
        range: state.wsGraphRange
    });

    if (state.selectedEnrollmentId) {
        params.set("enrollmentId", String(state.selectedEnrollmentId));
    }

    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(state.selectedStudentId)}/ws-graph?${params.toString()}`
        );
        const enrollment = selectedEnrollment();
        const rangeLabel = state.wsGraphRange === "all"
            ? "ทั้งหมด"
            : `${state.wsGraphRange} เดือน`;

        els.wsGraphSubtitle.textContent = `${enrollment ? `${enrollment.subjectCode} #${enrollment.enrollmentId}` : "ทุกวิชา"} • ${rangeLabel} • ${data.rows.length} records`;
        renderWsGraph(data);
    } catch (error) {
        els.wsGraphWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
}

function openWsGraphModal() {
    if (!state.selectedStudentId) {
        return;
    }

    els.wsGraphModal.classList.remove("hidden");
    loadWsGraph();
}

function closeWsGraphModal() {
    els.wsGraphModal.classList.add("hidden");
}

async function loadHistory() {
    if (!state.selectedStudentId) {
        return;
    }

    els.historySubtitle.textContent = "กำลังโหลด...";
    updateWsGraphButtonVisibility();
    const params = new URLSearchParams({
        type: state.historyType
    });

    if (state.selectedEnrollmentId) {
        params.set("enrollmentId", String(state.selectedEnrollmentId));
    }

    const data = await requestJson(
        `/api/students/${encodeURIComponent(state.selectedStudentId)}/history?${params.toString()}`
    );

    els.historySubtitle.textContent = `ล่าสุด ${data.rows.length} รายการ`;
    renderHistoryTable(data);
}

function startNewEnrollment() {
    if (!state.selectedStudentId) {
        return;
    }

    if ((state.profile?.enrollments || []).length >= 3) {
        setStatus("เด็กคนนี้เรียนครบ 3 วิชาแล้ว เพิ่มวิชาไม่ได้", "error");
        return;
    }

    fillAddEnrollmentDefaults();
    els.addEnrollmentModal.classList.remove("hidden");
}

function closeAddEnrollmentModal() {
    els.addEnrollmentModal.classList.add("hidden");
    state.addEnrollmentValidationActive = false;
    setAddEnrollmentMessage();
}

async function saveNewEnrollment(event) {
    event.preventDefault();

    if (!state.selectedStudentId) {
        return;
    }

    if (!validateAddEnrollmentForm()) {
        return;
    }

    const values = readForm(els.addEnrollmentForm);
    const payload = {
        subjectId: values.subjectId,
        kumonStudentId: "",
        currentLevelMasterId: values.currentLevelMasterId,
        currentZunLevelMasterId: resolveAddZunLevelId(values.currentZunLevelMasterId),
        startingWorksheetMasterId: values.startingWorksheetMasterId,
        enStartDate: values.enStartDate,
        currentStatusGroup1Id: values.currentStatusGroup1Id,
        currentStatusGroup2Id: values.currentStatusGroup2Id,
        isKumonConnect: values.isKumonConnect,
        openingScheduleId1: values.openingScheduleId1,
        openingScheduleId2: values.openingScheduleId2,
        remark: values.remark,
        dt: values.dtMasterId ? {
            dtMasterId: values.dtMasterId,
            dtDate: values.dtDate,
            score: values.score,
            usedTime: values.usedTime
        } : {}
    };

    setAddEnrollmentMessage("กำลังเพิ่มวิชา...");
    els.addEnrollmentSave.disabled = true;

    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(state.selectedStudentId)}/enrollments`,
            {
                method: "POST",
                body: JSON.stringify(payload)
            }
        );

        state.profile = data.profile;
        state.selectedEnrollmentId = data.enrollmentId;
        closeAddEnrollmentModal();
        renderProfile();
        await loadStudents();
        await loadHistory();
        setAddEnrollmentMessage();
        setStatus("เพิ่มวิชาแล้ว");
    } catch (error) {
        setAddEnrollmentMessage(error.message, "error");
    } finally {
        els.addEnrollmentSave.disabled = false;
    }
}

function bindEvents() {
    els.studentSearch.addEventListener("input", queueStudentSearch);
    bindSelectAllInput(els.studentSearch, queueStudentSearch);
    els.statusFilter.addEventListener("change", () => {
        loadStudents().catch((error) => setStatus(error.message, "error"));
    });
    els.studentList.addEventListener("click", (event) => {
        const button = event.target.closest("[data-student-id]");

        if (button) {
            loadProfile(button.dataset.studentId, {
                preferredEnrollmentId: button.dataset.preferredEnrollmentId
            })
                .catch((error) => setStatus(error.message, "error"));
        }
    });
    els.newStudentButton.addEventListener("click", startNewStudent);
    els.deleteStudentButton.addEventListener("click", deleteSelectedStudent);
    els.addStudentForm.addEventListener("submit", saveNewStudent);
    els.addStudentCancel.addEventListener("click", closeAddStudentModal);
    els.addStudentClose.addEventListener("click", closeAddStudentModal);
    els.copyAddressSearchButton.addEventListener("click", searchCopyAddressStudents);
    els.copyAddressApplyButton.addEventListener("click", copyAddressFromSelectedStudent);
    bindSelectAllInput(els.copyAddressSearch);
    els.copyAddressSearch.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            searchCopyAddressStudents();
        }
    });
    els.copyAddressStudentSelect.addEventListener("change", () => {
        els.copyAddressApplyButton.disabled = !els.copyAddressStudentSelect.value;
    });
    els.addStudentModal.addEventListener("mousedown", (event) => {
        if (event.target === els.addStudentModal) {
            closeAddStudentModal();
        }
    });
    els.addStudentForm.addEventListener("input", (event) => {
        clearFieldError(event.target);
        if (event.target.name === "mobile") {
            formatMobileField(event.target);
        }
        if ([
            "addressZipcode",
            "addressNumber",
            "addressVillage",
            "addressAlley",
            "addressRoad",
            "remark"
        ].includes(event.target.name)) {
            setAutoFilled(els.addStudentForm, event.target.name, false);
        }
        if (event.target.name === "addressZipcode") {
            formatZipcodeField(event.target);
        }
        if (["firstName", "lastName"].includes(event.target.name)) {
            queueAddStudentDuplicateCheck();
        }
        if (["addressZipcode", "addressProvince", "addressDistrict", "addressSubdistrict"].includes(event.target.name)) {
            updateAddStudentAddressHints(event.target.name);
        }
        if (state.addStudentValidationActive) {
            showAddStudentCurrentCheck();
        }
    });
    els.studentForm.elements.mobile.addEventListener("input", (event) => {
        formatMobileField(event.target);
    });
    els.studentForm.elements.addressZipcode.addEventListener("input", (event) => {
        formatZipcodeField(event.target);
    });
    els.addStudentForm.addEventListener("change", (event) => {
        clearFieldError(event.target);
        if (event.target.name === "prefixId") {
            updateAddStudentGenderFromPrefix();
        } else if (event.target.name === "genderId") {
            setAutoFilled(els.addStudentForm, "genderId", false);
        } else if (["addressProvince", "addressDistrict", "addressSubdistrict"].includes(event.target.name)) {
            setAutoFilled(els.addStudentForm, event.target.name, false);
        }
        if (["firstName", "lastName"].includes(event.target.name)) {
            queueAddStudentDuplicateCheck();
        }
        if (["addressZipcode", "addressProvince", "addressDistrict", "addressSubdistrict"].includes(event.target.name)) {
            updateAddStudentAddressHints(event.target.name);
        }
        if (state.addStudentValidationActive) {
            showAddStudentCurrentCheck();
        }
    });
    els.studentForm.addEventListener("submit", saveStudent);
    els.newEnrollmentButton.addEventListener("click", startNewEnrollment);
    els.enrollmentAbsentButton.addEventListener("click", () => runEnrollmentStatusAction("absent"));
    els.enrollmentResumeButton.addEventListener("click", runEnrollmentResumeAction);
    els.enrollmentCompleterButton.addEventListener("click", () => runEnrollmentStatusAction("completer"));
    els.enrollmentOtButton.addEventListener("click", () => runEnrollmentStatusAction("outgoingTransfer"));
    els.deleteEnrollmentButton.addEventListener("click", deleteSelectedEnrollment);
    els.addEnrollmentForm.addEventListener("submit", saveNewEnrollment);
    els.addEnrollmentForm.addEventListener("input", (event) => {
        clearFieldError(event.target);
        if (state.addEnrollmentValidationActive) {
            showAddEnrollmentCurrentCheck();
        }
    });
    els.addEnrollmentForm.addEventListener("change", (event) => {
        clearFieldError(event.target);
        if (state.addEnrollmentValidationActive) {
            showAddEnrollmentCurrentCheck();
        }
    });
    els.addEnrollmentCancel.addEventListener("click", closeAddEnrollmentModal);
    els.addEnrollmentClose.addEventListener("click", closeAddEnrollmentModal);
    els.addEnrollmentModal.addEventListener("mousedown", (event) => {
        if (event.target === els.addEnrollmentModal) {
            closeAddEnrollmentModal();
        }
    });
    els.addEnrollmentForm.elements.subjectId.addEventListener("change", refreshAddEnrollmentOptions);
    els.addEnrollmentForm.elements.startingWorksheetMasterId.addEventListener("change", updateAddEnrollmentDerivedFields);
    els.addEnrollmentForm.elements.dtMasterId.addEventListener("change", refreshAddStartingWorksheetFromDt);
    els.addEnrollmentForm.elements.enStartDate.addEventListener("change", updateHalfMonthByStartDate);
    els.addEnrollmentForm.elements.currentStatusGroup2Id.addEventListener("change", () => {
        delete els.addEnrollmentForm.elements.currentStatusGroup2Id.dataset.autoHalfMonth;
        setAutoFilled(els.addEnrollmentForm, "currentStatusGroup2Id", false);
        alignStartDateForHalfMonth();
    });
    ["1", "2"].forEach((slot) => {
        els.addEnrollmentForm.elements[`openingDay${slot}`].addEventListener("change", () => {
            refreshAddOpeningDayOptions({ changedSlot: slot });
            refreshAddOpeningTimeOptions(slot);
            updateAddOpeningSchedule(slot);
        });
        els.addEnrollmentForm.elements[`openingTime${slot}`].addEventListener("change", () => {
            updateAddOpeningSchedule(slot);
        });
    });
    els.enrollmentTabs.addEventListener("click", (event) => {
        const button = event.target.closest("[data-enrollment-id]");

        if (!button) {
            return;
        }

        state.selectedEnrollmentId = Number(button.dataset.enrollmentId);
        state.isNewEnrollment = false;
        renderEnrollmentTabs();
        loadHistory().catch((error) => setStatus(error.message, "error"));
    });
    els.enrollmentForm.addEventListener("submit", saveEnrollment);
    els.enrollmentForm.elements.subjectId.addEventListener("change", () => {
        refreshLevelSelects();
    });
    els.enrollmentForm.elements.currentLevelMasterId.addEventListener("change", () => {
        refreshLevelSelects({
            keepLevel: true,
            keepZun: true
        });
    });
    els.historyTabs.addEventListener("click", (event) => {
        const button = event.target.closest("[data-history]");

        if (!button) {
            return;
        }

        state.historyType = button.dataset.history;
        els.historyTabs.querySelectorAll(".history-tab").forEach((item) => {
            item.classList.toggle("active", item === button);
        });
        updateWsGraphButtonVisibility();
        loadHistory().catch((error) => setStatus(error.message, "error"));
    });
    els.wsGraphButton.addEventListener("click", openWsGraphModal);
    els.wsGraphClose.addEventListener("click", closeWsGraphModal);
    els.wsGraphModal.addEventListener("mousedown", (event) => {
        if (event.target === els.wsGraphModal) {
            closeWsGraphModal();
        }
    });
    els.wsGraphModal.addEventListener("click", (event) => {
        const button = event.target.closest("[data-ws-graph-range]");

        if (!button) {
            return;
        }

        state.wsGraphRange = button.dataset.wsGraphRange;
        els.wsGraphModal.querySelectorAll("[data-ws-graph-range]").forEach((item) => {
            item.classList.toggle("active", item === button);
        });
        loadWsGraph();
    });
}

async function init() {
    try {
        bindFourDigitYearDateInputs(document);
        const data = await requestJson("/api/students/masters");

        state.masters = data.masters;
        fillMasterSelects();
        bindEvents();
        await loadStudents();
        const firstStudent = state.students[0];

        if (firstStudent) {
            await loadProfile(firstStudent.studentId);
        } else {
            startNewStudent();
        }
    } catch (error) {
        setStatus(error.message, "error");
    }
}

init();
