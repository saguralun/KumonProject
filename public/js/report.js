const els = {
  reportMonth: document.getElementById("reportMonth"),
  reportYear: document.getElementById("reportYear"),
  forecastDays: document.getElementById("forecastDays"),
  forecastSubject: document.getElementById("forecastSubject"),
  forecastIncludeKc: document.getElementById("forecastIncludeKc"),
  generateButton: document.getElementById("generateButton"),
  forecastButton: document.getElementById("forecastButton"),
  recalculateForecastButton: document.getElementById("recalculateForecastButton"),
  exportButton: document.getElementById("exportButton"),
  statusLine: document.getElementById("statusLine"),
  resultSubtitle: document.getElementById("resultSubtitle"),
  forecastSummary: document.getElementById("forecastSummary"),
  reportTableWrap: document.getElementById("reportTableWrap")
};

const state = {
  mode: "monthly",
  columns: [],
  rows: []
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function setStatus(message, type = "neutral") {
  els.statusLine.textContent = message;
  els.statusLine.classList.toggle("is-error", type === "error");
}

function monthName(month) {
  return [
    "", "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
    "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"
  ][Number(month)] || month;
}

function todayIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

// Same "day 21+ rolls to next month" Kumon period rule used elsewhere in
// the app (worksheetService.js / payment.js / stockReceiveService.js).
function kumonPeriodFromDate(dateText) {
  const [year, month, day] = dateText.split("-").map(Number);
  const nextMonth = day > 20 ? month + 1 : month;

  if (nextMonth > 12) {
    return { month: 1, year: year + 1 };
  }

  return { month: nextMonth, year };
}

function setupMonthSelect() {
  els.reportMonth.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;

    return `<option value="${month}">${monthName(month)}</option>`;
  }).join("");
}

function setDefaultPeriod() {
  const period = kumonPeriodFromDate(todayIsoDate());

  els.reportMonth.value = String(period.month);
  els.reportYear.value = String(period.year);
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function renderTable() {
  els.forecastSummary.classList.add("hidden");

  if (!state.rows.length) {
    els.reportTableWrap.innerHTML = `<div class="empty-state">ไม่พบข้อมูลในเดือน/ปีนี้</div>`;
    return;
  }

  els.reportTableWrap.innerHTML = `
    <table class="report-table">
      <thead>
        <tr>${state.columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("")}</tr>
      </thead>
      <tbody>
        ${state.rows.map((row) => `
          <tr>${state.columns.map((col) => `<td>${escapeHtml(row[col])}</td>`).join("")}</tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function formatNumber(value, fractionDigits = 0) {
  return Number(value || 0).toLocaleString("th-TH", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  });
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  return date.toLocaleString("th-TH", {
    dateStyle: "medium",
    timeStyle: "short"
  });
}

function setMode(mode) {
  state.mode = mode;

  document.querySelectorAll("[data-report-mode]").forEach((button) => {
    button.classList.toggle("active", button.dataset.reportMode === mode);
  });
  document.querySelectorAll("[data-monthly-filter]").forEach((element) => {
    element.classList.toggle("hidden", mode !== "monthly");
  });
  document.querySelectorAll("[data-forecast-filter]").forEach((element) => {
    element.classList.toggle("hidden", mode !== "forecast");
  });

  els.generateButton.classList.toggle("hidden", mode !== "monthly");
  els.exportButton.classList.toggle("hidden", mode !== "monthly");
  els.forecastButton.classList.toggle("hidden", mode !== "forecast");
  els.recalculateForecastButton.classList.toggle("hidden", mode !== "forecast");
  els.forecastSummary.classList.add("hidden");
  state.rows = [];

  if (mode === "monthly") {
    state.columns = [];
    els.resultSubtitle.textContent = "เลือกเดือน/ปี แล้วกดสร้างรายงาน";
    els.reportTableWrap.innerHTML = `<div class="empty-state">ยังไม่มีรายงาน</div>`;
    setStatus("พร้อมใช้งาน");
    return;
  }

  state.columns = [];
  els.resultSubtitle.textContent = "เลือกจำนวนวัน แล้วกด Forecast";
  els.reportTableWrap.innerHTML = `<div class="empty-state">ยังไม่มี Forecast</div>`;
  setStatus("พร้อมใช้งาน");
}

function renderForecastSummary(data) {
  const summary = data.summary || {};
  const cache = data.cache || {};

  els.forecastSummary.innerHTML = `
    <div class="forecast-card">
      <span>Active enrollment</span>
      <strong>${formatNumber(summary.activeEnrollments)}</strong>
    </div>
    <div class="forecast-card">
      <span>Packet ที่ต้องเตรียม</span>
      <strong>${formatNumber(summary.forecastPackets)}</strong>
    </div>
    <div class="forecast-card">
      <span>จำนวนที่เตรียม</span>
      <strong>${formatNumber(summary.totalPrepareQty)}</strong>
    </div>
    <div class="forecast-card">
      <span>ประมาณ CPWS</span>
      <strong>${formatNumber(summary.totalEstimatedCpws, 1)}</strong>
    </div>
    <div class="forecast-card">
      <span>Average cache</span>
      <strong>${escapeHtml(cache.recalculated ? "ใหม่" : "เดิม")}</strong>
    </div>
  `;
  els.forecastSummary.classList.remove("hidden");
}

function renderForecastTable(data) {
  const rows = data.rows || [];

  renderForecastSummary(data);

  if (!rows.length) {
    els.reportTableWrap.innerHTML = `<div class="empty-state">ไม่มีรายการที่ต้องเตรียม หรือยังไม่มีค่าเฉลี่ยพอสำหรับ forecast</div>`;
    return;
  }

  els.reportTableWrap.innerHTML = `
    <table class="report-table">
      <thead>
        <tr>
          <th>Subject</th>
          <th>Level</th>
          <th>Packet</th>
          <th>Label</th>
          <th>ต้องเตรียม</th>
          <th>ประมาณ CPWS</th>
          <th>เด็ก</th>
          <th>Avg Days</th>
          <th>Avg CPWS</th>
          <th>Source</th>
          <th>Sample เด็ก</th>
          <th>ตัวอย่างเด็ก</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.subject)}</td>
            <td>${escapeHtml(row.level)}</td>
            <td>${escapeHtml(row.packet)}</td>
            <td>${escapeHtml(row.label)}</td>
            <td>${escapeHtml(row.prepareQty)}</td>
            <td>${escapeHtml(formatNumber(row.neededCpws, 2))}</td>
            <td>${escapeHtml(row.students)}</td>
            <td>${escapeHtml(formatNumber(row.avgDays, 2))}</td>
            <td>${escapeHtml(formatNumber(row.avgCpws, 2))}</td>
            <td><span class="source-badge ${row.avgSource === "ALL" ? "all" : ""}">${escapeHtml(row.avgSource)}</span></td>
            <td>${escapeHtml(row.avgStudentCount)}</td>
            <td>${escapeHtml((row.enrollments || []).map((item) =>
              `#${item.enrollmentId} ${item.nickname || item.name}${item.isKc ? " KC" : ""}`
            ).join(", "))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function generateReport() {
  const month = Number(els.reportMonth.value);
  const year = Number(els.reportYear.value);

  els.generateButton.disabled = true;
  els.exportButton.disabled = true;
  setStatus("กำลังสร้างรายงาน...");
  els.reportTableWrap.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;

  try {
    const data = await requestJson(`/api/report/monthly?month=${month}&year=${year}`);

    state.columns = data.columns;
    state.rows = data.rows;
    renderTable();
    els.resultSubtitle.textContent = `${monthName(month)} ${year} • ${state.rows.length} รายการ`;
    els.exportButton.disabled = state.rows.length === 0;
    setStatus(`สร้างรายงานแล้ว (${state.rows.length} รายการ)`, state.rows.length ? "neutral" : "error");
  } catch (error) {
    els.reportTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, "error");
  } finally {
    els.generateButton.disabled = false;
  }
}

