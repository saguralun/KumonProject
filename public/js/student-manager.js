import { bindFourDigitYearDateInputs } from "./dateInputYear.js";
import { bindKsisImport, resetKsisImport } from "./studentKsisImport.js";
import { closeWsGraphModal, loadWsGraph, openWsGraphModal, updateWsGraphButtonVisibility } from "./studentWsGraph.js";
import {
    bindSelectAllInput,
    clearAutoFilled,
    clearFieldError,
    clearFormErrors,
    escapeHtml,
    formatBoolean,
    formatDate,
    formatMobileField,
    formatZipcodeField,
    readForm,
    requestJson,
    setAddEnrollmentMessage,
    setAddStudentMessage,
    setAutoFilled,
    setFormValue,
    setStatus
} from "./studentFormUtil.js";
import { resolveAddZunLevelId, zunValueForLevelId } from "./studentMasters.js";
import {
    alignStartDateForHalfMonth,
    fillAddEnrollmentDefaults,
    fillMasterSelects,
    refreshAddEnrollmentOptions,
    refreshAddOpeningDayOptions,
    refreshAddOpeningTimeOptions,
    refreshAddStartingWorksheetFromDt,
    refreshLevelSelects,
    setEnrollmentLocked,
    showAddEnrollmentCurrentCheck,
    updateAddEnrollmentDerivedFields,
    updateAddOpeningSchedule,
    updateHalfMonthByStartDate,
    validateAddEnrollmentForm
} from "./studentAddEnrollment.js";
import {
    checkAddStudentDuplicateNow,
    copyAddressFromSelectedStudent,
    queueAddStudentDuplicateCheck,
    resetCopyAddressTool,
    searchCopyAddressStudents,
    showAddStudentCurrentCheck,
    updateAddStudentAddressHints,
    updateAddStudentGenderFromPrefix,
    validateAddStudentForm
} from "./studentAddStudent.js";

