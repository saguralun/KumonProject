import { worksheetApi } from "./worksheetApi.js";
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
    datePrev: document.getElementById("datePrev"),
    dateNext: document.getElementById("dateNext"),
    patternButtons: document.getElementById("patternButtons"),
    worksheetInputs: document.getElementById("worksheetInputs"),
    previewCount: document.getElementById("previewCount"),
    previewList: document.getElementById("previewList"),
    saveButton: document.getElementById("saveButton"),
    completeWsLevel: document.getElementById("completeWsLevel"),
    completeZunLevel: document.getElementById("completeZunLevel"),
    receiveCd: document.getElementById("receiveCd"),
    previewReceipt: document.getElementById("previewReceipt"),
    historyLimit: document.getElementById("historyLimit"),
    historySubtitle: document.getElementById("historySubtitle"),
    historyTableWrap: document.getElementById("historyTableWrap")
};

const state = {
    subjectFilter: "ALL",
    searchMode: "id",
    searchResults: [],
    activeResultIndex: -1,
    searchRequestId: 0,
    searchTimer: null,
    context: null,
    history: [],
    patterns: [],
    patternCode: "daily10",
    isSaving: false
};

function setStatus(message, type = "neutral") {
    els.statusLine.textContent = message;
    els.statusLine.classList.toggle("is-error", type === "error");
    els.statusLine.classList.toggle("is-success", type === "success");
}

function currentPattern() {
    return selectedPattern(state.patterns, state.patternCode);
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
            limit: 20
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
    els.studentName.textContent = enrollment.studentName;
    els.studentMeta.textContent = [
        `ID ${enrollment.enrollmentId}`,
        enrollment.subjectCode,
        `Current ${enrollment.currentLevelCode}`,
        enrollment.currentZunLevelCode ? `Zun ${enrollment.currentZunLevelCode}` : "No Zun",
        enrollment.statusName
    ].join(" • ");
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

function renderWorksheetField({
    kind,
    index,
    label,
    value,
    listId
}) {
    return `
        <label class="worksheet-field">
            <span class="worksheet-field-label">${escapeHtml(label)}</span>
            <div class="worksheet-stepper">
                <button type="button" class="icon-button" data-step="-1" data-kind="${kind}" data-index="${index}" aria-label="Previous worksheet">‹</button>
                <input
                    type="text"
                    inputmode="numeric"
                    autocomplete="off"
                    list="${escapeHtml(listId)}"
                    value="${escapeHtml(value)}"
                    data-ws-input
                    data-kind="${kind}"
                    data-index="${index}"
                >
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
    const listId = `${kind}WorksheetOptions`;
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
                    listId
                })).join("")}
            </div>
            ${renderOptionsDatalist(listId, options)}
        </fieldset>
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
    const sections = [
        renderInputSection({
            kind: "main",
            title: "Main WS",
            levelCode: state.context.enrollment.currentLevelCode,
            values: mainValues,
            options: state.context.worksheetOptions.main
        })
    ];

    if (state.context.enrollment.currentZunLevelMasterId) {
        const zunValues = buildInputValues({
            kind: "zun",
            pattern,
            previousValues: previousZun
        });

        sections.push(renderInputSection({
            kind: "zun",
            title: "Zun",
            levelCode: state.context.enrollment.currentZunLevelCode,
            values: zunValues,
            options: state.context.worksheetOptions.zun,
            optional: true
        }));
    }

    els.worksheetInputs.innerHTML = sections.join("");
    els.worksheetInputs.querySelectorAll("[data-ws-input]").forEach((input) => {
        input.addEventListener("input", updatePreview);
        input.addEventListener("focus", () => input.select());
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
            <div class="preview-flag ${record.cpws ? "cpws" : "auto"}">
                ${record.cpws ? "CPWS" : "auto"}
            </div>
        </div>
    `).join("");
}

function updatePreview() {
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
    const canSave = Boolean(
        state.context
        && !state.isSaving
        && els.receiveDate.value
        && requiredMainReady(pattern, mainWorksheetNos)
    );

    els.previewCount.textContent = `${records.length} records`;
    els.saveButton.disabled = !canSave;
    renderPreviewList(records);
}

