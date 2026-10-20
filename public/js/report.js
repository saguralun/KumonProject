import { REPORT_SUBJECTS, subjectReportRows, reportPage, renderReportTable } from "./reportLayout.js?v=20261020-zun-position";
import { setupKsisMatching } from "./reportKsisMatching.js";
import { setupKsisDraft } from "./reportKsisDraft.js?v=20261020-all-subjects";

const els = {
  reportMonth: document.getElementById("reportMonth"),
  reportYear: document.getElementById("reportYear"),
  generateButton: document.getElementById("generateButton"),
  exportButton: document.getElementById("exportButton"),
  exportEventSummaryButton: document.getElementById("exportEventSummaryButton"),
  levelSummaryButton: document.getElementById("levelSummaryButton"),
  exportLevelSummaryButton: document.getElementById("exportLevelSummaryButton"),
  levelSummary: document.getElementById("levelSummary"),
  levelSummarySubtitle: document.getElementById("levelSummarySubtitle"),
  levelSummaryTables: document.getElementById("levelSummaryTables"),
  statusLine: document.getElementById("statusLine"),
  resultSubtitle: document.getElementById("resultSubtitle"),
  status1Summary: document.getElementById("status1Summary"),
  reportTableWrap: document.getElementById("reportTableWrap"),
  subjectTabs: document.getElementById("subjectTabs"),
  previousPage: document.getElementById("previousPage"),
  nextPage: document.getElementById("nextPage"),
  pageNumber: document.getElementById("pageNumber"),
  pageTotal: document.getElementById("pageTotal"),
  pageRange: document.getElementById("pageRange")
};

// Same codes/labels as the Statistics page (public/js/statistics.js) —
// kept as its own small copy rather than shared, matching how this app
// already handles every other bit of duplicated master-data labeling
// across pages with no shared JS module between them.
const STATUS1_LABELS = {
  N: "New Enrolment",
  IT: "Incoming Transfer",
  EO: "Enrolling Other Subject",
  R: "Resumed",
  A: "Absent",
  OT: "Outgoing Transfer",
  CP: "Completer",
  C: "Continue"
};

const STATUS1_ORDER = ["A", "OT", "C", "N", "R", "EO", "IT", "CP"];

const state = {
  columns: [],
  rows: [],
  levelSummary: null,
  levelSummaryRequest: 0,
  subject: "ME",
  page: 1,
  period: null,
  reportRequest: 0,
  view: "report"
};

const setStatus = createStatusSetter(els.statusLine);

function setReportView(view) {
  state.view = view;
  document.querySelectorAll("[data-report-view]").forEach((element) => {
    element.classList.toggle("hidden", element.dataset.reportView !== view);
  });
  els.levelSummary.classList.toggle("hidden", view !== "summary");
  document.querySelector(".page-title").textContent = view === "summary" ? "สรุปนักเรียนตามเลเวล" : view === "matching" ? "จับคู่รหัสคุมอง" : view === "draft" ? "กรอก Report B ใน KSIS" : "Report B";
  if (view === "report") {
    state.levelSummaryRequest++;
    els.levelSummaryButton.disabled = false;
    fitReportRows();
  } else {
    state.reportRequest++;
    els.generateButton.disabled = false;
    if (["matching", "draft"].includes(view)) {
      state.levelSummaryRequest++;
      els.levelSummaryButton.disabled = false;
    }
  }
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
  const rows = subjectReportRows(state.rows, state.subject);
  const page = reportPage(rows, state.page);
  state.page = page.page;
  els.subjectTabs.innerHTML = REPORT_SUBJECTS.map((subject) => `<button type="button" role="tab"
    aria-selected="${subject === state.subject}" data-subject="${subject}">${subject}<span>${state.rows.filter((row) => row.Subject === subject).length}</span></button>`).join("");
  els.reportTableWrap.innerHTML = page.total ? renderReportTable(page.rows, escapeHtml)
    : `<div class="empty-state">${state.period ? "ไม่พบข้อมูลวิชานี้ในเดือน/ปีที่เลือก" : "เลือกเดือน/ปี แล้วกดสร้างรายงาน"}</div>`;
  els.pageNumber.value = String(page.page);
  els.pageNumber.max = String(page.pages);
  els.pageNumber.disabled = !page.total;
  els.pageTotal.textContent = `/ ${page.pages}`;
  els.previousPage.disabled = page.page <= 1 || !page.total;
  els.nextPage.disabled = page.page >= page.pages || !page.total;
  els.pageRange.textContent = page.total ? `${page.start + 1}–${page.start + page.rows.length} จาก ${page.total} คน` : "0 คน";
  els.resultSubtitle.textContent = state.period ? `${monthName(state.period.month)} ${state.period.year} • ${state.subject} • ${page.total} คน` : "ยังไม่มีรายงาน";
  els.reportTableWrap.scrollTop = 0;
  renderStatus1Summary();
  fitReportRows();
}

