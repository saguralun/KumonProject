import { worksheetApi } from "./worksheetApi.js";
import { bindFourDigitYearDateInputs } from "../dateInputYear.js";
import {
    addDays,
    buildPreviewRecords,
    escapeHtml,
    formatDateDisplay,
    moveWorksheetNo,
    requiredMainReady,
    selectedPattern,
    worksheetInputCount
} from "./worksheetInput.js";
import {
    prependHistoryRows,
    renderHistory
} from "./worksheetHistory.js";
import { bindWorksheetKeyboard } from "./worksheetKeyboard.js";

const els = {
    subjectButtons: document.getElementById("subjectButtons"),
    searchMode: document.getElementById("searchMode"),
    studentSearch: document.getElementById("studentSearch"),
    searchResults: document.getElementById("searchResults"),
    statusLine: document.getElementById("statusLine"),
    studentStrip: document.getElementById("studentStrip"),
    studentName: document.getElementById("studentName"),
    studentMeta: document.getElementById("studentMeta"),
    studentSubjectSelect: document.getElementById("studentSubjectSelect"),
    receiveDate: document.getElementById("receiveDate"),
    receiveWeekday: document.getElementById("receiveWeekday"),
    datePrev: document.getElementById("datePrev"),
    dateNext: document.getElementById("dateNext"),
    patternButtons: document.getElementById("patternButtons"),
    worksheetProgressRing: document.getElementById("worksheetProgressRing"),
    worksheetProgressTabs: document.getElementById("worksheetProgressTabs"),
    worksheetProgressLevel: document.getElementById("worksheetProgressLevel"),
    worksheetProgressValue: document.getElementById("worksheetProgressValue"),
    worksheetProgressCaption: document.getElementById("worksheetProgressCaption"),
    gradeSyncBadge: document.getElementById("gradeSyncBadge"),
    worksheetInputs: document.getElementById("worksheetInputs"),
    previewCount: document.getElementById("previewCount"),
    previewList: document.getElementById("previewList"),
    saveButton: document.getElementById("saveButton"),
    completeWsLevel: document.getElementById("completeWsLevel"),
    completeZunLevel: document.getElementById("completeZunLevel"),
    receiveCd: document.getElementById("receiveCd"),
    findIncompleteWs: document.getElementById("findIncompleteWs"),
    historyLimit: document.getElementById("historyLimit"),
    historySubtitle: document.getElementById("historySubtitle"),
    historyMonthSummary: document.getElementById("historyMonthSummary"),
    worksheetPacketSummary: document.getElementById("worksheetPacketSummary"),
    historyTableWrap: document.getElementById("historyTableWrap"),
    atModal: document.getElementById("atModal"),
    atForm: document.getElementById("atForm"),
    atModalTitle: document.getElementById("atModalTitle"),
    atModalSubtitle: document.getElementById("atModalSubtitle"),
    atCancel: document.getElementById("atCancel"),
    atEnrollmentId: document.getElementById("atEnrollmentId"),
    atSubject: document.getElementById("atSubject"),
    atLevel: document.getElementById("atLevel"),
    atDate: document.getElementById("atDate"),
    atScore: document.getElementById("atScore"),
    atMaxScore: document.getElementById("atMaxScore"),
    atTime: document.getElementById("atTime"),
    atMaxTime: document.getElementById("atMaxTime"),
    atGroup: document.getElementById("atGroup"),
    atPassControl: document.getElementById("atPassControl"),
    atEditLatest: document.getElementById("atEditLatest"),
    atSaveButton: document.getElementById("atSaveButton"),
    incompleteWsModal: document.getElementById("incompleteWsModal"),
    incompleteWsClose: document.getElementById("incompleteWsClose"),
    incompleteWsSubtitle: document.getElementById("incompleteWsSubtitle"),
    incompleteWsTableWrap: document.getElementById("incompleteWsTableWrap")
};

const state = {
    subjectFilter: "ALL",
    searchMode: "id",
    searchResults: [],
    activeResultIndex: -1,
    searchRequestId: 0,
    searchTimer: null,
    // The page auto-focuses the search box on load for convenience, but
    // that shouldn't pop the results dropdown open before the user has
    // actually typed or clicked anything — skip just that one search.
    suppressInitialSearch: false,
    // True once the box shows a confirmed "#id ชื่อ" selection rather than
    // a query the user is actively typing — lets focus tell those apart.
    hasConfirmedSelection: false,
    context: null,
    history: [],
    worksheetPacketSummary: null,
    worksheetMonthSummary: null,
    patterns: [],
    patternCode: "daily10",
    progressKind: "main",
    isSaving: false,
    isCompletingLevel: false,
    isCompletingZun: false,
    atModal: {
        editingAtUsedId: null,
        isPass: true,
        source: null
    }
};

function setStatus(message, type = "neutral") {
    els.statusLine.textContent = message;
    els.statusLine.classList.toggle("is-error", type === "error");
    els.statusLine.classList.toggle("is-success", type === "success");
}

function currentPattern() {
    return selectedPattern(state.patterns, state.patternCode);
}

function weekdayLabelFromIsoDate(dateText) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText || "")) {
        return "เลือกวันที่";
    }

    const [year, month, day] = dateText.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const weekdayNames = [
        "วันอาทิตย์",
        "วันจันทร์",
        "วันอังคาร",
        "วันพุธ",
        "วันพฤหัสบดี",
        "วันศุกร์",
        "วันเสาร์"
    ];

    return weekdayNames[date.getDay()];
}

function updateReceiveWeekday() {
    els.receiveWeekday.textContent = weekdayLabelFromIsoDate(els.receiveDate.value);
}

function setReceiveDate(dateText) {
    els.receiveDate.value = dateText;
    updatePreview();
    refreshWorksheetMonthSummary();
}

function readWorksheetNos(kind) {
    return [...els.worksheetInputs.querySelectorAll(`[data-ws-input][data-kind="${kind}"]`)]
        .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
        .map((input) => input.value.trim());
}

function optionsForKind(kind) {
    if (!state.context) {
        return [];
    }

    return kind === "zun"
        ? state.context.worksheetOptions.zun
        : state.context.worksheetOptions.main;
}

function renderSearchResults() {
    const rows = state.searchResults;

    if (!rows.length) {
        els.searchResults.innerHTML = `<div class="empty-state">ไม่พบเด็ก</div>`;
        els.searchResults.classList.remove("hidden");
        return;
    }

    els.searchResults.innerHTML = rows.map((row, index) => `
        <button
            type="button"
            class="result-item ${index === state.activeResultIndex ? "is-active" : ""}"
            data-index="${index}"
            role="option"
        >
            <span class="result-id">#${escapeHtml(row.enrollmentId)}</span>
            <span class="result-name">${escapeHtml(row.studentName)}</span>
            <span class="result-subject">${escapeHtml(row.subjectCode)} ${escapeHtml(row.currentLevelCode)}</span>
        </button>
    `).join("");
    els.searchResults.classList.remove("hidden");
}

async function runSearch() {
    const requestId = state.searchRequestId + 1;
    state.searchRequestId = requestId;

    try {
        const data = await worksheetApi.searchEnrollments({
            query: els.studentSearch.value,
            mode: state.searchMode,
            subject: state.subjectFilter,
            limit: 30
        });

        if (requestId !== state.searchRequestId) {
            return;
        }

        state.searchResults = data.rows || [];
        state.activeResultIndex = state.searchResults.length ? 0 : -1;
        renderSearchResults();
    } catch (error) {
        setStatus(error.message, "error");
    }
}

function queueSearch() {
    window.clearTimeout(state.searchTimer);
    state.searchTimer = window.setTimeout(runSearch, 140);
}

