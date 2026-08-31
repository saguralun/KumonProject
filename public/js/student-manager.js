import { bindFourDigitYearDateInputs } from "./dateInputYear.js";
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
import { resolveAddZunLevelId } from "./studentMasters.js";
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