function fitReportRows() {
  const table = els.reportTableWrap.querySelector(".report-table");
  if (!table) return;
  // Reserve 20 equal slots on short final pages too; never stretch five people across the screen.
  const available = els.reportTableWrap.clientHeight - table.tHead.getBoundingClientRect().height - 2;
  const denseRows = [...table.tBodies[0].rows].filter((row) => [...row.cells].some((cell) => cell.children.length > 2)).length;
  table.style.setProperty("--report-row-height", `${Math.max(23, (available - denseRows * 12) / 20)}px`);
}

function status1Group(code) {
  if (["N", "IT", "EO", "R", "C"].includes(code)) {
    return "in";
  }

  if (["A", "OT"].includes(code)) {
    return "out";
  }

  if (code === "CP") {
    return "completer";
  }

  return "other";
}

function renderStatus1Summary() {
  const rows = subjectReportRows(state.rows, state.subject);
  if (!rows.length) {
    els.status1Summary.innerHTML = "";
    return;
  }

  const counts = new Map();

  rows.forEach((row) => {
    const code = row.Status1 || "(ไม่มี)";

    counts.set(code, (counts.get(code) || 0) + 1);
  });

  const codes = [...counts.keys()].sort((a, b) => {
    const indexA = STATUS1_ORDER.indexOf(a);
    const indexB = STATUS1_ORDER.indexOf(b);

    if (indexA === -1 && indexB === -1) {
      return a.localeCompare(b);
    }

    if (indexA === -1) {
      return 1;
    }

    if (indexB === -1) {
      return -1;
    }

    return indexA - indexB;
  });

  els.status1Summary.innerHTML = `
    <span class="status1-summary-label">${state.subject} (${rows.length} คน):</span>
    ${codes.map((code) => `
      <span class="status1-chip status1-chip-${status1Group(code)}">
        <strong>${escapeHtml(code)}</strong>
        ${STATUS1_LABELS[code] ? `<span class="status1-chip-name">${escapeHtml(STATUS1_LABELS[code])}</span>` : ""}
        <span class="status1-chip-count">${counts.get(code)}</span>
      </span>
    `).join("")}
  `;
}

async function generateReport() {
  setReportView("report");
  const requestId = ++state.reportRequest;
  const month = Number(els.reportMonth.value);
  const year = Number(els.reportYear.value);

  els.generateButton.disabled = true;
  state.rows = [];
  state.period = null;
  renderTable();
  els.exportButton.disabled = true;
  setStatus("กำลังสร้างรายงาน...");
  els.reportTableWrap.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;
  els.status1Summary.innerHTML = "";

  try {
    const data = await requestJson(`/api/report/monthly?month=${month}&year=${year}`);
    if (requestId !== state.reportRequest) return;
    state.columns = data.columns;
    state.rows = data.rows;
    state.period = { month, year };
    state.page = 1;
    renderTable();
    els.exportButton.disabled = state.rows.length === 0;
    setStatus(`สร้างรายงานแล้ว (${state.rows.length} รายการ)`, state.rows.length ? "neutral" : "error");
  } catch (error) {
    if (requestId !== state.reportRequest) return;
    els.reportTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, "error");
  } finally {
    if (requestId === state.reportRequest) els.generateButton.disabled = false;
  }
}

