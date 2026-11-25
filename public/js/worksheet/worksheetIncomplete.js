// "หา WS ค้าง" (find incomplete worksheets) modal. loadEnrollmentContext is
// imported from the main worksheet.js — same circular-import shape as
// worksheetSearch.js/worksheetAt.js, safe for the same reason (only ever
// called from inside event handlers, never at module-load time).
import { els, setStatus } from "./worksheetState.js";
import { escapeHtml, formatDateDisplay } from "./worksheetInput.js";
import { worksheetApi } from "./worksheetApi.js";
import { loadEnrollmentContext } from "./worksheet.js";
import { createModalDialog } from "../modalDialog.js";

// Each section pages independently (regular vs KC have very different
// counts — e.g. 127 vs 23 pending — so a shared page number would put one
// section on a page far past its own last one).
const page = { regular: 1, kc: 1 };
let requestRevision = 0;
const incompleteDialog = createModalDialog(els.incompleteWsModal, {
    initialFocus: () => els.incompleteWsClose,
    returnFocus: () => els.findIncompleteWs,
    onCancel: closeIncompleteWsModal
});

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

function incompleteWsTable(rows) {
    return `
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
                    <tr data-incomplete-enrollment-id="${escapeHtml(row.enrollmentId)}" data-subject="${escapeHtml(row.subjectCode)}">
                        <td>#${escapeHtml(row.enrollmentId)}</td>
                        <td><button type="button" class="incomplete-student-button" data-select-incomplete-id="${escapeHtml(row.enrollmentId)}" aria-label="เลือก ${escapeHtml(row.studentName)} วิชา ${escapeHtml(row.subjectCode)}">${escapeHtml(row.studentName)}</button></td>
                        <td><span class="incomplete-subject">${escapeHtml(row.subjectCode)}</span></td>
                        <td>${escapeHtml(row.currentLevelCode || "-")}</td>
                        <td>${escapeHtml(latestWorksheetText(row))}</td>
                        <td>${escapeHtml(row.latestWorksheetDate ? formatDateDisplay(row.latestWorksheetDate) : "-")}</td>
                    </tr>
                `).join("")}
            </tbody>
        </table>
    `;
}

function incompleteWsPager(sectionKey, data) {
    const totalPages = Math.max(1, Number(data?.totalPages || 1));
    const currentPage = Number(data?.page || 1);

    if (totalPages <= 1) {
        return "";
    }

    return `
        <div class="incomplete-ws-pager">
            <button
                type="button"
                class="secondary-button compact"
                data-incomplete-page="prev"
                data-incomplete-section="${escapeHtml(sectionKey)}"
                ${currentPage <= 1 ? "disabled" : ""}
            >← ก่อนหน้า</button>
            <span class="subtle">หน้า ${escapeHtml(currentPage)} จาก ${escapeHtml(totalPages)}</span>
            <button
                type="button"
                class="secondary-button compact"
                data-incomplete-page="next"
                data-incomplete-section="${escapeHtml(sectionKey)}"
                ${currentPage >= totalPages ? "disabled" : ""}
            >ถัดไป →</button>
        </div>
    `;
}

function incompleteWsSection(sectionKey, title, data) {
    const rows = data?.rows || [];
    const totalRows = Number(data?.totalRows || rows.length);
    const countText = totalRows > rows.length
        ? `${rows.length} จาก ${totalRows} รายการ`
        : `${rows.length} รายการ`;

    return `
        <div class="incomplete-ws-section">
            <div class="incomplete-ws-section-header">
                <span>${escapeHtml(title)}</span>
                <span class="subtle">${escapeHtml(countText)}</span>
            </div>
            ${rows.length
                ? incompleteWsTable(rows)
                : `<div class="empty-state">ทุกคนกรอกถึงวันที่ 20 แล้ว</div>`}
            ${incompleteWsPager(sectionKey, data)}
        </div>
    `;
}

function renderIncompleteWsSections(data) {
    els.incompleteWsTableWrap.innerHTML = `
        ${incompleteWsSection("regular", "WS ปกติ", data.regular)}
        ${incompleteWsSection("kc", "KC ค้างไว้", data.kc)}
    `;
}

async function loadIncompleteWs() {
    const revision = ++requestRevision;
    const isCurrent = () => revision === requestRevision && els.incompleteWsModal.open;
    const restoreTableFocus = () => {
        if (!els.incompleteWsTableWrap.contains(document.activeElement)) return null;
        const active = document.activeElement;
        return () => {
            if (active.isConnected) return;
            const buttons = [...els.incompleteWsTableWrap.querySelectorAll('button:not(:disabled)')];
            const replacement = buttons.find(button => active.dataset.incompletePage
                && button.dataset.incompleteSection === active.dataset.incompleteSection
                && button.dataset.incompletePage === active.dataset.incompletePage)
                || buttons.find(button => active.dataset.incompletePage && button.dataset.incompleteSection === active.dataset.incompleteSection)
                || buttons.find(button => button.dataset.selectIncompleteId === active.dataset.selectIncompleteId)
                || els.incompleteWsClose;
            replacement.focus({ preventScroll: true });
        };
    };
    els.incompleteWsSubtitle.textContent = "กำลังเช็ก WS ล่าสุดก่อนวันที่ 21 ของเดือนนี้";

    try {
        const data = await worksheetApi.getIncompleteWorksheets({
            regularPage: page.regular,
            kcPage: page.kc
        });
        if (!isCurrent()) return;
        const restoreFocus = restoreTableFocus();
        els.incompleteWsSubtitle.textContent = `เช็กถึง ${formatDateDisplay(data.cutoffDate)}`;
        renderIncompleteWsSections(data);
        restoreFocus?.();
    } catch (error) {
        if (!isCurrent()) return;
        const restoreFocus = restoreTableFocus();
        els.incompleteWsSubtitle.textContent = "ค้นหา WS ค้างไม่สำเร็จ กรุณาปิดแล้วลองใหม่";
        els.incompleteWsTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        restoreFocus?.();
        setStatus(error.message, "error");
    }
}

export async function openIncompleteWsModal() {
    page.regular = 1;
    page.kc = 1;
    els.incompleteWsTableWrap.innerHTML = `<div class="empty-state">กำลังค้นหา...</div>`;
    incompleteDialog.show();
    await loadIncompleteWs();
}

export function closeIncompleteWsModal() {
    requestRevision++;
    incompleteDialog.close();
}

export async function selectIncompleteWsEnrollment(enrollmentId) {
    closeIncompleteWsModal();
    await loadEnrollmentContext(enrollmentId);
}

export async function changeIncompleteWsPage(sectionKey, direction) {
    if (sectionKey !== "regular" && sectionKey !== "kc") {
        return;
    }

    page[sectionKey] = Math.max(1, page[sectionKey] + (direction === "prev" ? -1 : 1));
    await loadIncompleteWs();
}
