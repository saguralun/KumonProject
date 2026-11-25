// Orchestrator for the WS Input page: loads a student's enrollment context,
// wires up every control (bindEvents), and owns the core save/history-edit
// flow. Everything else — search, the progress/input/summary/CD preview
// cycle, the AT modal, and the incomplete-WS modal — lives in its own
// sibling module and gets imported here. loadEnrollmentContext is exported
// because three of those siblings (worksheetSearch.js, worksheetAt.js,
// worksheetIncomplete.js) need to call back into it once their own action
// finishes (picking a student, saving an AT, jumping to a student from the
// incomplete-WS list) — a circular import with each of them, which is fine
// since none of those calls happen at module-load time, only from inside
// event handlers well after every module has finished initializing.
import { bindFourDigitYearDateInputs } from "../dateInputYear.js";
import { els, setStatus, state } from "./worksheetState.js";
import {
    addDays,
    formatDateDisplay
} from "./worksheetInput.js";
import {
    prependHistoryRows,
    renderHistory
} from "./worksheetHistory.js";
import { bindWorksheetKeyboard } from "./worksheetKeyboard.js";
import { worksheetApi } from "./worksheetApi.js";
import {
    focusWorksheetControl,
    receiveCd,
    readWorksheetNos,
    refreshWorksheetMonthSummary,
    renderPatternButtons,
    renderWorksheetInputs,
    renderWorksheetMonthSummary,
    renderWorksheetPacketSummary,
    renderWorksheetProgress,
    setReceiveDate,
    stepWorksheet,
    updatePreview,
    updateSecondaryActions
} from "./worksheetPreview.js";
import {
    populateStudentStrip,
    queueSearch,
    renderSearchResults,
    runSearch,
    selectSearchResult,
    selectStudentSearchText,
    setSubjectFilter
} from "./worksheetSearch.js";
import {
    closeAtModal,
    completeWorksheetLevelWithoutAt,
    completeZunLevel,
    fillAtFormFromSource,
    handleAtGroupKeydown,
    moveAtFocus,
    openAtModal,
    saveAtCompletion,
    setAtPass,
    updateAtSaveState
} from "./worksheetAt.js";
import {
    changeIncompleteWsPage,
    closeIncompleteWsModal,
    openIncompleteWsModal,
    selectIncompleteWsEnrollment
} from "./worksheetIncomplete.js";

let contextGeneration = 0;
let worksheetLeaveBaseline = null;
function worksheetLeaveSnapshot() {
    return JSON.stringify({ enrollmentId: state.context?.enrollment.enrollmentId,
        receiveDate: els.receiveDate.value, patternCode: state.patternCode,
        main: readWorksheetNos('main'), zun: readWorksheetNos('zun') });
}
window.kumonLeaveGuard?.register('WS', () => ({
    dirty: Boolean(state.context && worksheetLeaveBaseline !== null && worksheetLeaveSnapshot() !== worksheetLeaveBaseline)
        || state.historyDateDrafts.size > 0
        || [...els.historyTableWrap.querySelectorAll('input[data-edit-history-date-id],input[data-edit-history-number-id]')].some(input => input.value !== input.defaultValue),
    busy: state.isSaving || state.pendingHistoryEdits.size > 0 || state.isCompletingLevel || state.isCompletingZun
}));
export async function loadEnrollmentContext(enrollmentId, { resetMainLevelMasterId = null } = {}) {
    if (state.isSaving) return;
    const previousContext = state.context;
    const previousEnrollmentId = Number(previousContext?.enrollment.enrollmentId);
    const changingEnrollment = previousContext && previousEnrollmentId !== Number(enrollmentId);
    const discardDates = changingEnrollment && state.historyDateDrafts.has(previousEnrollmentId)
        && !state.pendingHistoryEdits.has(previousEnrollmentId);
    if (discardDates && (!await confirmAction('มีวันที่ WS ที่ยังไม่บันทึก ต้องการเปลี่ยนนักเรียน/วิชาและทิ้งวันที่ที่แก้ไว้หรือไม่?') || state.context !== previousContext)) {
        if (state.context === previousContext) {
            els.studentSubjectSelect.value = String(previousEnrollmentId);
            els.studentSearch.value = `#${previousEnrollmentId} ${previousContext.enrollment.studentName}`;
        }
        return;
    }
    const generation = ++contextGeneration;
    state.contextRequestId = generation;
    state.isLoadingContext = true;
    updatePreview();
    setStatus("กำลังโหลดข้อมูลเด็ก...");
    // Any successful load should close out the search dropdown, even when
    // it wasn't the one that triggered this — e.g. picking a student from
    // the "หา WS ค้าง" modal leaves a stale search-results list open
    // otherwise, since that path never touches els.searchResults itself.
    els.searchResults.classList.add("hidden");

    try {
        const context = await worksheetApi.getEnrollmentContext(
            enrollmentId,
            Number(els.historyLimit.value)
        );

        if (generation !== contextGeneration || state.isSaving) return;
        if (discardDates) state.historyDateDrafts.delete(previousEnrollmentId);
        if (resetMainLevelMasterId != null
            && Number(context.enrollment.currentLevelMasterId) === Number(resetMainLevelMasterId)
            && context.worksheetOptions?.main?.some((option) => Number(option.worksheetNo) === 1)) {
            context.defaults.mainWorksheetNo = 1;
        }
        state.context = context;
        state.isLoadingContext = false;
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
        worksheetLeaveBaseline = worksheetLeaveSnapshot();
        // Paint the new student's history with the header, without waiting on a summary request.
        renderHistoryTable({ scrollToTop: true });
        renderWorksheetPacketSummary(state.worksheetPacketSummary);
        updateSecondaryActions();
        updateHistorySubtitle();
        await refreshWorksheetMonthSummary();
        if (generation !== contextGeneration) return;
        renderHistoryTable();
        window.setTimeout(() => focusFirstMainInput(), 30);
    } catch (error) {
        if (generation === contextGeneration) {
            state.isLoadingContext = false;
            if (state.context) {
                els.studentSubjectSelect.value = String(state.context.enrollment.enrollmentId);
                els.studentSearch.value = `#${state.context.enrollment.enrollmentId} ${state.context.enrollment.studentName}`;
            }
            updatePreview(); setStatus(error.message, "error");
        }
    }
}