export const els = {
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
    enrollmentResumeDialog: document.getElementById('enrollmentResumeDialog'),
    enrollmentResumeForm: document.getElementById('enrollmentResumeForm'),
    enrollmentResumeDate: document.getElementById('enrollmentResumeDate'),
    enrollmentResumeDateField: document.getElementById('enrollmentResumeDateField'),
    enrollmentResumeTitle: document.getElementById('enrollmentResumeTitle'),
    enrollmentResumeStudent: document.getElementById('enrollmentResumeStudent'),
    enrollmentResumeError: document.getElementById('enrollmentResumeError'),
    enrollmentResumeCancel: document.getElementById('enrollmentResumeCancel'),
    enrollmentResumeSave: document.getElementById('enrollmentResumeSave'),
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
    ksisStudentUrl: document.getElementById("ksisStudentUrl"),
    ksisPreviewButton: document.getElementById("ksisPreviewButton"),
    ksisApplyButton: document.getElementById("ksisApplyButton"),
    ksisImportStatus: document.getElementById("ksisImportStatus"),
    ksisPreview: document.getElementById("ksisPreview"),
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

export const state = {
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

let resumeTarget = null, resumeBusy = false;
let studentMutationBusy = false, profileLoading = false, profileLoadFailed = false;
let profileRequest = 0, studentsRequest = 0, historyRequest = 0;
const pendingCdReturns = new Set();

function syncStudentControls() {
    const blocked = studentMutationBusy || profileLoading || profileLoadFailed;
    const enrollment = selectedEnrollment();
    els.studentSearch.disabled = els.statusFilter.disabled = studentMutationBusy;
    els.studentForm.inert = els.enrollmentForm.inert = blocked;
    els.addStudentForm.inert = els.addEnrollmentForm.inert = studentMutationBusy;
    els.newStudentButton.disabled = els.saveStudentButton.disabled = blocked;
    els.saveEnrollmentButton.disabled = blocked || !enrollment;
    els.deleteEnrollmentButton.disabled = blocked || !enrollment?.canDeleteEnrollment;
    els.enrollmentAbsentButton.disabled = els.enrollmentOtButton.disabled = blocked || enrollment?.statusGroup1Code !== 'C';
    els.enrollmentResumeButton.disabled = blocked || !['A', 'OT'].includes(enrollment?.statusGroup1Code);
    els.enrollmentCompleterButton.disabled = blocked || !enrollment?.canComplete || enrollment?.statusGroup1Code === 'CP';
    for (const button of [els.addStudentSave, els.addStudentCancel, els.addStudentClose,
        els.addEnrollmentSave, els.addEnrollmentCancel, els.addEnrollmentClose]) button.disabled = studentMutationBusy;
    els.newEnrollmentButton.disabled = blocked || !state.selectedStudentId || (state.profile?.enrollments || []).length >= 3;
    els.deleteStudentButton.disabled = blocked || !state.selectedStudentId || Boolean(state.profile?.enrollments?.length);
    for (const button of els.studentList.querySelectorAll('button')) button.disabled = studentMutationBusy;
    for (const button of els.enrollmentTabs.querySelectorAll('button')) button.disabled = blocked;
    for (const button of els.historyTabs.querySelectorAll('button')) button.disabled = blocked;
    for (const button of els.historyTableWrap.querySelectorAll('button')) {
        const pendingCd = button.dataset.returnCdId && pendingCdReturns.has(`${state.selectedStudentId}:${button.dataset.returnCdId}`);
        button.disabled = blocked || Boolean(pendingCd);
    }
}

function setStudentMutationBusy(value) {
    studentMutationBusy = value;
    syncStudentControls();
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
    syncStudentControls();
}

function scrollSelectedStudentIntoView() {
    const activeItem = els.studentList.querySelector(".student-item.active");

    activeItem?.scrollIntoView({ block: "nearest" });
}

async function loadStudents() {
    const requestId = ++studentsRequest;
    const params = new URLSearchParams({
        query: els.studentSearch.value,
        status: els.statusFilter.value,
        limit: "120"
    });
    const data = await requestJson(`/api/students/search?${params.toString()}`);
    if (requestId !== studentsRequest || params.get('query') !== els.studentSearch.value || params.get('status') !== els.statusFilter.value) return;

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

export function defaultEnrollmentDate() {
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
    setFormValue(
        form,
        "currentZunLevelMasterId",
        zunValueForLevelId(enrollment.currentZunLevelMasterId)
    );
    setFormValue(form, "startingWorksheetMasterId", enrollment.startingWorksheetMasterId);
    setFormValue(form, "enStartDate", enrollment.enStartDate);
    setFormValue(form, "openingScheduleId1", enrollment.openingScheduleId1);
    setFormValue(form, "openingScheduleId2", enrollment.openingScheduleId2);
    setFormValue(form, "currentStatusGroup1Id", enrollment.currentStatusGroup1Id);
    setFormValue(form, "currentStatusGroup2Id", enrollment.currentStatusGroup2Id);
    setFormValue(form, "remark", enrollment.remark);
    els.saveEnrollmentButton.textContent = "💾 Save Enrollment";
}

// N/IT/EO/R/C all mean the subject is actively being studied right now
// (just started/transferred in/added/resumed/continuing); A/OT mean it's
// currently paused or left; CP means it's finished — three outcomes worth
// telling apart at a glance on the subject tabs, so each gets its own
// color (see .enrollment-tab.status-* in student-manager.css).
const ENROLLMENT_TAB_STATUS_CLASS = {
    N: "status-active",
    IT: "status-active",
    EO: "status-active",
    R: "status-active",
    C: "status-active",
    A: "status-inactive",
    OT: "status-inactive",
    CP: "status-completer"
};

function enrollmentTabStatusClass(statusGroup1Code) {
    return ENROLLMENT_TAB_STATUS_CLASS[statusGroup1Code] || "";
}

function renderEnrollmentTabs() {
    els.enrollmentAbsentButton.classList.remove("payment-absent-target");
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
        syncStudentControls();
        return;
    }

    els.enrollmentTabs.innerHTML = enrollments.map((enrollment) => `
        <button
            type="button"
            class="enrollment-tab ${enrollmentTabStatusClass(enrollment.statusGroup1Code)} ${Number(enrollment.enrollmentId) === Number(state.selectedEnrollmentId) ? "active" : ""}"
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
    syncStudentControls();
}

function updateDeleteStudentButton() {
    const enrollmentCount = state.profile?.enrollments?.length || 0;
    const canDeleteStudent = Boolean(state.selectedStudentId && enrollmentCount === 0);

    els.deleteStudentButton.classList.toggle("hidden", !canDeleteStudent);
    els.deleteStudentButton.disabled = studentMutationBusy || profileLoading || profileLoadFailed || !canDeleteStudent;
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
    syncStudentControls();
}

async function loadProfile(studentId, {
    preferredEnrollmentId = null
} = {}) {
    if (studentMutationBusy) return;
    const requestId = ++profileRequest;
    profileLoading = true;
    profileLoadFailed = false;
    historyRequest++;
    els.historyTableWrap.innerHTML = `<div class="empty-state">กำลังโหลดข้อมูลเด็ก...</div>`;
    syncStudentControls();
    setStatus("กำลังโหลดข้อมูลเด็ก...");
    try {
        const data = await requestJson(`/api/students/${encodeURIComponent(studentId)}`);
        if (requestId !== profileRequest) return;

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
        if (requestId === profileRequest) setStatus("พร้อมแก้ไข");
    } catch (error) {
        if (requestId === profileRequest) {
            profileLoadFailed = Number(state.profile?.student?.studentId) !== Number(studentId);
            throw error;
        }
    } finally {
        if (requestId === profileRequest) { profileLoading = false; syncStudentControls(); }
    }
}

function startNewStudent() {
    openAddStudentModal();
}

function openAddStudentModal() {
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;
    const form = els.addStudentForm;

    form.reset();
    clearFormErrors(form);
    clearAutoFilled(form);
    state.addStudentValidationActive = false;
    state.addStudentDuplicate = null;
    resetCopyAddressTool();
    resetKsisImport();
    setFormValue(form, "prefixId", state.masters.prefixes[0]?.id || "");
    updateAddStudentGenderFromPrefix();
    updateAddStudentAddressHints();
    setAddStudentMessage();
    els.addStudentModal.classList.remove("hidden");
    setTimeout(() => form.elements.firstName.focus(), 80);
}

function closeAddStudentModal() {
    if (studentMutationBusy) return;
    resetKsisImport();
    els.addStudentModal.classList.add("hidden");
    state.addStudentValidationActive = false;
    state.addStudentDuplicate = null;
    setAddStudentMessage();
}

async function saveNewStudent(event) {
    event.preventDefault();
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;
    setStudentMutationBusy(true);
    try {
        await checkAddStudentDuplicateNow();
        // Validation focuses the first invalid field; release inert before it runs.
        setStudentMutationBusy(false);
        if (!validateAddStudentForm()) return;
        setStudentMutationBusy(true);
        setAddStudentMessage("กำลังเพิ่ม student...");
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
        resetKsisImport();
        els.addStudentModal.classList.add("hidden");
        state.addStudentValidationActive = false;
        state.addStudentDuplicate = null;
        setAddStudentMessage();
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
        setStudentMutationBusy(false);
    }
}

async function deleteSelectedStudent() {
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;
    const student = state.profile?.student;
    const studentId = state.selectedStudentId, requestId = profileRequest;
    const hasEnrollment = (state.profile?.enrollments || []).length > 0;

    if (!student || hasEnrollment) {
        setStatus("ลบได้เฉพาะ student ที่ยังไม่มี enrollment", "error");
        return;
    }

    const ok = await confirmAction(`ลบ student #${student.studentId} ${student.displayName} ใช่ไหม?`);

    if (!ok || studentMutationBusy || profileLoading || profileLoadFailed || requestId !== profileRequest
        || state.selectedStudentId !== studentId || state.profile?.student !== student || state.profile.enrollments?.length) {
        return;
    }

    setStudentMutationBusy(true);
    setStatus("กำลังลบ student...");

    try {
        await requestJson(`/api/students/${encodeURIComponent(studentId)}`, {
            method: "DELETE"
        });
        if (requestId !== profileRequest || state.selectedStudentId !== studentId) return;
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
        setStudentMutationBusy(false);
        updateDeleteStudentButton();
    }
}

async function saveStudent(event) {
    event.preventDefault();
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;
    const studentId = state.selectedStudentId;
    setStudentMutationBusy(true);
    setStatus("กำลังบันทึก student...");

    try {
        const payload = readForm(els.studentForm);
        const data = studentId
            ? await requestJson(`/api/students/${encodeURIComponent(studentId)}`, {
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
    } finally {
        setStudentMutationBusy(false);
    }
}

async function saveEnrollment(event) {
    event.preventDefault();
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;

    if (!state.selectedStudentId) {
        setStatus("กรุณาบันทึก Student ก่อน", "error");
        return;
    }

    setStatus("กำลังบันทึก enrollment...");
    const studentId = state.selectedStudentId;
    setStudentMutationBusy(true);

    try {
        const payload = readForm(els.enrollmentForm);
        // currentZunLevelMasterId comes out of the form as one of
        // zunLevelChoices' composite "levelMasterId:label" values (e.g.
        // "1:ZI1") — same as the "+ Subject" modal — so it needs the same
        // unwrap back to a plain level_master id before it's sent.
        payload.currentZunLevelMasterId = resolveAddZunLevelId(payload.currentZunLevelMasterId);
        const endpoint = `/api/students/${encodeURIComponent(studentId)}/enrollments/${encodeURIComponent(payload.enrollmentId)}`;
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
    } finally {
        setStudentMutationBusy(false);
    }
}

export function selectedEnrollment() {
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

const enrollmentActionLabels = { absent: 'Absent', outgoingTransfer: 'OT', completer: 'Completer', resume: 'Resume' };

function runEnrollmentStatusAction(action) { openEnrollmentStatusDialog(action); }

function runEnrollmentResumeAction() { openEnrollmentStatusDialog('resume'); }

function openEnrollmentStatusDialog(action) {
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;
    const enrollment = selectedEnrollment();

    if (!state.selectedStudentId || !enrollment) {
        setStatus("กรุณาเลือก enrollment ก่อน", "error");
        return;
    }

    if (resumeBusy || els.enrollmentResumeDialog.open) return;
    if (!enrollmentActionLabels[action]) return;
    resumeTarget = { studentId: state.selectedStudentId, enrollmentId: enrollment.enrollmentId, action };
    const resume = action === 'resume';
    els.enrollmentResumeTitle.textContent = resume ? 'กลับมาเรียน (Resume)' : `ยืนยัน ${enrollmentActionLabels[action]}`;
    els.enrollmentResumeSave.textContent = resume ? 'บันทึกกลับมาเรียน' : `ยืนยัน ${enrollmentActionLabels[action]}`;
    els.enrollmentResumeDateField.classList.toggle('hidden', !resume);
    els.enrollmentResumeDate.required = resume;
    els.enrollmentResumeDate.disabled = !resume;
    els.enrollmentResumeStudent.textContent = `${state.profile.student.displayName} • ${enrollment.subjectCode} #${enrollment.enrollmentId}`;
    els.enrollmentResumeDate.value = todayIsoDate();
    els.enrollmentResumeError.textContent = '';
    els.enrollmentResumeError.classList.add('hidden');
    els.enrollmentResumeDialog.showModal();
    if (resume) els.enrollmentResumeDate.focus(); else els.enrollmentResumeCancel.focus();
}

async function saveEnrollmentStatusAction(event) {
    event.preventDefault();
    if (resumeBusy || !resumeTarget || !els.enrollmentResumeForm.reportValidity()) return;
    if (Number(state.selectedStudentId) !== Number(resumeTarget.studentId) || Number(state.selectedEnrollmentId) !== Number(resumeTarget.enrollmentId)) {
        els.enrollmentResumeError.textContent = 'นักเรียนหรือวิชาที่เลือกเปลี่ยนแล้ว กรุณายกเลิกและเปิดรายการใหม่';
        els.enrollmentResumeError.classList.remove('hidden');
        return;
    }
    const { studentId, enrollmentId, action } = resumeTarget;
    const requestId = profileRequest;
    const label = enrollmentActionLabels[action];
    const resumeDate = els.enrollmentResumeDate.value;
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;
    setStudentMutationBusy(true);
    resumeBusy = true;
    els.enrollmentResumeSave.disabled = els.enrollmentResumeCancel.disabled = els.enrollmentResumeDate.disabled = true;
    els.enrollmentResumeError.classList.add('hidden');
    setStatus(`กำลังบันทึก ${label}...`);
    let saved = false;
    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(studentId)}/enrollments/${encodeURIComponent(enrollmentId)}/status-action`,
            {
                method: "POST",
                body: JSON.stringify({
                    action,
                    ...(action === 'resume' ? { resumeDate } : {})
                })
            }
        );
        if (requestId !== profileRequest || state.selectedStudentId !== studentId || state.selectedEnrollmentId !== enrollmentId) return;
        saved = true;
        els.enrollmentResumeDialog.close(); resumeTarget = null;
        state.profile = data.profile;
        state.selectedEnrollmentId = data.enrollmentId;
        renderProfile();
        await loadStudents();
        await loadHistory();
        setStatus(data.message || `บันทึก ${label} แล้ว`);
    } catch (error) {
        const message = saved ? `บันทึก ${label} แล้ว แต่โหลดข้อมูลล่าสุดไม่ครบ: ${error.message}` : error.message;
        els.enrollmentResumeError.textContent = message;
        els.enrollmentResumeError.classList.toggle('hidden', saved);
        setStatus(message, "error");
    } finally {
        resumeBusy = false;
        els.enrollmentResumeSave.disabled = els.enrollmentResumeCancel.disabled = false;
        els.enrollmentResumeDate.disabled = action !== 'resume';
        setStudentMutationBusy(false);
    }
}

async function deleteSelectedEnrollment() {
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;
    const enrollment = selectedEnrollment();
    const studentId = state.selectedStudentId, requestId = profileRequest;

    if (!state.selectedStudentId || !enrollment) {
        setStatus("กรุณาเลือก enrollment ก่อน", "error");
        return;
    }

    const ok = await confirmAction(`ลบ ${enrollment.subjectCode} enrollment #${enrollment.enrollmentId} ใช่ไหม?`);

    if (!ok || studentMutationBusy || profileLoading || profileLoadFailed || requestId !== profileRequest
        || state.selectedStudentId !== studentId || selectedEnrollment() !== enrollment) {
        return;
    }

    setStudentMutationBusy(true);
    setStatus("กำลังลบ subject...");

    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(studentId)}/enrollments/${encodeURIComponent(enrollment.enrollmentId)}`,
            { method: "DELETE" }
        );
        if (requestId !== profileRequest || state.selectedStudentId !== studentId || selectedEnrollment() !== enrollment) return;
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
        setStudentMutationBusy(false);
    }
}

function renderHistoryTable(data) {
    if (!data.rows?.length) {
        els.historyTableWrap.innerHTML = `<div class="empty-state">ไม่มีข้อมูล ${escapeHtml(data.type?.toUpperCase() || "")}</div>`;
        return;
    }

    // Cancelling a receipt reverses billing_detail/enrollment_status/the
    // enrollment's current status in one transaction (see
    // cancelReceiptPayment in services/paymentService.js, same endpoint
    // the Payment page's own Cancel Receipt button uses). Status can only
    // have its history row deleted outright (deleteEnrollmentStatusEntry)
    // — a plain status_action never recorded a "before" snapshot to
    // revert current_status_group1_id to the way a bill does, so staff
    // use the existing Absent/OT/Resume/Complete buttons afterward if the
    // enrollment's actual current status also needs fixing. Both are
    // data-admin-only (not the broader data-staff-up the Absent/OT/Resume
    // buttons above use) since they permanently remove real records.
    const showCancel = data.type === "billing";
    const showDelete = data.type === "status";
    const showReturnCd = data.type === "cd";

    els.historyTableWrap.innerHTML = `
        <table>
            <thead>
                <tr>
                    ${data.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
                    ${showCancel || showDelete ? `<th data-admin-only></th>` : ""}
                    ${showReturnCd ? `<th data-staff-up></th>` : ""}
                </tr>
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
                        ${showCancel ? `
                            <td data-admin-only>
                                <button
                                    type="button"
                                    class="danger-button compact"
                                    data-cancel-billing-id="${escapeHtml(row.billingId)}"
                                >ยกเลิกบิล</button>
                            </td>
                        ` : ""}
                        ${showDelete ? `
                            <td data-admin-only>
                                <button
                                    type="button"
                                    class="danger-button compact"
                                    data-delete-status-id="${escapeHtml(row.enrollmentStatusId)}"
                                >ลบ</button>
                            </td>
                        ` : ""}
                        ${showReturnCd ? `
                            <td data-staff-up>
                                <button type="button" class="danger-button compact"
                                    data-return-cd-id="${escapeHtml(row.cdUsedId)}"
                                    data-cpcd="${row.cpcd === true}"
                                    data-stock-processed="${row.stock === true}">${row.cpcd === true ? "เอา CD คืน" : "ยกเลิกรายการ CD"}</button>
                            </td>
                        ` : ""}
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
    syncStudentControls();
}

async function returnCd(button) {
    if (button.disabled || studentMutationBusy || profileLoading || profileLoadFailed || !state.selectedStudentId) return;
    const studentId = state.selectedStudentId;
    const requestId = profileRequest;
    const cdUsedId = Number(button.dataset.returnCdId);
    const pendingKey = `${studentId}:${cdUsedId}`;
    if (pendingCdReturns.has(pendingKey)) return;
    const stockProcessed = button.dataset.stockProcessed === "true";
    const receivedCd = button.dataset.cpcd === "true";
    if (!await confirmAction(!receivedCd
        ? "ยกเลิกรายการไม่ได้รับ CD นี้ใช่ไหม? สามารถกลับไปเลือกใหม่ได้ และสต็อกจะไม่เปลี่ยน"
        : stockProcessed
        ? "เอา CD คืนและยกเลิกรายการให้ CD นี้ใช่ไหม? ระบบจะคืนสต็อก 1 แผ่นด้วย"
        : "เอา CD คืนและยกเลิกรายการให้ CD นี้ใช่ไหม? รายการนี้ยังไม่ตัดสต็อก จึงไม่เพิ่มสต็อก")) return;
    if (studentMutationBusy || profileLoading || profileLoadFailed || requestId !== profileRequest
        || state.selectedStudentId !== studentId || pendingCdReturns.has(pendingKey)) return;
    pendingCdReturns.add(pendingKey);
    button.disabled = true;
    syncStudentControls();
    try {
        const data = await requestJson(`/api/students/${encodeURIComponent(studentId)}/history/cd/${encodeURIComponent(cdUsedId)}`, { method: "DELETE" });
        if (state.selectedStudentId === studentId && requestId === profileRequest) {
            await loadProfile(studentId, { preferredEnrollmentId: state.selectedEnrollmentId });
            await loadHistory();
        }
        setStatus(data.stockReturned ? "เอา CD คืนแล้ว และคืนสต็อก 1 แผ่น"
            : receivedCd ? "เอา CD คืนแล้ว (ยังไม่ได้ตัดสต็อก)" : "ยกเลิกรายการ CD แล้ว สต็อกไม่เปลี่ยน");
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        pendingCdReturns.delete(pendingKey);
        syncStudentControls();
    }
}

async function cancelBilling(billingId) {
    if (!billingId) {
        return;
    }

    if (!await confirmAction(`ยกเลิกบิล #${billingId} ใช่ไหม? สถานะที่แก้ภายหลังจะไม่ถูกย้อนกลับ`)) {
        return;
    }

    setStatus("กำลังยกเลิกบิล...");

    try {
        const data = await requestJson("/api/payment/receipt/cancel", {
            method: "POST",
            body: JSON.stringify({ billingId })
        });

        await loadProfile(state.selectedStudentId, { preferredEnrollmentId: state.selectedEnrollmentId });
        await loadHistory();
        setStatus(`ยกเลิกบิลแล้ว${data.warning ? ' • ' + data.warning : ''}`);
    } catch (error) {
        setStatus(error.message, "error");
    }
}

async function deleteStatusHistoryEntry(enrollmentStatusId) {
    if (!enrollmentStatusId || !state.selectedStudentId) {
        return;
    }

    if (!await confirmAction(
        `ลบรายการประวัติสถานะนี้ใช่ไหม? ลบแค่ log นี้เท่านั้น — ถ้าสถานะปัจจุบันของ enrollment ต้องแก้ด้วย ให้กด Absent/OT/Resume/Complete เองอีกทีหลังจากนี้`
    )) {
        return;
    }

    setStatus("กำลังลบรายการ...");

    try {
        await requestJson(
            `/api/students/${encodeURIComponent(state.selectedStudentId)}/history/status/${encodeURIComponent(enrollmentStatusId)}`,
            { method: "DELETE" }
        );

        await loadHistory();
        setStatus("ลบรายการแล้ว");
    } catch (error) {
        setStatus(error.message, "error");
    }
}

async function loadHistory() {
    const requestId = ++historyRequest;
    if (!state.selectedStudentId) {
        return;
    }
    const studentId = state.selectedStudentId, enrollmentId = state.selectedEnrollmentId, type = state.historyType;
    const isCurrent = () => requestId === historyRequest && studentId === state.selectedStudentId
        && enrollmentId === state.selectedEnrollmentId && type === state.historyType;

    els.historySubtitle.textContent = "กำลังโหลด...";
    els.historyTableWrap.innerHTML = `<div class="empty-state">กำลังโหลดประวัติ...</div>`;
    updateWsGraphButtonVisibility();
    const params = new URLSearchParams({
        type
    });

    if (enrollmentId) {
        params.set("enrollmentId", String(enrollmentId));
    }

    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(studentId)}/history?${params.toString()}`
        );
        if (!isCurrent()) return;

        els.historySubtitle.textContent = `ล่าสุด ${data.rows.length} รายการ`;
        renderHistoryTable(data);
    } catch (error) {
        if (isCurrent()) {
            els.historyTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
            throw error;
        }
    }
}

function startNewEnrollment() {
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;
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
    if (studentMutationBusy) return;
    els.addEnrollmentModal.classList.add("hidden");
    state.addEnrollmentValidationActive = false;
    setAddEnrollmentMessage();
}

async function saveNewEnrollment(event) {
    event.preventDefault();
    if (studentMutationBusy || profileLoading || profileLoadFailed) return;

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
    const studentId = state.selectedStudentId;
    const requestId = profileRequest;
    setStudentMutationBusy(true);

    try {
        const data = await requestJson(
            `/api/students/${encodeURIComponent(studentId)}/enrollments`,
            {
                method: "POST",
                body: JSON.stringify(payload)
            }
        );
        if (requestId !== profileRequest || state.selectedStudentId !== studentId) return;

        state.profile = data.profile;
        state.selectedEnrollmentId = data.enrollmentId;
        els.addEnrollmentModal.classList.add("hidden");
        state.addEnrollmentValidationActive = false;
        setAddEnrollmentMessage();
        renderProfile();
        await loadStudents();
        await loadHistory();
        setAddEnrollmentMessage();
        setStatus("เพิ่มวิชาแล้ว");
    } catch (error) {
        setAddEnrollmentMessage(error.message, "error");
    } finally {
        setStudentMutationBusy(false);
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
    els.enrollmentResumeForm.addEventListener('submit', saveEnrollmentStatusAction);
    els.enrollmentResumeCancel.addEventListener('click', () => { if (!resumeBusy) { els.enrollmentResumeDialog.close(); resumeTarget = null; } });
    els.enrollmentResumeDialog.addEventListener('cancel', (event) => { if (resumeBusy) event.preventDefault(); else resumeTarget = null; });
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
        if (studentMutationBusy || profileLoading || profileLoadFailed) return;
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
        if (studentMutationBusy || profileLoading || profileLoadFailed) return;
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
    els.historyTableWrap.addEventListener("click", (event) => {
        if (studentMutationBusy || profileLoading || profileLoadFailed) return;
        const returnCdButton = event.target.closest("[data-return-cd-id]");
        if (returnCdButton) {
            returnCd(returnCdButton);
            return;
        }
        const cancelButton = event.target.closest("[data-cancel-billing-id]");

        if (cancelButton) {
            cancelBilling(Number(cancelButton.dataset.cancelBillingId));
            return;
        }

        const deleteButton = event.target.closest("[data-delete-status-id]");

        if (deleteButton) {
            deleteStatusHistoryEntry(Number(deleteButton.dataset.deleteStatusId));
        }
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
        bindKsisImport();
        const params = new URLSearchParams(window.location.search);
        const linkedStudent = params.get("studentId");
        const linkedEnrollment = params.get("enrollmentId");
        const validId = (value) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));
        if (linkedStudent !== null && !validId(linkedStudent)) throw new Error("รหัสนักเรียนในลิงก์ไม่ถูกต้อง");
        if (linkedEnrollment !== null && (!linkedStudent || !validId(linkedEnrollment))) throw new Error("รหัสรายวิชาในลิงก์ไม่ถูกต้อง");
        if (linkedStudent) els.studentSearch.value = linkedStudent;
        await loadStudents();
        if (linkedStudent) {
            await loadProfile(Number(linkedStudent), { preferredEnrollmentId: linkedEnrollment ? Number(linkedEnrollment) : null });
            if (linkedEnrollment && Number(state.selectedEnrollmentId) !== Number(linkedEnrollment)) {
                setStatus("ไม่พบรายวิชาจากลิงก์ในนักเรียนคนนี้ กรุณาตรวจรายวิชา", "error");
                return;
            }
            if (params.get("focus") === "absent") focusPaymentAbsentAction();
            return;
        }
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

function focusPaymentAbsentAction() {
    const enrollment = selectedEnrollment();
    if (!enrollment || enrollment.statusGroup1Code !== "C") {
        setStatus(`รายวิชานี้${enrollment ? `เป็นสถานะ ${enrollment.statusGroup1Code}` : "ไม่มีข้อมูล"} จึงไม่มีปุ่ม Absent`, "error");
        return;
    }
    const focus = () => {
        if (!["admin", "instructor"].includes(document.documentElement.dataset.role)) return;
        const button = els.enrollmentAbsentButton;
        const details = button.closest("details");
        if (details) details.open = true;
        button.classList.add("payment-absent-target");
        button.scrollIntoView({ block: "center" });
        button.focus({ preventScroll: true });
        setStatus(`รายการยังไม่จ่าย • ${enrollment.subjectCode} #${enrollment.enrollmentId} • ยังไม่เปลี่ยนสถานะ`);
    };
    if (document.documentElement.dataset.role) focus();
    else {
        const observer = new MutationObserver(() => {
            if (!document.documentElement.dataset.role) return;
            observer.disconnect(); focus();
        });
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-role"] });
    }
}

init();