function selectStudentSearchText() {
    window.requestAnimationFrame(() => {
        if (document.activeElement === els.studentSearch) {
            els.studentSearch.select();
        }
    });
}

async function selectSearchResult(index) {
    const row = state.searchResults[index];

    if (!row) {
        return;
    }

    els.studentSearch.value = `#${row.enrollmentId} ${row.studentName}`;
    els.searchResults.classList.add("hidden");
    await loadEnrollmentContext(row.enrollmentId);
}

function setSubjectFilter(subject) {
    state.subjectFilter = subject;
    els.subjectButtons.querySelectorAll(".subject-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.subject === subject);
    });
    queueSearch();
    els.studentSearch.focus();
    selectStudentSearchText();
}

function setSearchMode(mode) {
    state.searchMode = mode;
    els.searchMode.querySelectorAll(".mode-button").forEach((button) => {
        button.classList.toggle("active", button.dataset.mode === mode);
    });
    els.studentSearch.placeholder = mode === "id"
        ? "Enrollment ID"
        : "ชื่อเด็ก";
    els.studentSearch.select();
    queueSearch();
}

function populateStudentStrip(context) {
    const enrollment = context.enrollment;

    els.studentStrip.classList.remove("is-empty");
    els.studentName.innerHTML = `
        <span>${escapeHtml(enrollment.studentName)}</span>
        ${enrollment.isKumonConnect ? `<span class="student-name-badge">KC</span>` : ""}
    `;
    els.studentMeta.textContent = [
        `ID ${enrollment.enrollmentId}`,
        enrollment.subjectCode,
        `Current ${enrollment.currentLevelCode}`,
        enrollment.currentZunLevelCode ? `Zun ${enrollment.currentZunLevelCode}` : "No Zun",
        enrollment.statusName
    ].filter(Boolean).join(" • ");
    els.studentSubjectSelect.disabled = false;
    els.studentSubjectSelect.innerHTML = context.studentEnrollments.map((item) => `
        <option value="${escapeHtml(item.enrollmentId)}" ${item.enrollmentId === enrollment.enrollmentId ? "selected" : ""}>
            ${escapeHtml(item.subjectCode)} - ${escapeHtml(item.currentLevelCode)}
            ${item.currentZunLevelCode ? ` / Zun ${escapeHtml(item.currentZunLevelCode)}` : ""}
        </option>
    `).join("");
}

function renderPatternButtons() {
    els.patternButtons.innerHTML = state.patterns.map((pattern) => `
        <button
            type="button"
            class="pattern-button ${pattern.code === state.patternCode ? "active" : ""}"
            data-pattern="${escapeHtml(pattern.code)}"
        >
            ${escapeHtml(pattern.shortLabel)}
        </button>
    `).join("");
}

function progressTargetForKind(context, kind) {
    const enrollment = context?.enrollment;

    if (!enrollment) {
        return null;
    }

    if (kind === "zun") {
        return enrollment.currentZunLevelMasterId
            ? {
                levelMasterId: enrollment.currentZunLevelMasterId,
                levelCode: enrollment.currentZunLevelCode,
                maxWorksheetNo: 100
            }
            : null;
    }

    return {
        levelMasterId: enrollment.currentLevelMasterId,
        levelCode: enrollment.currentLevelCode,
        maxWorksheetNo: 200
    };
}

function fallbackWorksheetProgressFromHistory(context, kind) {
    const target = progressTargetForKind(context, kind);

    if (!target?.levelMasterId) {
        return null;
    }

    const rows = (context.history || []).filter((row) => (
        row.cpws === true
        && Number(row.levelMasterId) === Number(target.levelMasterId)
        && row.worksheetDate
    ));

    if (!rows.length) {
        return null;
    }

    const latestDateText = rows.reduce((latest, row) => (
        row.worksheetDate > latest ? row.worksheetDate : latest
    ), rows[0].worksheetDate);
    const [year, month, day] = latestDateText.split("-").map(Number);
    const cutoffDate = new Date(year, month - 1, day);
    cutoffDate.setMonth(cutoffDate.getMonth() - 12);
    const cutoffText = [
        cutoffDate.getFullYear(),
        String(cutoffDate.getMonth() + 1).padStart(2, "0"),
        String(cutoffDate.getDate()).padStart(2, "0")
    ].join("-");
    const actualWorksheetNo = rows
        .filter((row) => row.worksheetDate >= cutoffText)
        .reduce((maxValue, row) => Math.max(maxValue, Number(row.actualWorksheetNo || 0)), 0);

    if (!actualWorksheetNo) {
        return null;
    }

    const displayWorksheetNo = Math.min(target.maxWorksheetNo, actualWorksheetNo + 9);

    return {
        levelCode: target.levelCode,
        actualWorksheetNo,
        displayWorksheetNo,
        maxWorksheetNo: target.maxWorksheetNo,
        percent: Math.round((displayWorksheetNo / target.maxWorksheetNo) * 100)
    };
}

function progressForKind(context, kind) {
    const rawProgress = context?.worksheetProgress;

    if (rawProgress?.main || rawProgress?.zun) {
        return rawProgress[kind] || null;
    }

    return kind === "main" ? rawProgress : null;
}

function normalizeWorksheetProgress(progress, context, kind) {
    const target = progressTargetForKind(context, kind);
    const sourceProgress = progress?.actualWorksheetNo || progress?.displayWorksheetNo
        ? progress
        : fallbackWorksheetProgressFromHistory(context, kind);
    const maxWorksheetNo = Number(sourceProgress?.maxWorksheetNo || target?.maxWorksheetNo || 200);
    const displayWorksheetNo = Math.max(0, Math.min(maxWorksheetNo, Number(sourceProgress?.displayWorksheetNo || 0)));
    const percent = Math.max(0, Math.min(100, Number(sourceProgress?.percent || Math.round((displayWorksheetNo / maxWorksheetNo) * 100))));

    return {
        levelCode: sourceProgress?.levelCode || target?.levelCode || "-",
        actualWorksheetNo: sourceProgress?.actualWorksheetNo || null,
        displayWorksheetNo,
        maxWorksheetNo,
        percent
    };
}

function renderWorksheetProgress() {
    const zunLevelMasterId = Number(state.context?.enrollment?.currentZunLevelMasterId || 0);
    const hasZunProgress = Number.isInteger(zunLevelMasterId) && zunLevelMasterId > 0;

    if (!hasZunProgress) {
        state.progressKind = "main";
    }

    els.worksheetProgressTabs.classList.toggle("hidden", !hasZunProgress);
    els.worksheetProgressTabs.setAttribute("aria-hidden", hasZunProgress ? "false" : "true");
    els.worksheetProgressTabs.querySelectorAll("[data-progress-kind]").forEach((button) => {
        button.disabled = !hasZunProgress;
        button.classList.toggle("active", button.dataset.progressKind === state.progressKind);
    });

    const progress = normalizeWorksheetProgress(
        progressForKind(state.context, state.progressKind),
        state.context,
        state.progressKind
    );
    const offset = Math.max(0, Math.min(100, 100 - progress.percent));

    els.worksheetProgressRing.style.setProperty("--progress-offset", String(offset));
    els.worksheetProgressLevel.textContent = progress.levelCode;
    els.worksheetProgressValue.textContent = String(progress.displayWorksheetNo);
    els.worksheetProgressCaption.textContent = `${progress.percent}%`;

    renderGradeSyncBadge(state.progressKind === "main" ? state.context?.gradeSyncStatus : null);
}

const GRADE_SYNC_LABELS = {
    KSIS: "เรียนทันชั้นเรียน",
    "6M": "เรียนเกินชั้นเรียน 6 เดือน",
    "2Y": "เรียนเกินชั้นเรียน 2 ปี",
    "3Y": "เรียนเกินชั้นเรียน 3 ปี",
    "5Y": "เรียนเกินชั้นเรียน 5 ปี",
    "7Y": "เรียนเกินชั้นเรียน 7 ปี"
};

