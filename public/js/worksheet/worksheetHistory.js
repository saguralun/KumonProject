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

export function renderHistory(container, rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        container.innerHTML = `<div class="empty-state">ยังไม่มี history</div>`;
        return;
    }

    container.innerHTML = `
        <table class="history-table">
            <thead>
                <tr>
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
                    const rowClass = isUnprocessedStockRecord(row)
                        ? ` class="history-row-unprocessed-stock"`
                        : "";

                    return `
                        <tr${rowClass}>
                            <td>${escapeHtml(formatDateDisplay(row.worksheetDate))}</td>
                            <td>
                                <span class="badge ${row.worksheetType === "ZUN" ? "zun" : "main"}">
                                    ${escapeHtml(row.worksheetType)}
                                </span>
                            </td>
                            <td>${escapeHtml(row.levelCode)}</td>
                            <td><strong>${escapeHtml(row.worksheetLabel)}</strong></td>
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

export function prependHistoryRows(currentRows, newRows, limit) {
    return [
        ...(Array.isArray(newRows) ? newRows : []),
        ...(Array.isArray(currentRows) ? currentRows : [])
    ].slice(0, limit);
}
