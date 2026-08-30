const els = {
  subjectTabs: document.getElementById("subjectTabs"),
  refreshStockButton: document.getElementById("refreshStockButton"),
  statusLine: document.getElementById("statusLine"),
  pageSubtitle: document.getElementById("pageSubtitle"),
  stockSummaryCards: document.getElementById("stockSummaryCards"),
  wsPanelSubtitle: document.getElementById("wsPanelSubtitle"),
  wsTableWrap: document.getElementById("wsTableWrap"),
  cdPanelSubtitle: document.getElementById("cdPanelSubtitle"),
  cdTableWrap: document.getElementById("cdTableWrap")
};

let stockData = null;
let activeSubjectCode = null;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("th-TH");
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  return new Date(value).toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function setStatus(message, type = "neutral") {
  els.statusLine.textContent = message;
  els.statusLine.classList.toggle("is-error", type === "error");
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

// Quantity buckets driving cell shading — a plain visual aid, not a stocking
// rule: < 5 = critical (red), < 10 = getting low (orange), otherwise fine (no tint).
function qtyClass(value) {
  const quantity = Number(value || 0);

  if (quantity < 5) {
    return "is-out";
  }

  if (quantity < 10) {
    return "is-low";
  }

  return "";
}

function renderSubjectTabs() {
  const subjects = stockData?.subjects || [];

  els.subjectTabs.innerHTML = subjects.map((subject) => `
    <button
      type="button"
      class="subject-tab ${subject.subjectCode === activeSubjectCode ? "active" : ""}"
      data-subject="${escapeHtml(subject.subjectCode)}"
    >${escapeHtml(subject.subjectCode)}</button>
  `).join("");

  [...els.subjectTabs.querySelectorAll(".subject-tab")].forEach((button) => {
    button.addEventListener("click", () => {
      activeSubjectCode = button.dataset.subject;
      renderActiveSubject();
    });
  });
}

function renderSummaryCards(subject) {
  els.stockSummaryCards.innerHTML = `
    <div class="stock-card">
      <span>วิชา</span>
      <strong>${escapeHtml(subject.subjectCode)}</strong>
    </div>
    <div class="stock-card">
      <span>ระดับทั้งหมด</span>
      <strong>${formatNumber(subject.ws.levels.length)}</strong>
    </div>
    <div class="stock-card">
      <span>WS คงเหลือรวม</span>
      <strong>${formatNumber(subject.ws.grandTotal)}</strong>
    </div>
    <div class="stock-card">
      <span>CD คงเหลือรวม</span>
      <strong>${formatNumber(subject.cd.grandTotal)}</strong>
    </div>
    <div class="stock-card">
      <span>อัปเดตล่าสุด</span>
      <strong class="is-small">${escapeHtml(formatDateTime(stockData.generatedAt))}</strong>
    </div>
  `;
}

function renderPivotTable(wrapEl, pivot, { firstColumnLabel = "Level", columnPrefix = "" } = {}) {
  if (!pivot.levels.length) {
    wrapEl.innerHTML = `<div class="empty-state">ไม่มีข้อมูล</div>`;
    return;
  }

  wrapEl.innerHTML = `
    <table class="stock-table">
      <thead>
        <tr>
          <th class="is-sticky-col">${escapeHtml(firstColumnLabel)}</th>
          ${pivot.columnValues.map((column) => `<th>${escapeHtml(columnPrefix)}${escapeHtml(column)}</th>`).join("")}
          <th class="is-total-col">Grand Total</th>
        </tr>
      </thead>
      <tbody>
        ${pivot.levels.map((level) => `
          <tr class="${level.levelType === 2 ? "is-zun-row" : ""}">
            <td class="is-sticky-col">${escapeHtml(level.levelCode)}</td>
            ${pivot.columnValues.map((column) => {
              const value = level.values[column];

              return value === undefined
                ? `<td class="is-blank"></td>`
                : `<td class="${qtyClass(value)}">${formatNumber(value)}</td>`;
            }).join("")}
            <td class="is-total-col"><strong>${formatNumber(level.total)}</strong></td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td class="is-sticky-col">Grand Total</td>
          ${pivot.columnValues.map((column) =>
            `<td><strong>${formatNumber(pivot.columnTotals[column])}</strong></td>`
          ).join("")}
          <td class="is-total-col"><strong>${formatNumber(pivot.grandTotal)}</strong></td>
        </tr>
      </tfoot>
    </table>
  `;
}

function renderActiveSubject() {
  const subject = (stockData?.subjects || []).find((item) => item.subjectCode === activeSubjectCode);

  renderSubjectTabs();

  if (!subject) {
    els.stockSummaryCards.innerHTML = "";
    els.wsTableWrap.innerHTML = `<div class="empty-state">ไม่มีข้อมูล</div>`;
    els.cdTableWrap.innerHTML = `<div class="empty-state">ไม่มีข้อมูล</div>`;
    return;
  }

  renderSummaryCards(subject);
  renderPivotTable(els.wsTableWrap, subject.ws);

  if (!subject.cd.levels.length) {
    els.cdTableWrap.innerHTML = `<div class="empty-state">วิชานี้ไม่มี CD</div>`;
  } else {
    renderPivotTable(els.cdTableWrap, subject.cd, { columnPrefix: "CD" });
  }
}

async function loadStockSummary() {
  els.refreshStockButton.disabled = true;
  setStatus("กำลังโหลด...");

  try {
    stockData = await requestJson("/api/stock-summary");

    if (!activeSubjectCode || !stockData.subjects.some((subject) => subject.subjectCode === activeSubjectCode)) {
      activeSubjectCode = stockData.subjects[0]?.subjectCode || null;
    }

    renderActiveSubject();
    setStatus(`โหลดแล้ว • อัปเดตล่าสุด ${formatDateTime(stockData.generatedAt)}`);
  } catch (error) {
    els.wsTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.cdTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.stockSummaryCards.innerHTML = "";
    setStatus(error.message, "error");
  } finally {
    els.refreshStockButton.disabled = false;
  }
}

els.refreshStockButton.addEventListener("click", () => loadStockSummary());

loadStockSummary();