function renderGradeSyncBadge(status) {
    if (!status?.code || !GRADE_SYNC_LABELS[status.code]) {
        els.gradeSyncBadge.classList.add("hidden");
        els.gradeSyncBadge.textContent = "";
        els.gradeSyncBadge.removeAttribute("title");
        return;
    }

    els.gradeSyncBadge.textContent = status.code;
    els.gradeSyncBadge.title = GRADE_SYNC_LABELS[status.code];
    els.gradeSyncBadge.classList.toggle("grade-sync-badge-ksis", status.code === "KSIS");
    els.gradeSyncBadge.classList.remove("hidden");
}

function focusWorksheetControl(input) {
    if (!input) {
        return;
    }

    input.focus();
    if (typeof input.select === "function") {
        input.select();
    }
}

function renderOptionsDatalist(id, options) {
    return `
        <datalist id="${escapeHtml(id)}">
            ${options.map((option) => `
                <option value="${escapeHtml(option.worksheetNo)}"></option>
            `).join("")}
        </datalist>
    `;
}

function nextDefaultNo(value, options) {
    return moveWorksheetNo(value, options, 1);
}

function hasZunHistory(context) {
    const zunLevelId = context.enrollment.currentZunLevelMasterId;

    if (!zunLevelId) {
        return false;
    }

    return (context.history || []).some((row) => (
        row.worksheetType === "ZUN"
        && Number(row.levelMasterId) === Number(zunLevelId)
    ));
}

function buildInputValues({
    kind,
    pattern,
    previousValues
}) {
    const options = optionsForKind(kind);
    const count = worksheetInputCount(pattern);
    const defaults = state.context.defaults;
    const firstFallback = kind === "zun"
        ? (hasZunHistory(state.context) ? defaults.zunWorksheetNo : "")
        : defaults.mainWorksheetNo;
    const firstValue = previousValues?.[0] ?? firstFallback ?? "";
    const values = [firstValue || ""];

    if (count === 2) {
        values.push(previousValues?.[1] ?? nextDefaultNo(firstValue, options));
    }

    return values;
}

function renderWorksheetOptions(options, value, { allowEmpty = false } = {}) {
    const currentValue = String(value || "");
    const emptyOption = allowEmpty
        ? `<option value="" ${currentValue ? "" : "selected"}>-</option>`
        : "";

    return emptyOption + options.map((option) => {
        const optionValue = String(option.worksheetNo);

        return `
            <option value="${escapeHtml(optionValue)}" ${optionValue === currentValue ? "selected" : ""}>
                ${escapeHtml(optionValue)}
            </option>
        `;
    }).join("");
}

function renderWorksheetField({
    kind,
    index,
    label,
    value,
    options
}) {
    return `
        <label class="worksheet-field">
            <span class="worksheet-field-label">${escapeHtml(label)}</span>
            <div class="worksheet-stepper">
                <button type="button" class="icon-button" data-step="-1" data-kind="${kind}" data-index="${index}" aria-label="Previous worksheet">‹</button>
                <select
                    data-ws-input
                    data-kind="${kind}"
                    data-index="${index}"
                >
                    ${renderWorksheetOptions(options, value, { allowEmpty: kind === "zun" })}
                </select>
                <button type="button" class="icon-button" data-step="1" data-kind="${kind}" data-index="${index}" aria-label="Next worksheet">›</button>
            </div>
        </label>
    `;
}

function renderInputSection({
    kind,
    title,
    levelCode,
    values,
    options,
    optional = false
}) {
    const count = values.length;

    return `
        <fieldset class="input-section worksheet-fieldset">
            <legend class="section-heading">
                <span class="section-title">${escapeHtml(title)}</span>
                <span class="level-pill">${escapeHtml(levelCode || "-")}</span>
                ${optional ? `<span class="optional-note">Optional</span>` : ""}
            </legend>
            <div class="worksheet-grid">
                ${values.map((value, index) => renderWorksheetField({
                    kind,
                    index,
                    label: count === 2 ? `ช่อง ${index + 1}` : "Worksheet",
                    value,
                    options
                })).join("")}
            </div>
        </fieldset>
    `;
}

function renderPairedInputSections({
    mainValues,
    zunValues
}) {
    const rowCount = Math.max(mainValues.length, zunValues.length);
    const rows = [];

    for (let index = 0; index < rowCount; index += 1) {
        rows.push(`
            <div class="worksheet-pair-row">
                <fieldset class="input-section worksheet-fieldset worksheet-pair-cell">
                    <legend class="section-heading">
                        <span class="section-title">Main WS</span>
                        <span class="level-pill">${escapeHtml(state.context.enrollment.currentLevelCode || "-")}</span>
                        ${rowCount > 1 ? `<span class="optional-note">ช่อง ${index + 1}</span>` : ""}
                    </legend>
                    ${renderWorksheetField({
                        kind: "main",
                        index,
                        label: rowCount > 1 ? `WS ${index + 1}` : "Worksheet",
                        value: mainValues[index] || "",
                        options: state.context.worksheetOptions.main
                    })}
                </fieldset>
                <fieldset class="input-section worksheet-fieldset worksheet-pair-cell">
                    <legend class="section-heading">
                        <span class="section-title">Zun</span>
                        <span class="level-pill">${escapeHtml(state.context.enrollment.currentZunLevelCode || "-")}</span>
                        <span class="optional-note">Optional${rowCount > 1 ? ` • ช่อง ${index + 1}` : ""}</span>
                    </legend>
                    ${renderWorksheetField({
                        kind: "zun",
                        index,
                        label: rowCount > 1 ? `Zun ${index + 1}` : "Worksheet",
                        value: zunValues[index] || "",
                        options: state.context.worksheetOptions.zun
                    })}
                </fieldset>
            </div>
        `);
    }

    return `
        <div class="worksheet-pair-grid">
            ${rows.join("")}
        </div>
    `;
}

function renderWorksheetInputs({ preserve = false } = {}) {
    if (!state.context) {
        els.worksheetInputs.innerHTML = `<div class="empty-state">เลือกเด็กเพื่อเริ่มกรอก WS</div>`;
        return;
    }

    const pattern = currentPattern();
    const previousMain = preserve ? readWorksheetNos("main") : null;
    const previousZun = preserve ? readWorksheetNos("zun") : null;
    const mainValues = buildInputValues({
        kind: "main",
        pattern,
        previousValues: previousMain
    });
    const sections = [];

    if (state.context.enrollment.currentZunLevelMasterId) {
        const zunValues = buildInputValues({
            kind: "zun",
            pattern,
            previousValues: previousZun
        });

        sections.push(renderPairedInputSections({
            mainValues,
            zunValues
        }));
    } else {
        sections.push(renderInputSection({
            kind: "main",
            title: "Main WS",
            levelCode: state.context.enrollment.currentLevelCode,
            values: mainValues,
            options: state.context.worksheetOptions.main
        }));
    }

    els.worksheetInputs.innerHTML = sections.join("");
    els.worksheetInputs.querySelectorAll("[data-ws-input]").forEach((input) => {
        input.addEventListener("input", updatePreview);
        input.addEventListener("change", updatePreview);
        input.addEventListener("focus", () => focusWorksheetControl(input));
    });
    els.worksheetInputs.querySelectorAll("[data-step]").forEach((button) => {
        button.addEventListener("click", () => {
            stepWorksheet(
                button.dataset.kind,
                Number(button.dataset.index),
                Number(button.dataset.step)
            );
        });
    });
    updatePreview();
}

