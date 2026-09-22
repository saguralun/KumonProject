// "หา WS ค้าง" (find incomplete worksheets) modal. loadEnrollmentContext is
// imported from the main worksheet.js — same circular-import shape as
// worksheetSearch.js/worksheetAt.js, safe for the same reason (only ever
// called from inside event handlers, never at module-load time).
import { els, setStatus } from "./worksheetState.js";
import { escapeHtml, formatDateDisplay } from "./worksheetInput.js";
import { worksheetApi } from "./worksheetApi.js";
import { loadEnrollmentContext } from "./worksheet.js";

// Each section pages independently (regular vs KC have very different
// counts — e.g. 127 vs 23 pending — so a shared page number would put one
// section on a page far past its own last one).
const page = { regular: 1, kc: 1 };

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
    els.incompleteWsSubtitle.textContent = "กำลังเช็ก WS ล่าสุดก่อนวันที่ 21 ของเดือนนี้";

    try {
        const data = await worksheetApi.getIncompleteWorksheets({
            regularPage: page.regular,
            kcPage: page.kc
        });

        els.incompleteWsSubtitle.textContent = `เช็กถึง ${formatDateDisplay(data.cutoffDate)}`;
        renderIncompleteWsSections(data);
    } catch (error) {
        els.incompleteWsTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
        setStatus(error.message, "error");
    }
}

export async function openIncompleteWsModal() {
    els.incompleteWsModal.classList.remove("hidden");
    page.regular = 1;
    page.kc = 1;
    els.incompleteWsTableWrap.innerHTML = `<div class="empty-state">กำลังค้นหา...</div>`;
    await loadIncompleteWs();
}

export function closeIncompleteWsModal() {
    els.incompleteWsModal.classList.add("hidden");
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