function renderHistoryTable({ scrollToTop = false } = {}) {
    renderHistory(els.historyTableWrap, state.history, state.worksheetMonthSummary);
    const drafts = state.historyDateDrafts.get(Number(state.context?.enrollment.enrollmentId));
    for (const input of els.historyTableWrap.querySelectorAll('[data-edit-history-date-id]')) {
        const draft = drafts?.get(Number(input.dataset.editHistoryDateId));
        if (draft !== undefined) input.value = draft;
        syncHistoryDateDraft(input);
    }
    syncHistoryNumberEditControls();

    if (scrollToTop) {
        els.historyTableWrap.scrollTop = 0;
        els.historyTableWrap.scrollLeft = 0;
    }
}

function clearHistoryDateDraft(enrollmentId, recordId) {
    const drafts = state.historyDateDrafts.get(enrollmentId);
    drafts?.delete(recordId);
    if (!drafts?.size) state.historyDateDrafts.delete(enrollmentId);
    updateHistorySubtitle();
}

function syncHistoryDateDraft(input, { cancel = false } = {}) {
    if (!state.context) return;
    const enrollmentId = Number(state.context.enrollment.enrollmentId);
    const recordId = Number(input.dataset.editHistoryDateId);
    const row = state.history.find(item => Number(item.worksheetUsedId) === recordId);
    if (!row) return;
    if (cancel) input.value = row.worksheetDate;
    const dirty = input.value !== row.worksheetDate;
    if (dirty) {
        if (!state.historyDateDrafts.has(enrollmentId)) state.historyDateDrafts.set(enrollmentId, new Map());
        state.historyDateDrafts.get(enrollmentId).set(recordId, input.value);
    } else clearHistoryDateDraft(enrollmentId, recordId);
    const notice = input.parentElement.querySelector('[data-history-date-draft-id]');
    notice.hidden = !dirty;
    input.classList.toggle('has-date-draft', dirty);
    updateHistorySubtitle();
}

function syncHistoryNumberEditControls() {
    if (!state.pendingHistoryEdits.has(Number(state.context?.enrollment.enrollmentId))) return;
    for (const control of els.historyTableWrap.querySelectorAll('input,button')) control.disabled = true;
}

function updateHistorySubtitle() {
    const draftCount = [...state.historyDateDrafts.values()].reduce((count, drafts) => count + drafts.size, 0);
    els.historySubtitle.textContent = `ล่าสุด ${els.historyLimit.value} รายการ${draftCount ? ` • วันที่ยังไม่บันทึก ${draftCount} รายการ` : ''}`;
}

