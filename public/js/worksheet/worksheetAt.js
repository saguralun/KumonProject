// AT (achievement test) modal + level/Zun completion. loadEnrollmentContext
// is imported from the main worksheet.js — same circular-import shape as
// worksheetSearch.js/worksheetIncomplete.js, safe for the same reason (only
// ever called from inside event handlers, never at module-load time).
import { els, setStatus, state } from "./worksheetState.js";
import { formatDateDisplay } from "./worksheetInput.js";
import { worksheetApi } from "./worksheetApi.js";
import { updateSecondaryActions } from "./worksheetPreview.js";
import { loadEnrollmentContext } from "./worksheet.js";

export function setAtPass(isPass) {
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

export function updateAtSaveState() {
    els.atSaveButton.disabled = !isAtFormReady();
}

function focusAndSelect(input) {
    input.focus();

    if (typeof input.select === "function") {
        input.select();
    }
}

export function moveAtFocus(event, nextElement) {
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

export function openAtModal({ editLatest = false } = {}) {
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

export function closeAtModal() {
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

export async function saveAtCompletion(event) {
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

export async function completeZunLevel() {
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

export async function completeWorksheetLevelWithoutAt() {
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
