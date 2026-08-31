// "หา WS ค้าง" (find incomplete worksheets) modal. loadEnrollmentContext is
// imported from the main worksheet.js — same circular-import shape as
// worksheetSearch.js/worksheetAt.js, safe for the same reason (only ever
// called from inside event handlers, never at module-load time).
import { els, setStatus } from "./worksheetState.js";
import { escapeHtml, formatDateDisplay } from "./worksheetInput.js";
import { worksheetApi } from "./worksheetApi.js";
import { loadEnrollmentContext } from "./worksheet.js";

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

function incompleteWsSection(title, data) {
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
        </div>
    `;
}

function renderIncompleteWsSections(data) {
    els.incompleteWsTableWrap.innerHTML = `
        ${incompleteWsSection("WS ปกติ", data.regular)}
        ${incompleteWsSection("KC ค้างไว้", data.kc)}
    `;
}

export async function openIncompleteWsModal() {
    els.incompleteWsModal.classList.remove("hidden");
    els.incompleteWsSubtitle.textContent = "กำลังเช็ก WS ล่าสุดก่อนวันที่ 21 ของเดือนนี้";
    els.incompleteWsTableWrap.innerHTML = `<div class="empty-state">กำลังค้นหา...</div>`;

    try {
        const data = await worksheetApi.getIncompleteWorksheets();

        els.incompleteWsSubtitle.textContent = `เช็กถึง ${formatDateDisplay(data.cutoffDate)}`;
        renderIncompleteWsSections(data);
    } catch (error) {
        els.incompleteWsTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        setStatus(error.message, "error");
    }
}

export function closeIncompleteWsModal() {
    els.incompleteWsModal.classList.add("hidden");
}

export async function selectIncompleteWsEnrollment(enrollmentId) {
    closeIncompleteWsModal();
    await loadEnrollmentContext(enrollmentId);
}
