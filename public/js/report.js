const els = {
  reportMonth: document.getElementById("reportMonth"),
  reportYear: document.getElementById("reportYear"),
  generateButton: document.getElementById("generateButton"),
  exportButton: document.getElementById("exportButton"),
  statusLine: document.getElementById("statusLine"),
  resultSubtitle: document.getElementById("resultSubtitle"),
  reportTableWrap: document.getElementById("reportTableWrap")
};

const state = {
  columns: [],
  rows: []
};

const setStatus = createStatusSetter(els.statusLine);

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
els.exportButton.addEventListener("click", exportCsv);

function init() {
  setupMonthSelect();
  setDefaultPeriod();
}

init();