async function refreshHistory() {
    if (!state.context) {
        return;
    }

    const context = state.context, date = els.receiveDate.value, limit = Number(els.historyLimit.value);
    try {
        const data = await worksheetApi.getHistory(
            context.enrollment.enrollmentId,
            limit,
            {
                billingDate: date
            }
        );
        if (state.context !== context || els.receiveDate.value !== date || Number(els.historyLimit.value) !== limit) return;

        state.history = data.history || [];
        state.worksheetMonthSummary = data.worksheetMonthSummary || state.worksheetMonthSummary;
        renderHistoryTable({ scrollToTop: true });
        renderWorksheetPacketSummary(state.worksheetPacketSummary);
        renderWorksheetMonthSummary(state.worksheetMonthSummary);
        updateHistorySubtitle();
        return true;
    } catch (error) {
        if (state.context === context && els.receiveDate.value === date) setStatus(error.message, "error");
        return false;
    }
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
    if (state.isSaving || !els.receiveDate.value) {
        return;
    }

    setReceiveDate(addDays(els.receiveDate.value, days));
}

function setSaving(isSaving) {
    state.isSaving = isSaving;
    for (const element of [els.studentSearch, els.studentSubjectSelect, els.receiveDate, els.datePrev, els.dateNext, els.historyLimit, els.findIncompleteWs]) {
        element.disabled = isSaving;
    }
    els.saveButton.disabled = true;
    els.saveButton.textContent = isSaving ? "⏳ กำลังบันทึก" : "💾 บันทึก";
    updatePreview();
}

async function saveEntries() {
    if (!state.context || state.isSaving || state.isLoadingContext || els.saveButton.disabled) {
        return;
    }

    const payload = {
        enrollmentId: state.context.enrollment.enrollmentId,
        expectedMainLevelMasterId: state.context.enrollment.currentLevelMasterId,
        expectedZunLevelMasterId: state.context.enrollment.currentZunLevelMasterId ?? null,
        receiveDate: els.receiveDate.value,
        patternCode: state.patternCode,
        mainWorksheetNos: readWorksheetNos("main"),
        zunWorksheetNos: readWorksheetNos("zun")
    };
    const context = state.context;
    const generation = contextGeneration;
    let outcome = null;

    setSaving(true);

    try {
        const result = await worksheetApi.saveEntries(payload);
        if (state.context !== context || generation !== contextGeneration) {
            outcome = { message: `บันทึก WS #${payload.enrollmentId} แล้ว กรุณาโหลดประวัติใหม่`, kind: 'success' };
            return;
        }
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
        worksheetLeaveBaseline = worksheetLeaveSnapshot();
        await refreshWorksheetMonthSummary();

        renderHistoryTable({ scrollToTop: true });
        renderWorksheetProgress();
        renderWorksheetPacketSummary(state.worksheetPacketSummary);
        updateSecondaryActions();
        outcome = { message: `บันทึก ${result.records.length} รายการแล้ว`, kind: 'success' };
        window.setTimeout(() => focusFirstMainInput(), 30);
    } catch (error) {
        outcome = { message: error.message, kind: 'error' };
    } finally {
        setSaving(false);
        if (outcome) setStatus(outcome.message, outcome.kind);
    }
}