function renderPreviewList(records) {
    if (!records.length) {
        els.previewList.innerHTML = `<div class="empty-state">ยังไม่มีรายการ</div>`;
        return;
    }

    els.previewList.innerHTML = records.map((record) => `
        <div class="preview-row">
            <div class="preview-date">${escapeHtml(formatDateDisplay(record.worksheetDate))}</div>
            <div>
                <div class="preview-label">${escapeHtml(record.worksheetLabel)}</div>
                <div class="preview-kind">${escapeHtml(record.kind)} • packet ${escapeHtml(record.packetWorksheetNo)}</div>
            </div>
            <div class="preview-flag ${record.isKumonConnect ? "kc" : (record.cpws ? "cpws" : "auto")}">
                ${record.isKumonConnect ? "KC" : (record.cpws ? "CPWS" : "auto")}
            </div>
        </div>
    `).join("");
}

function updatePreview() {
    updateReceiveWeekday();

    const pattern = currentPattern();
    const mainWorksheetNos = readWorksheetNos("main");
    const zunWorksheetNos = readWorksheetNos("zun");
    const records = buildPreviewRecords({
        context: state.context,
        pattern,
        receiveDate: els.receiveDate.value,
        mainWorksheetNos,
        zunWorksheetNos
    });
    const cdRequirement = currentCdRequirement();
    const cdReady = !cdRequirement || cdRequirement.hasReceived;
    const mainReady = requiredMainReady(pattern, mainWorksheetNos);
    const canSave = Boolean(
        state.context
        && !state.isSaving
        && els.receiveDate.value
        && mainReady
        && cdReady
    );

    els.previewCount.textContent = `${records.length} records`;
    els.saveButton.disabled = !canSave;

    if (!state.context) {
        setStatus("พร้อมใช้งาน");
    } else if (state.isSaving) {
        setStatus("กำลังบันทึก WS...");
    } else if (!els.receiveDate.value) {
        setStatus("กรุณาเลือก Receive Date", "error");
    } else if (!mainReady) {
        setStatus("กรุณาเลือก WS ก่อนบันทึก", "error");
    } else if (!cdReady) {
        setStatus("กรุณารับ CD ก่อนบันทึก WS", "error");
    } else {
        setStatus("พร้อมบันทึก WS", "success");
    }

    renderPreviewList(records);
    renderWorksheetPacketSummary(state.worksheetPacketSummary);
    updateSecondaryActions();
}

function renderHistoryTable({ scrollToTop = false } = {}) {
    renderHistory(els.historyTableWrap, state.history, state.worksheetMonthSummary);

    if (scrollToTop) {
        els.historyTableWrap.scrollTop = 0;
        els.historyTableWrap.scrollLeft = 0;
    }
}

function worksheetPacketSummaryForKind(summary, kind) {
    if (summary?.main || summary?.zun) {
        return summary[kind] || null;
    }

    return kind === "main" ? summary : null;
}

function graphHasCompletionPacket(kind) {
    const target = progressTargetForKind(state.context, kind);
    const summary = worksheetPacketSummaryForKind(state.worksheetPacketSummary, kind);
    const completionPacketNo = target?.maxWorksheetNo === 100 ? 91 : 191;

    return Boolean(
        target?.levelMasterId
        && summary?.rows?.some((row) => (
            Number(row.packetWorksheetNo) === completionPacketNo
            && Number(row.count || 0) > 0
        ))
    );
}

function formatThaiPeriod(period) {
    if (!period) {
        return "";
    }

    const months = Number(period.months || 0);
    const days = Number(period.days || 0);
    const parts = [];

    if (months) {
        parts.push(`${months} เดือน`);
    }

    if (days || !parts.length) {
        parts.push(`${days} วัน`);
    }

    return parts.join(" ");
}

function renderWorksheetPacketSummary(summary) {
    const target = progressTargetForKind(state.context, state.progressKind);
    const activeSummary = worksheetPacketSummaryForKind(summary, state.progressKind);
    let rows = activeSummary?.rows || [];
    let levelCode = activeSummary?.levelCode || target?.levelCode || "-";
    const historyContent = els.worksheetPacketSummary.closest(".history-content");
    const countByPacket = new Map(rows.map((row) => [
        Number(row.packetWorksheetNo),
        Number(row.count || 0)
    ]));
    const shouldShowChart = Boolean(state.context?.enrollment && target?.levelMasterId);

    historyContent?.classList.toggle("has-packet-summary", shouldShowChart);
    els.worksheetPacketSummary.classList.toggle("hidden", !shouldShowChart);

    if (!shouldShowChart) {
        els.worksheetPacketSummary.innerHTML = "";
        return;
    }

    const packetCount = target?.maxWorksheetNo === 100 ? 10 : 20;
    const packetNumbers = Array.from({ length: packetCount }, (_, index) => (index * 10) + 1);
    const packetRows = packetNumbers.map((packetWorksheetNo) => ({
        packetWorksheetNo,
        count: countByPacket.get(packetWorksheetNo) || 0
    }));
    const maxCount = Math.max(...packetRows.map((row) => row.count), 1);
    const totalCpwsSets = packetRows.reduce((sum, row) => sum + row.count, 0);
    const periodLabel = formatThaiPeriod(activeSummary?.period);
    const packetSummaryText = periodLabel
        ? `(${periodLabel}) • CPWS ${totalCpwsSets} ชุด`
        : `CPWS ${totalCpwsSets} ชุด`;

    els.worksheetPacketSummary.innerHTML = `
        <div class="packet-summary-header">
            <div class="panel-title">Level ${escapeHtml(levelCode)}</div>
            <div class="subtle">${escapeHtml(packetSummaryText)}</div>
        </div>
        <div class="packet-summary-body">
            <div class="packet-bar-chart" aria-label="Worksheet packet chart">
                ${packetRows.map((row) => {
                    const height = row.count ? Math.max(8, Math.round((row.count / maxCount) * 100)) : 0;

                    return `
                        <div class="packet-bar-item" title="${escapeHtml(row.packetWorksheetNo)}: ${escapeHtml(row.count)} ea">
                            <div class="packet-bar-value">${escapeHtml(row.count)}</div>
                            <div class="packet-bar-track">
                                <div class="packet-bar-fill" style="height:${height}%"></div>
                            </div>
                            <div class="packet-bar-label">${escapeHtml(row.packetWorksheetNo)}</div>
                        </div>
                    `;
                }).join("")}
            </div>
        </div>
    `;
}

function setActionButton(button, icon, text) {
    button.innerHTML = `<span class="button-icon">${escapeHtml(icon)}</span><span>${escapeHtml(text)}</span>`;
}

function updateSecondaryActions() {
    const context = state.context;

    if (!context) {
        els.completeWsLevel.disabled = true;
        els.completeWsLevel.classList.add("hidden");
        els.completeZunLevel.disabled = true;
        els.receiveCd.disabled = true;
        els.receiveCd.classList.add("hidden");
        return;
    }

    const atCompletion = context.completionState?.atCompletion;
    const freeLevelCompletion = context.completionState?.freeLevelCompletion;
    const canCompleteAt = Boolean(atCompletion?.canComplete);
    const canCompleteFreeLevel = Boolean(freeLevelCompletion?.canComplete);
    const hasCompletionPacket = Boolean(
        atCompletion?.bypassWorksheet191
        || graphHasCompletionPacket("main")
    );
    const canUseFreeLevelButton = Boolean(
        state.progressKind === "main"
        && canCompleteFreeLevel
    );
    const canUseAtButton = Boolean(
        state.progressKind === "main"
        && canCompleteAt
        && hasCompletionPacket
    );
    const canUseMainCompleteButton = canUseAtButton || canUseFreeLevelButton;

    els.completeWsLevel.disabled = !canUseMainCompleteButton || state.isCompletingLevel;
    els.completeWsLevel.classList.toggle("hidden", !canUseMainCompleteButton);
    setActionButton(
        els.completeWsLevel,
        canUseFreeLevelButton ? "🎯" : "📝",
        canUseFreeLevelButton ? "จบ Level" : "สอบ AT"
    );
    const canCompleteZun = Boolean(context.completionState?.zunCompletion?.canComplete);

    els.completeZunLevel.disabled = !canCompleteZun || state.isCompletingZun;
    setActionButton(els.completeZunLevel, "🎯", "จบ Zun");

    const cdRequirement = currentCdRequirement();
    const shouldShowCdButton = Boolean(cdRequirement && !cdRequirement.hasReceived);

    els.receiveCd.disabled = !shouldShowCdButton;
    els.receiveCd.classList.toggle("hidden", !shouldShowCdButton);
    setActionButton(
        els.receiveCd,
        "💿",
        cdRequirement
            ? (cdRequirement.hasReceived ? `CD ${cdRequirement.cdNo} ${cdRequirement.cpcd ? "รับแล้ว" : "ไม่รับ"}` : `รับ CD ${cdRequirement.cdNo}`)
            : "ไม่ต้องใช้ CD"
    );
}

