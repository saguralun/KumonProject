// AT (achievement test) modal + level/Zun completion. loadEnrollmentContext
// is imported from the main worksheet.js — same circular-import shape as
// worksheetSearch.js/worksheetIncomplete.js, safe for the same reason (only
// ever called from inside event handlers, never at module-load time).
import { els, setStatus, state } from "./worksheetState.js";
import { formatDateDisplay } from "./worksheetInput.js";
import { worksheetApi } from "./worksheetApi.js";
import { updateSecondaryActions } from "./worksheetPreview.js";
import { loadEnrollmentContext } from "./worksheet.js";

let pendingAtSave = null;
let atModalRevision = 0;

function captureContext() {
    return { context: state.context, requestId: state.contextRequestId };
}

function isCurrentContext(scope) {
    return state.context === scope.context && state.contextRequestId === scope.requestId && !state.isLoadingContext;
}

async function refreshCompletedContext(scope, enrollmentId) {
    if (!isCurrentContext(scope)) return false;
    const refresh = loadEnrollmentContext(enrollmentId);
    const requestId = state.contextRequestId;
    await refresh;
    // The loader catches its own failures. A successful refresh must replace
    // the context, and a newer navigation must retain its own status/result.
    return state.contextRequestId === requestId && !state.isLoadingContext
        && state.context !== scope.context && Number(state.context?.enrollment.enrollmentId) === Number(enrollmentId);
}

export function setAtPass(isPass) {
    if (pendingAtSave) return;
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

    return (
        Number.isInteger(score)
        && score > 0
        && score <= maxScore
        && Number.isInteger(usedTime)
        && usedTime > 0
        && Number.isInteger(atGroup)
        && atGroup >= 1
        && atGroup <= 5
    );
}

export function updateAtSaveState() {
    els.atSaveButton.disabled = Boolean(pendingAtSave) || !isAtFormReady();
}

function focusAndSelect(input) {
    input.focus();

    if (typeof input.select === "function") {
        input.select();
    }
}

export function moveAtFocus(event, nextElement) {
    if (pendingAtSave) { event.preventDefault(); return; }
    if (event.key !== "Enter" && event.key !== "Tab") {
        return;
    }

    if (event.key === "Tab" && event.shiftKey) {
        return;
    }

    event.preventDefault();
    focusAndSelect(nextElement);
}

export function changeAtGroup(delta) {
    if (pendingAtSave) return;
    const current = Number.parseInt(els.atGroup.value, 10);
    const baseValue = Number.isInteger(current) ? current : 1;
    const nextValue = Math.min(5, Math.max(1, baseValue + delta));

    els.atGroup.value = String(nextValue);
    updateAtSaveState();
}

