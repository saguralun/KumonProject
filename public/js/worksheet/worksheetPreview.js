// The main "preview cycle" — progress ring, worksheet input fields, the
// live preview list, packet/month summary, and CD requirement/secondary
// actions. These were originally split into 3 separate groups by name
// (progress / summary / CD), but the actual call graph crosses those
// boundaries constantly (updatePreview alone touches all three every time
// a field changes), so they're kept together here as one cohesive module
// instead of forcing a three-way split that would just move the tangle
// into cross-file imports. Fully self-contained — nothing here needs
// anything from worksheet.js (the reverse isn't true: worksheet.js imports
// plenty from here), so there's no circular import for this pairing.
import { els, setStatus, state } from "./worksheetState.js";
import {
    buildPreviewRecords,
    escapeHtml,
    formatDateDisplay,
    moveWorksheetNo,
    requiredMainReady,
    selectedPattern,
    worksheetInputCount
} from "./worksheetInput.js";
import { worksheetApi } from "./worksheetApi.js";

export function currentPattern() {
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

export function updateReceiveWeekday() {
    els.receiveWeekday.textContent = weekdayLabelFromIsoDate(els.receiveDate.value);
}

export function setReceiveDate(dateText) {
    els.receiveDate.value = dateText;
    updatePreview();
    refreshWorksheetMonthSummary();
}

export function readWorksheetNos(kind) {
    return [...els.worksheetInputs.querySelectorAll(`[data-ws-input][data-kind="${kind}"]`)]
        .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
        .map((input) => input.value.trim());
}

export function optionsForKind(kind) {
    if (!state.context) {
        return [];
    }

    return kind === "zun"
        ? state.context.worksheetOptions.zun
        : state.context.worksheetOptions.main;
}

export function renderPatternButtons() {
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

export function renderWorksheetProgress() {
    const zunLevelMasterId = Number(state.context?.enrollment?.currentZunLevelMasterId || 0);
    const hasZunProgress = Number.isInteger(zunLevelMasterId) && zunLevelMasterId > 0;

    if (!hasZunProgress) {
        state.progressKind = "main";
    }

    // Always visible once a student's loaded (was hidden entirely when
    // hasZunProgress was false) — per feedback, showing it lets someone
    // notice the Main/Zun toggle exists at all, even for a student who
    // doesn't currently have Zun progress; only the Zun button itself
    // needs to be disabled for them, not the whole control.
    els.worksheetProgressTabs.classList.remove("hidden");
    els.worksheetProgressTabs.setAttribute("aria-hidden", "false");
    els.worksheetProgressTabs.querySelectorAll("[data-progress-kind]").forEach((button) => {
        button.disabled = button.dataset.progressKind === "zun" && !hasZunProgress;
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

export function focusWorksheetControl(input) {
    if (!input) {
        return;
    }

    input.focus();
    if (typeof input.select === "function") {
        input.select();
    }
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

export function stepWorksheet(kind, index, direction) {
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

export function renderWorksheetInputs({ preserve = false } = {}) {
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

export function updatePreview() {
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

export function renderWorksheetPacketSummary(summary) {
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

export function updateSecondaryActions() {
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
    const canUseZunButton = Boolean(
        state.progressKind === "zun"
        && context.completionState?.zunCompletion?.canComplete
    );

    els.completeZunLevel.disabled = !canUseZunButton || state.isCompletingZun;
    els.completeZunLevel.classList.toggle("hidden", !canUseZunButton);
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

export function currentCdRequirement() {
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

export function renderWorksheetMonthSummary(summary) {
    if (!summary) {
        els.historyMonthSummary.textContent = "เดือนนี้: ยังไม่มีข้อมูล";
        return;
    }

    els.historyMonthSummary.textContent = `${monthName(summary.billingMonth)} ${summary.billingYear}: ใช้ ${summary.usedDays} วัน • CPWS ${summary.cpwsRecords} ชุด`;
}

export async function refreshWorksheetMonthSummary() {
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

export async function receiveCd() {
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