async function generateForecast({ force = false } = {}) {
  const days = Number(els.forecastDays.value);
  const subject = els.forecastSubject.value;
  const includeKc = els.forecastIncludeKc.checked;

  els.forecastButton.disabled = true;
  els.recalculateForecastButton.disabled = true;
  setStatus(force ? "กำลังคำนวณ average ใหม่..." : "กำลัง Forecast...");
  els.reportTableWrap.innerHTML = `<div class="empty-state">กำลังคำนวณ...</div>`;
  els.forecastSummary.classList.add("hidden");

  try {
    const params = new URLSearchParams({
      days: String(days),
      subject,
      includeKc: String(includeKc),
      force: String(force)
    });
    const data = await requestJson(`/api/report/worksheet-forecast?${params.toString()}`);

    renderForecastTable(data);
    els.resultSubtitle.textContent = [
      `Forecast ${days} วัน`,
      subject === "all" ? "ทุกวิชา" : subject,
      includeKc ? "รวม KC" : "ไม่รวม KC",
      `${data.summary.totalPrepareQty} ชุด`,
      `cache ${formatDateTime(data.cache.calculatedAt)}`
    ].join(" • ");
    setStatus(`${data.cache.cacheAction} • Forecast แล้ว`);
  } catch (error) {
    els.reportTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, "error");
  } finally {
    els.forecastButton.disabled = false;
    els.recalculateForecastButton.disabled = false;
  }
}

function exportCsv() {
  if (!state.rows.length) {
    return;
  }

  const month = Number(els.reportMonth.value);
  const year = Number(els.reportYear.value);
  const lines = [
    state.columns.map(csvCell).join(","),
    ...state.rows.map((row) => state.columns.map((col) => csvCell(row[col])).join(","))
  ];
  const blob = new Blob([`﻿${lines.join("\n")}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `kumon-report-${year}-${String(month).padStart(2, "0")}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`Export รายงานแล้ว (${state.rows.length} รายการ)`);
}

els.generateButton.addEventListener("click", generateReport);
els.forecastButton.addEventListener("click", () => generateForecast());
els.recalculateForecastButton.addEventListener("click", () => generateForecast({ force: true }));
els.exportButton.addEventListener("click", exportCsv);
document.querySelectorAll("[data-report-mode]").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.reportMode));
});

function init() {
  setupMonthSelect();
  setDefaultPeriod();
  setMode("monthly");
}

init();