function renderHistoryTable({ scrollToTop = false } = {}) {
    renderHistory(els.historyTableWrap, state.history);

    if (scrollToTop) {
        els.historyTableWrap.scrollTop = 0;
        els.historyTableWrap.scrollLeft = 0;
    }
}

function updateSecondaryActions() {
    const context = state.context;

    if (!context) {
        els.completeWsLevel.disabled = true;
        els.completeZunLevel.disabled = true;
        els.receiveCd.disabled = true;
        els.previewReceipt.disabled = true;
        return;
    }

    els.completeWsLevel.disabled = !context.completionState?.canCompleteWsLevel;
    els.completeZunLevel.disabled = !(
        context.enrollment.currentZunLevelMasterId
        && context.completionState?.canCompleteZunLevel
    );
    els.previewReceipt.disabled = false;

    const hasCdMaster = context.cdState?.hasCdMaster;
    const hasReceivedCd = context.cdState?.hasReceivedCd;
    els.receiveCd.disabled = !hasCdMaster || hasReceivedCd;
    els.receiveCd.textContent = hasReceivedCd ? "รับ CD แล้ว" : "รับ CD";
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
        state.patterns = context.patterns || state.patterns;
        state.patternCode = context.defaults.patternCode || "daily10";
        els.receiveDate.disabled = false;
        els.datePrev.disabled = false;
        els.dateNext.disabled = false;
        els.receiveDate.value = context.defaults.receiveDate;

        populateStudentStrip(context);
        renderPatternButtons();
        renderWorksheetInputs();
        renderHistoryTable({ scrollToTop: true });
        updateSecondaryActions();
        updateHistorySubtitle();
        setStatus("พร้อมบันทึก WS", "success");
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
            Number(els.historyLimit.value)
        );

        state.history = data.history || [];
        renderHistoryTable({ scrollToTop: true });
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
    input.focus();
    input.select();
    updatePreview();
}

function focusFirstMainInput() {
    const input = els.worksheetInputs.querySelector(
        `[data-ws-input][data-kind="main"][data-index="0"]`
    );

    if (input) {
        input.focus();
        input.select();
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
        nextInput.focus();
        nextInput.select();
        return;
    }

    saveEntries();
}

function shiftDate(days) {
    if (!els.receiveDate.value) {
        return;
    }

    els.receiveDate.value = addDays(els.receiveDate.value, days);
    updatePreview();
}

function setSaving(isSaving) {
    state.isSaving = isSaving;
    els.saveButton.disabled = true;
    els.saveButton.textContent = isSaving ? "Saving" : "Save";
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
        els.receiveDate.value = result.nextReceiveDate;

        renderHistoryTable({ scrollToTop: true });
        updateSecondaryActions();
        setStatus(`บันทึก ${result.records.length} records แล้ว`, "success");
        window.setTimeout(() => focusFirstMainInput(), 30);
    } catch (error) {
        setStatus(error.message, "error");
    } finally {
        setSaving(false);
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

    els.studentSearch.addEventListener("input", queueSearch);
    els.studentSearch.addEventListener("focus", () => {
        selectStudentSearchText();
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

    els.receiveDate.addEventListener("input", updatePreview);
    els.datePrev.addEventListener("click", () => shiftDate(-1));
    els.dateNext.addEventListener("click", () => shiftDate(1));
    els.saveButton.addEventListener("click", saveEntries);
    els.historyLimit.addEventListener("change", refreshHistory);

    els.completeWsLevel.addEventListener("click", () => {
        setStatus("จบ WS Level เตรียมไว้แล้ว");
    });
    els.completeZunLevel.addEventListener("click", () => {
        setStatus("จบ Zun Level เตรียมไว้แล้ว");
    });
    els.receiveCd.addEventListener("click", () => {
        setStatus("รับ CD เตรียมไว้แล้ว");
    });
    els.previewReceipt.addEventListener("click", () => {
        setStatus("Preview Receipt เตรียมไว้แล้ว");
    });

    bindWorksheetKeyboard(document, {
        stepWorksheet,
        advanceWorksheet,
        shiftDate
    });
}

function init() {
    els.datePrev.disabled = true;
    els.dateNext.disabled = true;
    bindEvents();
    runSearch();
    els.studentSearch.focus();
}

init();