function cdNoForThaiLevel({
    levelCode,
    worksheetNo
}) {
    const normalizedLevelCode = String(levelCode || "").toUpperCase();
    const packetNo = Number(worksheetNo);

    if (["7A", "6A"].includes(normalizedLevelCode)) {
        if (packetNo >= 1 && packetNo <= 41) {
            return 1;
        }

        if (packetNo >= 51 && packetNo <= 91) {
            return 2;
        }

        if (packetNo >= 101 && packetNo <= 141) {
            return 3;
        }

        if (packetNo >= 151 && packetNo <= 191) {
            return 4;
        }

        return null;
    }

    if (["5A", "4A", "3A", "2A", "AI"].includes(normalizedLevelCode)) {
        return 1;
    }

    return null;
}

function requiredCdNoForCurrentInput() {
    if (!state.context) {
        return null;
    }

    const enrollment = state.context.enrollment;
    const subjectCode = String(enrollment.subjectCode || "").toUpperCase();

    if (subjectCode === "EFL") {
        return 1;
    }

    if (subjectCode !== "TRP") {
        return null;
    }

    const firstMainNo = readWorksheetNos("main")[0];

    return cdNoForThaiLevel({
        levelCode: enrollment.currentLevelCode,
        worksheetNo: firstMainNo
    });
}

function currentCdRequirement() {
    const requiredCdNo = requiredCdNoForCurrentInput();

    if (!requiredCdNo || !state.context?.cdState?.availableCds?.length) {
        return null;
    }

    const cdMaster = state.context.cdState.availableCds.find((item) =>
        Number(item.cdNo) === Number(requiredCdNo)
    );

    if (!cdMaster) {
        return null;
    }

    const receivedIds = new Set(
        (state.context.cdState.receivedCdMasterIds || []).map(Number)
    );
    const receivedRecord = (state.context.cdState.receivedCds || []).find((item) =>
        Number(item.cdMasterId) === Number(cdMaster.cdMasterId)
    );

    return {
        cdMasterId: cdMaster.cdMasterId,
        cdNo: cdMaster.cdNo,
        hasReceived: receivedIds.has(Number(cdMaster.cdMasterId)),
        cpcd: receivedRecord?.cpcd ?? null
    };
}

function monthName(month) {
    return [
        "",
        "มกราคม",
        "กุมภาพันธ์",
        "มีนาคม",
        "เมษายน",
        "พฤษภาคม",
        "มิถุนายน",
        "กรกฎาคม",
        "สิงหาคม",
        "กันยายน",
        "ตุลาคม",
        "พฤศจิกายน",
        "ธันวาคม"
    ][Number(month)] || month;
}

function renderWorksheetMonthSummary(summary) {
    if (!summary) {
        els.historyMonthSummary.textContent = "เดือนนี้: ยังไม่มีข้อมูล";
        return;
    }

    els.historyMonthSummary.textContent = `${monthName(summary.billingMonth)} ${summary.billingYear}: ใช้ ${summary.usedDays} วัน • CPWS ${summary.cpwsRecords} ชุด`;
}

function latestWorksheetText(row) {
    if (!row.latestWorksheetDate) {
        return "ยังไม่มี WS";
    }

    const label = row.latestWorksheetLabel || "-";
    const packet = row.latestPacketWorksheetNo
        ? `packet ${row.latestPacketWorksheetNo}`
        : "packet -";

    return `${label} • ${packet}`;
}