async function deleteHistoryRecord(worksheetUsedId) {
    if (!state.context || !worksheetUsedId || state.pendingHistoryEdits.has(Number(state.context.enrollment.enrollmentId))) {
        return;
    }

    const context = state.context;
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

    if (!await confirmAction("ลบ record นี้ใช่ไหม?", { focusConfirm: true })) {
        return;
    }
    if (state.context !== context || state.isSaving || state.pendingHistoryEdits.has(Number(context.enrollment.enrollmentId))) return;

    try {
        const result = await worksheetApi.deleteEntry({
            enrollmentId: context.enrollment.enrollmentId,
            worksheetUsedId: recordId
        });
        clearHistoryDateDraft(Number(context.enrollment.enrollmentId), recordId);
        if (state.context !== context) return;

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

async function updateHistoryRecordDate(worksheetUsedId, worksheetDate, input) {
    if (!state.context || state.isSaving || state.isLoadingContext || input.disabled || !worksheetUsedId
        || state.pendingHistoryEdits.has(Number(state.context.enrollment.enrollmentId))) {
        return;
    }
    if (!input.checkValidity()) { input.reportValidity(); return; }

    const recordId = Number(worksheetUsedId);
    const row = state.history.find((item) =>
        Number(item.worksheetUsedId) === recordId
    );

    if (
        !row ||
        row.isStockProcessed !== false ||
        row.worksheetDate === worksheetDate
    ) {
        return;
    }

    const context = state.context, generation = contextGeneration;
    const enrollmentId = Number(context.enrollment.enrollmentId);
    const isCurrent = () => state.context === context && generation === contextGeneration;
    state.pendingHistoryEdits.add(enrollmentId);
    syncHistoryNumberEditControls();
    updatePreview();
    setStatus("กำลังแก้วันที่...");
    let outcome;

    try {
        const result = await worksheetApi.updateEntryDate({
            enrollmentId: context.enrollment.enrollmentId,
            worksheetUsedId: recordId,
            worksheetDate
        });
        clearHistoryDateDraft(enrollmentId, recordId);
        if (!isCurrent()) return;

        // The date has already been saved even if the history request fails.
        const savedEntry = result.entry || { ...row, worksheetDate };
        state.history = state.history.map((item) =>
            Number(item.worksheetUsedId) === recordId ? savedEntry : item
        );
        context.history = state.history;
        renderHistoryTable();
        state.context.completionState = result.completionState || state.context.completionState;
        state.context.worksheetProgress = result.worksheetProgress || state.context.worksheetProgress;
        state.context.gradeSyncStatus = result.gradeSyncStatus;
        state.context.worksheetPacketSummary = result.worksheetPacketSummary || state.context.worksheetPacketSummary;
        state.worksheetPacketSummary = state.context.worksheetPacketSummary;
        const refreshed = await refreshHistory();
        if (!isCurrent()) return;
        renderWorksheetProgress();
        renderWorksheetPacketSummary(state.worksheetPacketSummary);
        updateSecondaryActions();
        outcome = refreshed
            ? ["แก้วันที่แล้ว", "success"]
            : ["แก้วันที่แล้ว แต่โหลดประวัติใหม่ไม่สำเร็จ กรุณาโหลดอีกครั้ง", "neutral"];
    } catch (error) {
        if (!isCurrent()) return;
        outcome = [error.message, "error"];
    } finally {
        state.pendingHistoryEdits.delete(enrollmentId);
        input.disabled = false;
        if (isCurrent()) {
            for (const control of els.historyTableWrap.querySelectorAll('input,button')) control.disabled = false;
            updatePreview();
            if (outcome) setStatus(...outcome);
        }
    }
}

async function updateHistoryRecordNumber(input) {
    const context = state.context, generation = contextGeneration;
    if (!context || state.isSaving || state.isLoadingContext || state.isCompletingLevel || state.isCompletingZun || input.disabled
        || state.pendingHistoryEdits.has(Number(context.enrollment.enrollmentId))
        || els.historyTableWrap.querySelector('.history-date-input:disabled')) return;
    const recordId = Number(input.dataset.editHistoryNumberId);
    const row = state.history.find(item => Number(item.worksheetUsedId) === recordId);
    if (!row || row.isStockProcessed !== false) return;
    if (!input.checkValidity()) { input.reportValidity(); return; }
    const worksheetNo = Number(input.value);
    if (worksheetNo === Number(row.actualWorksheetNo)) return;
    const enrollmentId = Number(context.enrollment.enrollmentId);
    const isCurrent = () => state.context === context && generation === contextGeneration;
    state.pendingHistoryEdits.add(enrollmentId);
    syncHistoryNumberEditControls(); updatePreview(); setStatus('กำลังแก้เลข WS...');
    let outcome;
    try {
        const result = await worksheetApi.updateEntryNumber({ enrollmentId, worksheetUsedId: recordId, worksheetNo,
            expectedWorksheetMasterId: row.worksheetMasterId, expectedActualWorksheetNo: row.actualWorksheetNo });
        if (!isCurrent()) return;
        if (result.entry) {
            state.history = state.history.map(item => Number(item.worksheetUsedId) === recordId ? result.entry : item);
            context.history = state.history;
            renderHistoryTable();
        }
        context.completionState = result.completionState || context.completionState;
        context.worksheetProgress = result.worksheetProgress || context.worksheetProgress;
        context.gradeSyncStatus = result.gradeSyncStatus;
        context.worksheetPacketSummary = result.worksheetPacketSummary || context.worksheetPacketSummary;
        state.worksheetPacketSummary = context.worksheetPacketSummary;
        const refreshed = await refreshHistory();
        if (!isCurrent()) return;
        renderWorksheetProgress(); renderWorksheetPacketSummary(state.worksheetPacketSummary);
        outcome = refreshed ? ['แก้เลข WS แล้ว', 'success'] : ['แก้เลข WS แล้ว แต่โหลดประวัติใหม่ไม่สำเร็จ กรุณาโหลดอีกครั้ง', 'neutral'];
    } catch (error) {
        if (!isCurrent()) return;
        input.value = row.actualWorksheetNo;
        outcome = [error.message, 'error'];
    } finally {
        state.pendingHistoryEdits.delete(enrollmentId);
        if (isCurrent()) {
            for (const control of els.historyTableWrap.querySelectorAll('input,button')) control.disabled = false;
            updatePreview();
            if (outcome) setStatus(...outcome);
        }
    }
}

function bindEvents() {
    els.subjectButtons.addEventListener("click", (event) => {
        const button = event.target.closest("[data-subject]");

        if (button) {
            setSubjectFilter(button.dataset.subject);
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
    els.studentSearch.addEventListener("keydown", async (event) => {
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
            if (!state.searchResults.length) {
                window.clearTimeout(state.searchTimer);
                if (!await runSearch()) return;
            }
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
    els.receiveDate.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            // Native date input has nothing to "submit" to — jump straight
            // into worksheet entry instead of just losing focus.
            event.preventDefault();
            focusFirstMainInput();
        }
    });
    els.datePrev.addEventListener("click", () => shiftDate(-1));
    els.dateNext.addEventListener("click", () => shiftDate(1));
    els.saveButton.addEventListener("click", saveEntries);
    els.historyLimit.addEventListener("change", refreshHistory);
    els.historyTableWrap.addEventListener("click", (event) => {
        const dateAction = event.target.closest('[data-save-history-date-id],[data-cancel-history-date-id]');
        if (dateAction) {
            const recordId = dateAction.dataset.saveHistoryDateId || dateAction.dataset.cancelHistoryDateId;
            const input = els.historyTableWrap.querySelector(`[data-edit-history-date-id="${Number(recordId)}"]`);
            if (!input || input.disabled) return;
            if (dateAction.hasAttribute('data-save-history-date-id')) void updateHistoryRecordDate(recordId, input.value, input);
            else { syncHistoryDateDraft(input, { cancel: true }); input.focus(); }
            return;
        }
        const button = event.target.closest("[data-delete-history-id]");

        if (button) {
            deleteHistoryRecord(button.dataset.deleteHistoryId);
        }
    });
    els.historyTableWrap.addEventListener('input', event => {
        const input = event.target.closest('[data-edit-history-date-id]');
        if (input && !input.disabled) syncHistoryDateDraft(input);
    });
    els.historyTableWrap.addEventListener("keydown", (event) => {
        const numberInput = event.target.closest('[data-edit-history-number-id]');
        if (numberInput) {
            if (event.key === 'Enter') { event.preventDefault(); void updateHistoryRecordNumber(numberInput); }
            if (event.key === 'Escape' && !numberInput.disabled) {
                const row = state.history.find(item => Number(item.worksheetUsedId) === Number(numberInput.dataset.editHistoryNumberId));
                numberInput.value = row?.actualWorksheetNo ?? numberInput.defaultValue;
                numberInput.blur();
            }
            return;
        }
        const input = event.target.closest("[data-edit-history-date-id]");

        if (!input) {
            return;
        }

        if (event.key === "Enter") {
            event.preventDefault();
            updateHistoryRecordDate(
                input.dataset.editHistoryDateId,
                input.value,
                input
            );
        }

        if (event.key === "Escape" && !input.disabled) {
            syncHistoryDateDraft(input, { cancel: true });
            input.blur();
        }
    });
    els.historyTableWrap.addEventListener("blur", (event) => {
        const numberInput = event.target.closest('[data-edit-history-number-id]');
        if (numberInput && !numberInput.disabled) {
            const row = state.history.find(item => Number(item.worksheetUsedId) === Number(numberInput.dataset.editHistoryNumberId));
            numberInput.value = row?.actualWorksheetNo ?? numberInput.defaultValue;
            return;
        }
        const input = event.target.closest("[data-edit-history-date-id]");

        if (input && !input.disabled) {
            syncHistoryDateDraft(input);
        }
    }, true);

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
    els.incompleteWsTableWrap.addEventListener("click", (event) => {
        const pageButton = event.target.closest("[data-incomplete-page]");

        if (pageButton) {
            changeIncompleteWsPage(pageButton.dataset.incompleteSection, pageButton.dataset.incompletePage);
            return;
        }

        const row = event.target.closest("[data-incomplete-enrollment-id]");

        if (row) {
            selectIncompleteWsEnrollment(row.dataset.incompleteEnrollmentId);
        }
    });
    els.atForm.addEventListener("submit", saveAtCompletion);
    els.editLastAtButton.addEventListener('click', () => {
        if (!els.editLastAtButton.disabled) openAtModal({ editLatest: true });
    });
    els.atCancel.addEventListener("click", closeAtModal);
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
