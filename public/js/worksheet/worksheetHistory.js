import {
    escapeHtml,
    formatDateDisplay
} from "./worksheetInput.js";

function renderFlag(value, trueText, falseText) {
    return value
        ? `<span class="badge ok">${escapeHtml(trueText)}</span>`
        : `<span class="badge wait">${escapeHtml(falseText)}</span>`;
}

export function isUnprocessedStockRecord(row) {
    return row.isStockProcessed === false;
}

// Same "day > 20 rolls into next month" rule used server-side for billing
// periods (see kumon period rule in worksheetService.js) — worksheetDate is
// already a plain "YYYY-MM-DD" string, so this can compare without touching
// Date objects/timezones at all.
function kumonPeriodMonthYear(dateText) {
    if (typeof dateText !== "string" || dateText.length < 10) {
        return null;
    }

    const year = Number(dateText.slice(0, 4));
    const month = Number(dateText.slice(5, 7));
    const day = Number(dateText.slice(8, 10));

    if (!year || !month || !day) {
        return null;
    }

    if (day > 20) {
        return month === 12
            ? { month: 1, year: year + 1 }
            : { month: month + 1, year };
    }

    return { month, year };
}

function isCurrentPeriodRecord(row, monthSummary) {
    if (!monthSummary?.billingMonth || !monthSummary?.billingYear) {
        return false;
    }

    const period = kumonPeriodMonthYear(row.worksheetDate);

    return Boolean(
        period
        && period.month === Number(monthSummary.billingMonth)
        && period.year === Number(monthSummary.billingYear)
    );
}

export function renderHistory(container, rows, monthSummary) {
    if (!Array.isArray(rows) || rows.length === 0) {
        container.innerHTML = `<div class="empty-state">ยังไม่มี history</div>`;
        return;
    }

    container.innerHTML = `
        <table class="history-table">
            <thead>
                <tr>
                    <th class="history-action-column"></th>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Level</th>
                    <th>WS</th>
                    <th>Packet</th>
                    <th>CPWS</th>
                    <th>Stock</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row) => {
                    const rowClassNames = [
                        isUnprocessedStockRecord(row) ? "history-row-unprocessed-stock" : "",
                        isCurrentPeriodRecord(row, monthSummary) ? "history-row-current-period" : ""
                    ].filter(Boolean);
                    const rowClass = rowClassNames.length
                        ? ` class="${rowClassNames.join(" ")}"`
                        : "";

                    return `
                        <tr${rowClass}>
                            <td class="history-action-cell">
                                ${isUnprocessedStockRecord(row)
                                    ? `
                                        <button
                                            type="button"
                                            class="history-delete-button"
                                            data-delete-history-id="${escapeHtml(row.worksheetUsedId)}"
                                            aria-label="Delete worksheet record"
                                        >
                                            ลบ
                                        </button>
                                    `
                                    : ""}
                            </td>
                            <td>
                                ${isUnprocessedStockRecord(row)
                                    ? `
                                        <input
                                            type="date"
                                            class="history-date-input"
                                            value="${escapeHtml(row.worksheetDate)}"
                                            data-edit-history-date-id="${escapeHtml(row.worksheetUsedId)}"
                                            aria-label="Edit worksheet date"
                                        >
                                    `
                                    : escapeHtml(formatDateDisplay(row.worksheetDate))}
                            </td>
                            <td>
                                <span class="badge ${row.worksheetType === "ZUN" ? "zun" : "main"}">
                                    ${escapeHtml(row.worksheetType)}
                                </span>
                            </td>
                            <td>${escapeHtml(row.levelCode)}</td>
                            <td>${isUnprocessedStockRecord(row) && Number(row.actualWorksheetNo) > 0 ? `<label class="history-ws-editor">
                                <span>${escapeHtml(row.levelCode)}</span><input type="number" required min="1" max="${row.worksheetType === 'ZUN' ? 100 : 200}" step="1"
                                    class="history-ws-input" value="${escapeHtml(row.actualWorksheetNo)}"
                                    data-edit-history-number-id="${escapeHtml(row.worksheetUsedId)}"
                                    aria-label="แก้เลข WS ${escapeHtml(row.levelCode)} • ${escapeHtml(row.worksheetDate)}" title="แก้เลข WS แล้วกด Enter เพื่อบันทึก • Esc เพื่อยกเลิก">
                                </label>` : `<strong>${escapeHtml(row.worksheetLabel)}</strong>`}</td>
                            <td>${escapeHtml(row.packetWorksheetNo)}</td>
                            <td>${renderFlag(row.cpws, "จริง", "auto")}</td>
                            <td>${renderFlag(row.isStockProcessed, "ตัดแล้ว", "ยัง")}</td>
                        </tr>
                    `;
                }).join("")}
            </tbody>
        </table>
    `;
}

function dateRank(value) {
    const match = String(value || '').match(/^(\d{1,4})-(\d{2})-(\d{2})$/);
    return match ? Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]) : 0;
}

export function compareWorksheetReceiveDate(a, b) {
    return dateRank(b.worksheetDate) - dateRank(a.worksheetDate) || Number(b.worksheetUsedId) - Number(a.worksheetUsedId);
}

export function prependHistoryRows(currentRows, newRows, limit) {
    return [
        ...(Array.isArray(newRows) ? newRows : []),
        ...(Array.isArray(currentRows) ? currentRows : [])
    ].sort((a, b) => Number(b.worksheetUsedId) - Number(a.worksheetUsedId)).slice(0, limit);
}