function exportCsv() {
  if (!state.rows.length) {
    return;
  }

  const { month, year } = state.period;
  const lines = [
    state.columns.map(csvCell).join(","),
    ...REPORT_SUBJECTS.flatMap((subject) => subjectReportRows(state.rows, subject)).map((row) => state.columns.map((col) => csvCell(row[col])).join(","))
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

// Independent of generateReport()/state — the account holder's ask was for
// a focused roster (new/incoming/resumed/enrolling-other/absent-or-OT)
// with its own column set (Phone/Gender/BirthDate, none of which the main
// report even fetches), not a filtered view of the already-loaded ~60
// -column report — so this hits its own endpoint for whichever month/year
// is currently selected, generated report or not.
async function exportEventSummary() {
  const month = Number(els.reportMonth.value);
  const year = Number(els.reportYear.value);

  els.exportEventSummaryButton.disabled = true;
  setStatus("กำลังสร้างสรุป...");

  try {
    const data = await requestJson(`/api/report/event-summary?month=${month}&year=${year}`);

    if (!data.rows.length) {
      setStatus("ไม่พบเด็กที่ตรงเงื่อนไขในเดือน/ปีนี้", "error");
      return;
    }

    const response = await fetch("/api/export/flat-workbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: `kumon-event-summary-${year}-${String(month).padStart(2, "0")}`,
        sheetName: "Summary",
        columns: data.columns,
        rows: data.rows.map((row) => data.columns.map((col) => row[col]))
      })
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));

      throw new Error(errorBody.error || "Export ไม่สำเร็จ");
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `kumon-event-summary-${year}-${String(month).padStart(2, "0")}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus(`Export สรุปแล้ว (${data.rows.length} รายการ)`);
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.exportEventSummaryButton.disabled = false;
  }
}

els.generateButton.addEventListener("click", generateReport);
async function generateLevelSummary() {
  setReportView("summary");
  const requestId = ++state.levelSummaryRequest;
  const month = Number(els.reportMonth.value);
  const year = Number(els.reportYear.value);
  state.levelSummary = null;
  els.levelSummaryButton.disabled = true;
  els.exportLevelSummaryButton.disabled = true;
  els.levelSummaryTables.innerHTML = '<div class="empty-state">กำลังโหลด...</div>';
  els.levelSummarySubtitle.textContent = `${monthName(month)} ${year} • นักเรียน Active ตามเลเวลปัจจุบัน`;
  setStatus("กำลังสรุปนักเรียนตามเลเวล...");
  try {
    const data = await requestJson(`/api/report/level-summary?month=${month}&year=${year}`);
    if (requestId !== state.levelSummaryRequest) return;
    state.levelSummary = { month, year, subjects: data.subjects };
    els.levelSummaryTables.innerHTML = data.subjects.map((subject) => `
      <table>
        <caption>${escapeHtml(subject.subject)} • ${subject.total} คน</caption>
        <thead><tr><th>เลเวล</th><th>นักเรียน (คน)</th></tr></thead>
        <tbody>${subject.rows.map((row) => `<tr><td>${escapeHtml(row.level)}</td><td>${row.count}</td></tr>`).join("")}</tbody>
        <tfoot><tr><td>รวม</td><td>${subject.total}</td></tr></tfoot>
      </table>
    `).join("");
    els.exportLevelSummaryButton.disabled = false;
    setStatus("สรุปนักเรียนตามเลเวลแล้ว");
  } catch (error) {
    if (requestId !== state.levelSummaryRequest) return;
    els.levelSummaryTables.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, "error");
  } finally {
    if (requestId === state.levelSummaryRequest) els.levelSummaryButton.disabled = false;
  }
}

async function exportLevelSummary() {
  const summary = state.levelSummary;
  if (!summary) return;
  els.exportLevelSummaryButton.disabled = true;
  try {
    const filename = `kumon-level-summary-${summary.year}-${String(summary.month).padStart(2, "0")}`;
    const response = await fetch("/api/export/flat-workbook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename,
        sheetName: "นักเรียนตามเลเวล",
        columns: ["เดือน", "ปี", "วิชา", "เลเวล", "นักเรียน (คน)"],
        rows: summary.subjects.flatMap((subject) => [
          ...subject.rows.map((row) => [summary.month, summary.year, subject.subject, row.level, row.count]),
          [summary.month, summary.year, subject.subject, "รวม", subject.total]
        ])
      })
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Export ไม่สำเร็จ");
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filename}.xlsx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setStatus("Export สรุปนักเรียนตามเลเวลแล้ว");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.exportLevelSummaryButton.disabled = !state.levelSummary;
  }
}

els.levelSummaryButton.addEventListener("click", generateLevelSummary);
els.exportLevelSummaryButton.addEventListener("click", exportLevelSummary);
for (const input of [els.reportMonth, els.reportYear]) {
  input.addEventListener("change", () => {
    state.reportRequest += 1;
    state.rows = [];
    state.period = null;
    state.page = 1;
    els.generateButton.disabled = false;
    els.exportButton.disabled = true;
    renderTable();
    state.levelSummary = null;
    state.levelSummaryRequest += 1;
    els.levelSummaryButton.disabled = false;
    els.levelSummaryTables.innerHTML = '<div class="empty-state">เลือกเดือน/ปี แล้วกดสรุปนักเรียนตามเลเวล</div>';
    els.levelSummarySubtitle.textContent = "";
    els.exportLevelSummaryButton.disabled = true;
  });
}
els.exportButton.addEventListener("click", exportCsv);
els.exportEventSummaryButton.addEventListener("click", exportEventSummary);

els.subjectTabs.addEventListener("click", (event) => {
  const button = event.target.closest("[data-subject]");
  if (!button) return;
  state.subject = button.dataset.subject;
  state.page = 1;
  renderTable();
});
els.previousPage.addEventListener("click", () => { state.page--; renderTable(); });
els.nextPage.addEventListener("click", () => { state.page++; renderTable(); });
els.pageNumber.addEventListener("change", () => { state.page = Math.trunc(Number(els.pageNumber.value)) || 1; renderTable(); });

function init() {
  setupMonthSelect();
  setDefaultPeriod();
  renderTable();
  setReportView("report");
  new ResizeObserver(fitReportRows).observe(els.reportTableWrap);
  const menu = document.getElementById("reportMenuButton");
  const closeMenu = () => {
    document.querySelector(".report-page").classList.remove("report-menu-open");
    menu.setAttribute("aria-expanded", "false");
  };
  menu.addEventListener("click", () => {
    const open = document.querySelector(".report-page").classList.toggle("report-menu-open");
    menu.setAttribute("aria-expanded", String(open));
  });
  document.getElementById("reportMenuBackdrop").addEventListener("click", closeMenu);
  document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
  els.generateButton.addEventListener("click", closeMenu);
  els.levelSummaryButton.addEventListener("click", closeMenu);
  setupKsisMatching({ open: () => { setReportView("matching"); closeMenu(); }, setStatus });
  setupKsisDraft({ open: () => { setReportView("draft"); closeMenu(); }, setStatus,
    getPeriod: () => ({ month: Number(els.reportMonth.value), year: Number(els.reportYear.value) }) });
}

init();