export function handleAtGroupKeydown(event) {
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

export function fillAtFormFromSource({
    source,
    edit = false
}) {
    if (pendingAtSave || !state.context || state.isLoadingContext) return;
    atModalRevision++;
    const enrollment = state.context.enrollment;
    const latestAttempt = source?.latestAttempt || null;
    const attempt = edit ? source : latestAttempt;

    state.atModal.editingAtUsedId = edit ? source.atUsedId : null;
    state.atModal.source = source;
    state.atModal.enrollmentId = enrollment.enrollmentId;
    state.atModal.expectedAtMasterId = source.atMasterId;
    state.atModal.expectedLevelMasterId = edit ? source.levelMasterId : enrollment.currentLevelMasterId;
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
    els.atTime.removeAttribute("max");
    els.atScore.value = edit && attempt ? attempt.score : "";
    els.atTime.value = edit && attempt ? attempt.usedTime : "";
    els.atGroup.value = edit && attempt ? attempt.atGroup : 1;
    els.atSaveButton.textContent = edit ? "💾 บันทึกการแก้ไข" : "💾 บันทึก AT";
    setAtPass(edit && attempt ? attempt.isPass : true);
    updateAtSaveState();
}

export function openAtModal({ editLatest = false } = {}) {
    if (!state.context || pendingAtSave || state.isLoadingContext || state.isSaving || state.isCompletingZun || state.isCompletingLevel) {
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

export function closeAtModal() {
    if (pendingAtSave) return;
    els.atModal.classList.add("hidden");
}

function validateAtForm() {
    const score = Number(els.atScore.value);
    const maxScore = Number(els.atMaxScore.value);
    const usedTime = Number(els.atTime.value);
    const atGroup = Number(els.atGroup.value);

    if (!Number.isInteger(score) || score <= 0 || score > maxScore) {
        throw new Error(`Score ต้องอยู่ระหว่าง 1-${maxScore}`);
    }

    if (!Number.isInteger(usedTime) || usedTime <= 0) {
        throw new Error("Time ต้องมากกว่า 0");
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

export async function saveAtCompletion(event) {
    event.preventDefault();

    if (!state.context || pendingAtSave || state.isLoadingContext || state.isSaving || state.isCompletingZun || state.isCompletingLevel) {
        return;
    }

    const scope = captureContext();
    const modal = state.atModal;
    const revision = atModalRevision;
    const enrollmentId = modal.enrollmentId;
    const isCurrent = () => isCurrentContext(scope) && state.atModal === modal && atModalRevision === revision
        && modal.enrollmentId === enrollmentId;
    if (Number(enrollmentId) !== Number(scope.context.enrollment.enrollmentId)) return;
    let controls;
    try {
        const values = validateAtForm();
        const payload = {
            enrollmentId,
            atUsedId: modal.editingAtUsedId,
            expectedAtMasterId: modal.expectedAtMasterId,
            expectedLevelMasterId: modal.expectedLevelMasterId,
            atDate: els.atDate.value,
            score: values.score,
            usedTime: values.usedTime,
            atGroup: values.atGroup,
            isPass: modal.isPass
        };
        pendingAtSave = scope;
        controls = [...els.atForm.querySelectorAll("input, button, select, textarea")].map(control => [control, control.disabled]);
        for (const [control] of controls) control.disabled = true;
        const result = await worksheetApi.saveAtCompletion(payload);

        if (!isCurrent()) return;
        els.atModal.classList.add("hidden");
        if (!await refreshCompletedContext(scope, enrollmentId)) return;
        setStatus(
            result.isPass
                ? (result.nextLevelMasterId ? "บันทึก AT ผ่าน และเลื่อน level แล้ว" : "บันทึก AT ผ่านแล้ว")
                : "บันทึก AT ไม่ผ่านแล้ว",
            "success"
        );
    } catch (error) {
        if (isCurrent()) setStatus(error.message, "error");
    } finally {
        if (pendingAtSave === scope) {
            pendingAtSave = null;
            for (const [control, disabled] of controls || []) control.disabled = disabled;
        }
        updateAtSaveState();
    }
}

export async function completeZunLevel() {
    if (!state.context || pendingAtSave || state.isSaving || state.isLoadingContext || state.isCompletingLevel || state.isCompletingZun || els.completeZunLevel.disabled) {
        return;
    }

    const scope = captureContext();
    const enrollmentId = scope.context.enrollment.enrollmentId;
    const expectedZunLevelMasterId = scope.context.enrollment.currentZunLevelMasterId ?? null;
    state.isCompletingZun = true;
    updateSecondaryActions();
    setStatus("กำลังจบ Zun Level...");

    try {
        const result = await worksheetApi.completeZunLevel({
            enrollmentId,
            expectedZunLevelMasterId
        });
        const message = result.isFinal
            ? "จบ Zun แล้ว และล้าง Zun level เป็นว่าง"
            : `เปลี่ยน Zun เป็น ${result.nextZunLevelCode} แล้ว`;

        if (!await refreshCompletedContext(scope, enrollmentId)) return;
        setStatus(message, "success");
    } catch (error) {
        if (isCurrentContext(scope)) setStatus(error.message, "error");
    } finally {
        state.isCompletingZun = false;
        updateSecondaryActions();
    }
}

export async function completeWorksheetLevelWithoutAt() {
    if (!state.context || pendingAtSave || state.isLoadingContext || state.isCompletingZun || state.isCompletingLevel || els.completeWsLevel.disabled) {
        return;
    }

    const context = state.context;
    const scope = captureContext();
    const completion = context.completionState?.freeLevelCompletion;

    if (!completion?.canComplete) {
        return;
    }

    if (!await confirmAction(`จบ Level ${completion.currentLevelCode} และเลื่อนเป็น ${completion.nextLevelCode} ใช่ไหม?`)) {
        return;
    }
    if (!isCurrentContext(scope) || pendingAtSave || state.isCompletingZun || state.isCompletingLevel || state.isSaving) return;

    state.isCompletingLevel = true;
    updateSecondaryActions();
    setStatus("กำลังจบ Level...");

    try {
        const result = await worksheetApi.completeWorksheetLevel({
            enrollmentId: context.enrollment.enrollmentId,
            expectedMainLevelMasterId: completion.currentLevelMasterId
        });

        if (!await refreshCompletedContext(scope, context.enrollment.enrollmentId)) return;
        setStatus(`จบ ${result.previousLevelCode} แล้ว และเปลี่ยนเป็น ${result.nextLevelCode}`, "success");
    } catch (error) {
        if (isCurrentContext(scope)) setStatus(error.message, "error");
    } finally {
        state.isCompletingLevel = false;
        updateSecondaryActions();
    }
}