function renderIncompleteWsRows(rows) {
    if (!rows.length) {
        els.incompleteWsTableWrap.innerHTML = `<div class="empty-state">ทุกคนกรอกถึงวันที่ 20 แล้ว</div>`;
        return;
    }

    els.incompleteWsTableWrap.innerHTML = `
        <table class="incomplete-ws-table">
            <thead>
                <tr>
                    <th>Enrollment</th>
                    <th>Student</th>
                    <th>Subject</th>
                    <th>Current</th>
                    <th>Latest WS</th>
                    <th>Latest Date</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row) => `
                    <tr data-incomplete-enrollment-id="${escapeHtml(row.enrollmentId)}">
                        <td>#${escapeHtml(row.enrollmentId)}</td>
                        <td>${escapeHtml(row.studentName)}</td>
                        <td>${escapeHtml(row.subjectCode)}</td>
                        <td>${escapeHtml(row.currentLevelCode || "-")}</td>
                        <td>${escapeHtml(latestWorksheetText(row))}</td>
                        <td>${escapeHtml(row.latestWorksheetDate ? formatDateDisplay(row.latestWorksheetDate) : "-")}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

async function openIncompleteWsModal() {
    els.incompleteWsModal.classList.remove("hidden");
    els.incompleteWsSubtitle.textContent = "กำลังเช็ก WS ล่าสุดก่อนวันที่ 21 ของเดือนนี้";
    els.incompleteWsTableWrap.innerHTML = `<div class="empty-state">กำลังค้นหา...</div>`;

    try {
        const data = await worksheetApi.getIncompleteWorksheets();
        const rows = data.rows || [];
        const totalRows = Number(data.totalRows || rows.length);
        const countText = totalRows > rows.length
            ? `${rows.length} รายการล่าสุด`
            : `พบ ${rows.length} รายการ`;

        els.incompleteWsSubtitle.textContent = `เช็กถึง ${formatDateDisplay(data.cutoffDate)} • ${countText}`;
        renderIncompleteWsRows(rows);
    } catch (error) {
        els.incompleteWsTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        setStatus(error.message, "error");
    }
}

function closeIncompleteWsModal() {
    els.incompleteWsModal.classList.add("hidden");
}

async function selectIncompleteWsEnrollment(enrollmentId) {
    closeIncompleteWsModal();
    await loadEnrollmentContext(enrollmentId);
}

async function receiveCd() {
    if (!state.context) {
        return;
    }

    const cdRequirement = currentCdRequirement();

    if (!cdRequirement || cdRequirement.hasReceived) {
        return;
    }

    const isTakingCd = window.confirm(`รับ CD ${cdRequirement.cdNo} สำหรับ level นี้ใช่ไหม?\nOK = รับ CD\nCancel = ไม่รับ CD`);

    if (
        !isTakingCd
        && !window.confirm(`บันทึกว่าไม่รับ CD ${cdRequirement.cdNo} ใช่ไหม?`)
    ) {
        return;
    }

    try {
        const result = await worksheetApi.receiveCd({
            enrollmentId: state.context.enrollment.enrollmentId,
            cdMasterId: cdRequirement.cdMasterId,
            cdDate: els.receiveDate.value,
            cpcd: isTakingCd
        });

        const receivedIds = state.context.cdState.receivedCdMasterIds || [];

        if (!receivedIds.map(Number).includes(Number(result.cdMasterId))) {
            state.context.cdState.receivedCdMasterIds = [
                ...receivedIds,
                result.cdMasterId
            ];
        }
        state.context.cdState.receivedCds = [
            ...(state.context.cdState.receivedCds || []),
            {
                cdUsedId: result.cdUsedId,
                cdMasterId: result.cdMasterId,
                cdNo: result.cdNo,
                cdDate: els.receiveDate.value,
                cpcd: result.cpcd,
                isStockProcessed: false
            }
        ];

        updateSecondaryActions();
        updatePreview();
        setStatus(
            result.inserted
                ? `บันทึก CD ${result.cdNo} (${result.cpcd ? "รับ CD" : "ไม่รับ CD"}) แล้ว`
                : `CD ${result.cdNo} เคยบันทึกแล้ว`,
            "success"
        );
    } catch (error) {
        setStatus(error.message, "error");
    }
}

function setAtPass(isPass) {
    state.atModal.isPass = Boolean(isPass);
    els.atPassControl.querySelectorAll("[data-at-pass]").forEach((button) => {
        button.classList.toggle(
            "active",
            (button.dataset.atPass === "true") === state.atModal.isPass
        );
    });
}

function isAtFormReady() {
    const score = Number(els.atScore.value);
    const usedTime = Number(els.atTime.value);
    const atGroup = Number(els.atGroup.value);
    const maxScore = Number(els.atMaxScore.value);
    const maxTime = Number(els.atMaxTime.value);

    return (
        Number.isInteger(score)
        && score > 0
        && score <= maxScore
        && Number.isInteger(usedTime)
        && usedTime > 0
        && usedTime <= maxTime
        && Number.isInteger(atGroup)
        && atGroup >= 1
        && atGroup <= 5
    );
}

function updateAtSaveState() {
    els.atSaveButton.disabled = !isAtFormReady();
}

function focusAndSelect(input) {
    input.focus();

    if (typeof input.select === "function") {
        input.select();
    }
}

function moveAtFocus(event, nextElement) {
    if (event.key !== "Enter" && event.key !== "Tab") {
        return;
    }

    if (event.key === "Tab" && event.shiftKey) {
        return;
    }

    event.preventDefault();
    focusAndSelect(nextElement);
}

function changeAtGroup(delta) {
    const current = Number.parseInt(els.atGroup.value, 10);
    const baseValue = Number.isInteger(current) ? current : 1;
    const nextValue = Math.min(5, Math.max(1, baseValue + delta));

    els.atGroup.value = String(nextValue);
    updateAtSaveState();
}

function handleAtGroupKeydown(event) {
    if (event.key === "ArrowUp") {
        event.preventDefault();
        changeAtGroup(1);
        return;
    }

    if (event.key === "ArrowDown") {
        event.preventDefault();
        changeAtGroup(-1);
        return;
    }

    moveAtFocus(event, els.atSaveButton);
}

function atAttemptLabel(atCompletion) {
    const attemptNo = Number(atCompletion?.nextAttemptNo || 1);

    return attemptNo > 1 ? `สอบรอบที่ ${attemptNo}` : "สอบรอบแรก";
}

function fillAtFormFromSource({
    source,
    edit = false
}) {
    const enrollment = state.context.enrollment;
    const latestAttempt = source?.latestAttempt || null;
    const attempt = edit ? source : latestAttempt;

    state.atModal.editingAtUsedId = edit ? source.atUsedId : null;
    state.atModal.source = source;
    els.atEnrollmentId.value = enrollment.enrollmentId;
    els.atSubject.value = enrollment.subjectCode;
    els.atLevel.value = edit
        ? source.levelCode
        : enrollment.currentLevelCode;
    els.atDate.value = edit
        ? source.atDate
        : els.receiveDate.value;
    els.atMaxScore.value = source.maxScore ?? "";
    els.atMaxTime.value = source.maxTime ?? "";
    els.atScore.max = source.maxScore ?? "";
    els.atTime.max = source.maxTime ?? "";
    els.atScore.value = edit && attempt ? attempt.score : "";
    els.atTime.value = edit && attempt ? attempt.usedTime : "";
    els.atGroup.value = edit && attempt ? attempt.atGroup : 1;
    els.atSaveButton.textContent = edit ? "💾 บันทึกการแก้ไข" : "💾 บันทึก AT";
    setAtPass(edit && attempt ? attempt.isPass : true);
    updateAtSaveState();
}

function openAtModal({ editLatest = false } = {}) {
    if (!state.context) {
        return;
    }

    const atCompletion = state.context.completionState?.atCompletion;
    const latestAt = state.context.completionState?.latestAtCompletion;
    const source = editLatest || !atCompletion?.canComplete
        ? latestAt
        : atCompletion;

    if (!source) {
        setStatus("ยังไม่มีข้อมูล AT ให้บันทึกหรือแก้ไข", "error");
        return;
    }

    const isEdit = Boolean(editLatest || !atCompletion?.canComplete);
    const subtitle = isEdit
        ? `แก้ ${source.levelCode} • ${formatDateDisplay(source.atDate)}`
        : `${state.context.enrollment.currentLevelCode} • ${atAttemptLabel(atCompletion)}`;

    els.atModalTitle.textContent = isEdit ? "แก้ AT ล่าสุด" : "จบ WS Level";
    els.atModalSubtitle.textContent = subtitle;
    fillAtFormFromSource({
        source,
        edit: isEdit
    });

    els.atEditLatest.classList.toggle(
        "hidden",
        isEdit || !atCompletion?.latestAttempt
    );
    els.atModal.classList.remove("hidden");
    window.setTimeout(() => {
        els.atScore.focus();
        els.atScore.select();
    }, 20);
}

function closeAtModal() {
    els.atModal.classList.add("hidden");
}

function validateAtForm() {
    const score = Number(els.atScore.value);
    const maxScore = Number(els.atMaxScore.value);
    const usedTime = Number(els.atTime.value);
    const maxTime = Number(els.atMaxTime.value);
    const atGroup = Number(els.atGroup.value);

    if (!Number.isInteger(score) || score <= 0 || score > maxScore) {
        throw new Error(`Score ต้องอยู่ระหว่าง 1-${maxScore}`);
    }

    if (!Number.isInteger(usedTime) || usedTime <= 0 || usedTime > maxTime) {
        throw new Error(`Time ต้องอยู่ระหว่าง 1-${maxTime}`);
    }

    if (!Number.isInteger(atGroup) || atGroup < 1 || atGroup > 5) {
        throw new Error("Group ต้องอยู่ระหว่าง 1-5");
    }

    return {
        score,
        usedTime,
        atGroup
    };
}

async function saveAtCompletion(event) {
    event.preventDefault();

    if (!state.context) {
        return;
    }

    try {
        const values = validateAtForm();

        els.atSaveButton.disabled = true;
        const result = await worksheetApi.saveAtCompletion({
            enrollmentId: state.context.enrollment.enrollmentId,
            atUsedId: state.atModal.editingAtUsedId,
            atDate: els.atDate.value,
            score: values.score,
            usedTime: values.usedTime,
            atGroup: values.atGroup,
            isPass: state.atModal.isPass
        });

        closeAtModal();
        await loadEnrollmentContext(result.enrollmentId);
        setStatus(
            result.isPass
                ? (result.nextLevelMasterId ? "บันทึก AT ผ่าน และเลื่อน level แล้ว" : "บันทึก AT ผ่านแล้ว")
                : "บันทึก AT ไม่ผ่านแล้ว",
            "success"
        );
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        els.atSaveButton.disabled = false;
    }
}

async function completeZunLevel() {
    if (!state.context || state.isCompletingZun || els.completeZunLevel.disabled) {
        return;
    }

    state.isCompletingZun = true;
    updateSecondaryActions();
    setStatus("กำลังจบ Zun Level...");

    try {
        const result = await worksheetApi.completeZunLevel({
            enrollmentId: state.context.enrollment.enrollmentId
        });
        const message = result.isFinal
            ? "จบ Zun แล้ว และล้าง Zun level เป็นว่าง"
            : `เปลี่ยน Zun เป็น ${result.nextZunLevelCode} แล้ว`;

        await loadEnrollmentContext(result.enrollmentId);
        setStatus(message, "success");
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        state.isCompletingZun = false;
        updateSecondaryActions();
    }
}

async function completeWorksheetLevelWithoutAt() {
    if (!state.context || state.isCompletingLevel || els.completeWsLevel.disabled) {
        return;
    }

    const completion = state.context.completionState?.freeLevelCompletion;

    if (!completion?.canComplete) {
        return;
    }

    if (!window.confirm(`จบ Level ${completion.currentLevelCode} และเลื่อนเป็น ${completion.nextLevelCode} ใช่ไหม?`)) {
        return;
    }

    state.isCompletingLevel = true;
    updateSecondaryActions();
    setStatus("กำลังจบ Level...");

    try {
        const result = await worksheetApi.completeWorksheetLevel({
            enrollmentId: state.context.enrollment.enrollmentId
        });

        await loadEnrollmentContext(result.enrollmentId);
        setStatus(`จบ ${result.previousLevelCode} แล้ว และเปลี่ยนเป็น ${result.nextLevelCode}`, "success");
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        state.isCompletingLevel = false;
        updateSecondaryActions();
    }
}

async function loadEnrollmentContext(enrollmentId) {
    setStatus("กำลังโหลดข้อมูลเด็ก...");

    try {
        const context = await worksheetApi.getEnrollmentContext(
            enrollmentId,
            Number(els.historyLimit.value)
        );

        state.context = context;
        state.history = context.history || [];
        state.worksheetPacketSummary = context.worksheetPacketSummary || null;
        state.worksheetMonthSummary = context.worksheetMonthSummary || null;
        state.patterns = context.patterns || state.patterns;
        state.patternCode = context.defaults.patternCode || "daily10";
        state.progressKind = "main";
        els.receiveDate.disabled = false;
        els.datePrev.disabled = false;
        els.dateNext.disabled = false;
        els.receiveDate.value = context.defaults.receiveDate;
        els.studentSearch.value = `#${context.enrollment.enrollmentId} ${context.enrollment.studentName}`;
        state.hasConfirmedSelection = true;

        populateStudentStrip(context);
        renderPatternButtons();
        renderWorksheetProgress();
        renderWorksheetInputs();
        await refreshWorksheetMonthSummary();
        renderHistoryTable({ scrollToTop: true });
        renderWorksheetPacketSummary(state.worksheetPacketSummary);
        updateSecondaryActions();
        updateHistorySubtitle();
        window.setTimeout(() => focusFirstMainInput(), 30);
    } catch (error) {
        setStatus(error.message, "error");
    }
}

function updateHistorySubtitle() {
    els.historySubtitle.textContent = `ล่าสุด ${els.historyLimit.value} รายการ`;
}

async function refreshHistory() {
    if (!state.context) {
        return;
    }

    try {
        const data = await worksheetApi.getHistory(
            state.context.enrollment.enrollmentId,
            Number(els.historyLimit.value),
            {
                billingDate: els.receiveDate.value
            }
        );

        state.history = data.history || [];
        state.worksheetMonthSummary = data.worksheetMonthSummary || state.worksheetMonthSummary;
        renderHistoryTable({ scrollToTop: true });
        renderWorksheetPacketSummary(state.worksheetPacketSummary);
        renderWorksheetMonthSummary(state.worksheetMonthSummary);
        updateHistorySubtitle();
    } catch (error) {
        setStatus(error.message, "error");
    }
}

function stepWorksheet(kind, index, direction) {
    const input = els.worksheetInputs.querySelector(
        `[data-ws-input][data-kind="${kind}"][data-index="${index}"]`
    );

    if (!input) {
        return;
    }

    input.value = moveWorksheetNo(input.value, optionsForKind(kind), direction);
    focusWorksheetControl(input);
    updatePreview();
}

function focusFirstMainInput() {
    const input = els.worksheetInputs.querySelector(
        `[data-ws-input][data-kind="main"][data-index="0"]`
    );

    if (input) {
        focusWorksheetControl(input);
    }
}

function advanceWorksheet(kind, index) {
    const inputs = [...els.worksheetInputs.querySelectorAll("[data-ws-input]")];
    const currentIndex = inputs.findIndex((input) => (
        input.dataset.kind === kind
        && Number(input.dataset.index) === Number(index)
    ));
    const nextInput = inputs[currentIndex + 1];

    if (nextInput) {
        focusWorksheetControl(nextInput);
        return;
    }

    saveEntries();
}

function shiftDate(days) {
    if (!els.receiveDate.value) {
        return;
    }

    setReceiveDate(addDays(els.receiveDate.value, days));
}

function setSaving(isSaving) {
    state.isSaving = isSaving;
    els.saveButton.disabled = true;
    els.saveButton.textContent = isSaving ? "⏳ Saving" : "💾 Save";
    updatePreview();
}

async function saveEntries() {
    if (!state.context || state.isSaving || els.saveButton.disabled) {
        return;
    }

    const payload = {
        enrollmentId: state.context.enrollment.enrollmentId,
        receiveDate: els.receiveDate.value,
        patternCode: state.patternCode,
        mainWorksheetNos: readWorksheetNos("main"),
        zunWorksheetNos: readWorksheetNos("zun")
    };

    setSaving(true);

    try {
        const result = await worksheetApi.saveEntries(payload);
        const historyLimit = Number(els.historyLimit.value);

        state.history = prependHistoryRows(
            state.history,
            result.records,
            historyLimit
        );
        state.context.history = state.history;
        state.context.completionState = result.completionState;
        state.context.worksheetProgress = result.worksheetProgress || state.context.worksheetProgress;
        state.context.gradeSyncStatus = result.gradeSyncStatus;
        state.context.worksheetPacketSummary = result.worksheetPacketSummary || state.context.worksheetPacketSummary;
        state.worksheetPacketSummary = state.context.worksheetPacketSummary;
        els.receiveDate.value = result.nextReceiveDate;
        await refreshWorksheetMonthSummary();

        renderHistoryTable({ scrollToTop: true });
        renderWorksheetProgress();
        renderWorksheetPacketSummary(state.worksheetPacketSummary);
        updateSecondaryActions();
        setStatus(`บันทึก ${result.records.length} records แล้ว`, "success");
        window.setTimeout(() => focusFirstMainInput(), 30);
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        setSaving(false);
    }
}

async function deleteHistoryRecord(worksheetUsedId) {
    if (!state.context || !worksheetUsedId) {
        return;
    }

    const recordId = Number(worksheetUsedId);
    const row = state.history.find((item) =>
        Number(item.worksheetUsedId) === recordId
    );

    if (
        !row ||
        row.isStockProcessed !== false
    ) {
        return;
    }

    if (!window.confirm("ลบ record นี้ใช่ไหม?")) {
        return;
    }

    try {
        const result = await worksheetApi.deleteEntry({
            enrollmentId: state.context.enrollment.enrollmentId,
            worksheetUsedId: recordId
        });

        state.history = state.history.filter((item) =>
            Number(item.worksheetUsedId) !== recordId
        );
        state.context.history = state.history;
        state.context.completionState = result.completionState || state.context.completionState;
        state.context.worksheetProgress = result.worksheetProgress || state.context.worksheetProgress;
        state.context.gradeSyncStatus = result.gradeSyncStatus;
        state.context.worksheetPacketSummary = result.worksheetPacketSummary || state.context.worksheetPacketSummary;
        state.worksheetPacketSummary = state.context.worksheetPacketSummary;
        await refreshWorksheetMonthSummary();
        renderHistoryTable();
        renderWorksheetProgress();
        renderWorksheetPacketSummary(state.worksheetPacketSummary);
        updateSecondaryActions();
        updateHistorySubtitle();
        setStatus("ลบ record แล้ว", "success");
    } catch (error) {
        setStatus(error.message, "error");
    }
}

async function refreshWorksheetMonthSummary() {
    if (!state.context || !els.receiveDate.value) {
        return;
    }

    try {
        const data = await worksheetApi.getWorksheetSummary(
            state.context.enrollment.enrollmentId,
            {
                billingDate: els.receiveDate.value
            }
        );

        state.worksheetMonthSummary = data.worksheetMonthSummary || null;
        renderWorksheetMonthSummary(state.worksheetMonthSummary);
    } catch (error) {
        setStatus(error.message, "error");
    }
}

function bindEvents() {
    els.subjectButtons.addEventListener("click", (event) => {
        const button = event.target.closest("[data-subject]");

        if (button) {
            setSubjectFilter(button.dataset.subject);
        }
    });

    els.searchMode.addEventListener("click", (event) => {
        const button = event.target.closest("[data-mode]");

        if (button) {
            setSearchMode(button.dataset.mode);
        }
    });

    els.studentSearch.addEventListener("input", () => {
        state.hasConfirmedSelection = false;
        queueSearch();
    });
    els.studentSearch.addEventListener("focus", () => {
        if (state.suppressInitialSearch) {
            state.suppressInitialSearch = false;
            selectStudentSearchText();
            return;
        }

        // Re-focusing a box that still shows a previously picked student
        // (e.g. "#3210 กชพร...") would search for that literal label and
        // find nothing. Clear it instead so focusing shows a fresh browse
        // list, ready to type over.
        if (state.hasConfirmedSelection) {
            state.hasConfirmedSelection = false;
            els.studentSearch.value = "";
        } else {
            selectStudentSearchText();
        }

        queueSearch();
    });
    els.studentSearch.addEventListener("mousedown", (event) => {
        if (document.activeElement === els.studentSearch) {
            event.preventDefault();
            selectStudentSearchText();
        }
    });
    els.studentSearch.addEventListener("click", selectStudentSearchText);
    els.studentSearch.addEventListener("keydown", (event) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            state.activeResultIndex = Math.min(
                state.searchResults.length - 1,
                state.activeResultIndex + 1
            );
            renderSearchResults();
        }

        if (event.key === "ArrowUp") {
            event.preventDefault();
            state.activeResultIndex = Math.max(0, state.activeResultIndex - 1);
            renderSearchResults();
        }

        if (event.key === "Enter") {
            event.preventDefault();
            selectSearchResult(state.activeResultIndex >= 0 ? state.activeResultIndex : 0);
        }
    });

    els.searchResults.addEventListener("mousedown", (event) => {
        const button = event.target.closest("[data-index]");

        if (button) {
            event.preventDefault();
            selectSearchResult(Number(button.dataset.index));
        }
    });

    document.addEventListener("click", (event) => {
        if (
            !els.searchResults.contains(event.target)
            && event.target !== els.studentSearch
        ) {
            els.searchResults.classList.add("hidden");
        }
    });

    els.studentSubjectSelect.addEventListener("change", () => {
        loadEnrollmentContext(els.studentSubjectSelect.value);
    });

    els.patternButtons.addEventListener("click", (event) => {
        const button = event.target.closest("[data-pattern]");

        if (!button) {
            return;
        }

        state.patternCode = button.dataset.pattern;
        renderPatternButtons();
        renderWorksheetInputs({ preserve: true });
        focusFirstMainInput();
    });

    els.worksheetProgressTabs.addEventListener("click", (event) => {
        const button = event.target.closest("[data-progress-kind]");

        if (!button) {
            return;
        }

        state.progressKind = button.dataset.progressKind;
        renderWorksheetProgress();
        renderWorksheetPacketSummary(state.worksheetPacketSummary);
        updateSecondaryActions();
    });

    els.receiveDate.addEventListener("input", () => {
        updatePreview();
        refreshWorksheetMonthSummary();
    });
    els.datePrev.addEventListener("click", () => shiftDate(-1));
    els.dateNext.addEventListener("click", () => shiftDate(1));
    els.saveButton.addEventListener("click", saveEntries);
    els.historyLimit.addEventListener("change", refreshHistory);
    els.historyTableWrap.addEventListener("click", (event) => {
        const button = event.target.closest("[data-delete-history-id]");

        if (button) {
            deleteHistoryRecord(button.dataset.deleteHistoryId);
        }
    });

    els.completeWsLevel.addEventListener("click", () => {
        if (state.context?.completionState?.freeLevelCompletion?.canComplete) {
            completeWorksheetLevelWithoutAt();
            return;
        }

        openAtModal();
    });
    els.completeZunLevel.addEventListener("click", () => {
        completeZunLevel();
    });
    els.receiveCd.addEventListener("click", () => {
        receiveCd();
    });
    els.findIncompleteWs.addEventListener("click", () => {
        openIncompleteWsModal();
    });
    els.incompleteWsClose.addEventListener("click", closeIncompleteWsModal);
    els.incompleteWsModal.addEventListener("mousedown", (event) => {
        if (event.target === els.incompleteWsModal) {
            closeIncompleteWsModal();
        }
    });
    els.incompleteWsTableWrap.addEventListener("click", (event) => {
        const row = event.target.closest("[data-incomplete-enrollment-id]");

        if (row) {
            selectIncompleteWsEnrollment(row.dataset.incompleteEnrollmentId);
        }
    });
    els.atForm.addEventListener("submit", saveAtCompletion);
    els.atCancel.addEventListener("click", closeAtModal);
    els.atModal.addEventListener("mousedown", (event) => {
        if (event.target === els.atModal) {
            closeAtModal();
        }
    });
    els.atPassControl.addEventListener("click", (event) => {
        const button = event.target.closest("[data-at-pass]");

        if (button) {
            setAtPass(button.dataset.atPass === "true");
        }
    });
    els.atEditLatest.addEventListener("click", () => {
        const latestAttempt = state.context?.completionState?.atCompletion?.latestAttempt;

        if (latestAttempt) {
            els.atModalTitle.textContent = "แก้ AT ล่าสุด";
            els.atModalSubtitle.textContent = `แก้ ${latestAttempt.levelCode} • ${formatDateDisplay(latestAttempt.atDate)}`;
            fillAtFormFromSource({
                source: latestAttempt,
                edit: true
            });
            els.atEditLatest.classList.add("hidden");
        }
    });
    [
        els.atScore,
        els.atTime,
        els.atGroup
    ].forEach((input) => {
        input.addEventListener("input", updateAtSaveState);
    });
    els.atScore.addEventListener("keydown", (event) => moveAtFocus(event, els.atTime));
    els.atTime.addEventListener("keydown", (event) => moveAtFocus(event, els.atGroup));
    els.atGroup.addEventListener("keydown", handleAtGroupKeydown);

    bindWorksheetKeyboard(document, {
        stepWorksheet,
        advanceWorksheet,
        shiftDate
    });
}

function init() {
    bindFourDigitYearDateInputs(document);
    els.datePrev.disabled = true;
    els.dateNext.disabled = true;
    renderWorksheetProgress();
    bindEvents();
    state.suppressInitialSearch = true;
    els.studentSearch.focus();
}

init();
