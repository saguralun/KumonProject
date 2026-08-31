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
    selectSearchResult,
    selectStudentSearchText,
    setSearchMode,
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
    closeIncompleteWsModal,
    openIncompleteWsModal,
    selectIncompleteWsEnrollment
} from "./worksheetIncomplete.js";

export async function loadEnrollmentContext(enrollmentId) {
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

function renderHistoryTable({ scrollToTop = false } = {}) {
    renderHistory(els.historyTableWrap, state.history, state.worksheetMonthSummary);

    if (scrollToTop) {
        els.historyTableWrap.scrollTop = 0;
        els.historyTableWrap.scrollLeft = 0;
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
        mainWorksheetNos: readWorksheetNosFromDom("main"),
        zunWorksheetNos: readWorksheetNosFromDom("zun")
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

// Same field-reading logic as worksheetPreview.js's readWorksheetNos —
// duplicated as a 3-line function rather than imported, since importing it
// here would add a 4th module needing to reach back into worksheet.js's
// exports for no real benefit (this is the only place in this file that
// needs it).
function readWorksheetNosFromDom(kind) {
    return [...els.worksheetInputs.querySelectorAll(`[data-ws-input][data-kind="${kind}"]`)]
        .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
        .map((input) => input.value.trim());
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
