const els = {
  subjectTabs: document.getElementById("subjectTabs"),
  refreshButton: document.getElementById("refreshButton"),
  lineLegend: document.getElementById("lineLegend"),
  dotLegend: document.getElementById("dotLegend"),
  statusLine: document.getElementById("statusLine"),
  summaryCards: document.getElementById("summaryCards"),
  chartScroll: document.getElementById("chartScroll"),
  chartTooltip: document.getElementById("chartTooltip"),
  loadBarRow: document.getElementById("loadBarRow"),
  loadBarFill: document.getElementById("loadBarFill"),
  loadBarPercent: document.getElementById("loadBarPercent")
};

const SUBJECTS = ["ME", "EFL", "TRP"];
let activeSubject = "ME";
let dataCache = {};

const STATUS_COLORS = {
  none: "#94a3b8",
  "0": "#94a3b8",
  KSIS: "#0ea5e9",
  "6M": "#059669",
  "2Y": "#2563eb",
  "3Y": "#7c3aed",
  "5Y": "#d97706",
  "7Y": "#dc2626"
};

const STATUS_LABELS = {
  none: "ยังไม่ทันชั้นเรียน",
  "0": "ทันชั้นเรียนพอดี",
  KSIS: "เรียนทันชั้นเรียน",
  "6M": "เกินชั้นเรียน 6 เดือน",
  "2Y": "เกินชั้นเรียน 2 ปี",
  "3Y": "เกินชั้นเรียน 3 ปี",
  "5Y": "เกินชั้นเรียน 5 ปี",
  "7Y": "เกินชั้นเรียน 7 ปี"
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setStatus(message, type = "neutral") {
  els.statusLine.textContent = message;
  els.statusLine.classList.toggle("is-error", type === "error");
}

function setLoadProgress(percent) {
  els.loadBarFill.classList.remove("is-indeterminate");
  els.loadBarFill.style.width = `${percent}%`;
  els.loadBarPercent.textContent = `${percent}%`;
}

function setLoadIndeterminate() {
  els.loadBarFill.classList.add("is-indeterminate");
  els.loadBarPercent.textContent = "";
}

// Real 0-100% download progress via the response body's stream, measured
// against Content-Length (Express sets this on res.json() by default).
// Falls back to an indeterminate sweep if a response ever arrives without
// it (e.g. something upstream switches to chunked transfer).
async function requestJson(url) {
  const response = await fetch(url);

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));

    throw new Error(data.error || "Request failed");
  }

  const contentLength = Number(response.headers.get("Content-Length")) || 0;

  if (!contentLength || !response.body || !response.body.getReader) {
    setLoadIndeterminate();

    const data = await response.json();

    if (data.success === false) {
      throw new Error(data.error || "Request failed");
    }

    return data;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;

  setLoadProgress(0);

  for (;;) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    received += value.length;
    setLoadProgress(Math.min(100, Math.round((received / contentLength) * 100)));
  }

  const buffer = new Uint8Array(received);
  let offset = 0;

  chunks.forEach((chunk) => {
    buffer.set(chunk, offset);
    offset += chunk.length;
  });

  const data = JSON.parse(new TextDecoder("utf-8").decode(buffer));

  if (data.success === false) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function renderSubjectTabs() {
  els.subjectTabs.innerHTML = SUBJECTS.map((code) => `
    <button
      type="button"
      class="subject-tab ${code === activeSubject ? "active" : ""}"
      data-subject="${escapeHtml(code)}"
    >${escapeHtml(code)}</button>
  `).join("");

  [...els.subjectTabs.querySelectorAll(".subject-tab")].forEach((button) => {
    button.addEventListener("click", () => {
      activeSubject = button.dataset.subject;
      renderSubjectTabs();
      renderChart();
    });
  });
}

function renderLegends() {
  const lineOrder = ["0", "6M", "2Y", "3Y", "5Y", "7Y"];

  els.lineLegend.innerHTML = lineOrder.map((code) => `
    <div class="legend-row">
      <span class="legend-line" style="background:${STATUS_COLORS[code]}"></span>
      ${escapeHtml(STATUS_LABELS[code])}
    </div>
  `).join("");

  const dotOrder = ["none", "KSIS", "6M", "2Y", "3Y", "5Y", "7Y"];

  els.dotLegend.innerHTML = dotOrder.map((code) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${STATUS_COLORS[code]}"></span>
      ${escapeHtml(STATUS_LABELS[code])}
    </div>
  `).join("");
}

function renderSummary(data) {
  const dist = {};

  data.students.forEach((student) => {
    const code = student.gradeSyncStatus?.code || "none";

    dist[code] = (dist[code] || 0) + 1;
  });

  const onPaceOrAhead = data.students.length - (dist.none || 0);

  els.summaryCards.innerHTML = `
    <div class="summary-card">
      <span>วิชา</span>
      <strong>${escapeHtml(data.subjectCode)}</strong>
    </div>
    <div class="summary-card">
      <span>เด็ก active ทั้งหมด</span>
      <strong>${data.students.length.toLocaleString("th-TH")}</strong>
    </div>
    <div class="summary-card">
      <span>ทันชั้นเรียนขึ้นไป</span>
      <strong>${onPaceOrAhead.toLocaleString("th-TH")}</strong>
    </div>
    <div class="summary-card">
      <span>เกิน 2 ปีขึ้นไป</span>
      <strong>${((dist["2Y"] || 0) + (dist["3Y"] || 0) + (dist["5Y"] || 0) + (dist["7Y"] || 0)).toLocaleString("th-TH")}</strong>
    </div>
  `;
}

// Cheap deterministic hash -> stable per-student horizontal jitter so
// clustered dots at the same (grade, level) spot spread out a bit without
// jumping around on every re-render.
function jitterFor(id) {
  const hashed = (Number(id) * 2654435761) % 1000;

  return ((hashed / 1000) - 0.5) * 0.7;
}

function buildSvg(data) {
  const cellWidth = 74;
  const cellHeight = 26;
  const marginLeft = 64;
  const marginTop = 16;
  const marginBottom = 70;
  const marginRight = 90;

  const numGrades = data.grades.length;
  const numLevels = data.levels.length;
  const chartWidth = numGrades * cellWidth;
  const chartHeight = numLevels * cellHeight;
  const totalWidth = marginLeft + chartWidth + marginRight;
  const totalHeight = marginTop + chartHeight + marginBottom;

  const xScale = (gradeIndex) => marginLeft + (gradeIndex * cellWidth);
  const yScale = (levelPosition) => marginTop + ((numLevels - levelPosition) * cellHeight);

  const parts = [];

  parts.push(`<svg class="progress-svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">`);

  // Table-like grid — one line per level (row) and per grade (column).
  for (let levelIndex = 0; levelIndex <= numLevels; levelIndex += 1) {
    const y = marginTop + (levelIndex * cellHeight);

    parts.push(`<line class="grid-line" x1="${marginLeft}" y1="${y}" x2="${marginLeft + chartWidth}" y2="${y}" />`);
  }

  for (let gradeIndex = 0; gradeIndex <= numGrades; gradeIndex += 1) {
    const x = xScale(gradeIndex);

    parts.push(`<line class="grid-line" x1="${x}" y1="${marginTop}" x2="${x}" y2="${marginTop + chartHeight}" />`);
  }

  // Y axis labels (levels), bottom = index 0.
  data.levels.forEach((levelCode, index) => {
    const y = yScale(index + 0.5);

    parts.push(`<text class="axis-label" x="${marginLeft - 8}" y="${y + 4}" text-anchor="end">${escapeHtml(levelCode)}</text>`);
  });

  // X axis labels (grades), rotated to fit.
  data.grades.forEach((gradeLabel, index) => {
    const x = xScale(index) + (cellWidth / 2);
    const y = marginTop + chartHeight + 16;

    parts.push(`<text class="axis-label" x="${x}" y="${y}" text-anchor="end" transform="rotate(-40 ${x} ${y})">${escapeHtml(gradeLabel)}</text>`);
  });

  // Reference lines (0 / 6M / 2Y / 3Y / 5Y / 7Y), each a polyline across
  // every grade tick, plus a small label at the right edge.
  data.referenceLines.forEach((line) => {
    const color = STATUS_COLORS[line.code] || "#94a3b8";
    const points = line.points
      .map((point, index) => `${xScale(index)},${yScale(point.levelPosition)}`)
      .join(" ");

    parts.push(`<polyline class="ref-line" points="${points}" stroke="${color}" />`);

    const lastPoint = line.points[line.points.length - 1];

    parts.push(`<text class="ref-line-label" x="${xScale(data.grades.length) + 4}" y="${yScale(lastPoint.levelPosition) + 3}" fill="${color}">${escapeHtml(line.code)}</text>`);
  });

  // Student dots.
  data.students.forEach((student) => {
    const gradeIndex = data.grades.indexOf(student.gradeClass);

    if (gradeIndex === -1) {
      return;
    }

    const x = xScale(gradeIndex) + (cellWidth / 2) + (jitterFor(student.enrollmentId) * cellWidth);
    const y = yScale(student.levelPosition);
    const color = STATUS_COLORS[student.gradeSyncStatus?.code || "none"];

    parts.push(`<circle class="student-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5" fill="${color}" data-enrollment-id="${student.enrollmentId}" />`);
  });

  parts.push(`</svg>`);

  return parts.join("");
}

function attachTooltipHandlers(container, data) {
  const studentsById = new Map(data.students.map((student) => [String(student.enrollmentId), student]));

  container.querySelectorAll(".student-dot").forEach((dot) => {
    dot.addEventListener("mousemove", (event) => {
      const student = studentsById.get(dot.dataset.enrollmentId);

      if (!student) {
        return;
      }

      const statusLabel = STATUS_LABELS[student.gradeSyncStatus?.code || "none"];

      els.chartTooltip.innerHTML = `
        <div class="tooltip-title">${escapeHtml(student.nickname || student.name)}</div>
        <div class="tooltip-line">${escapeHtml(student.name)}${student.isKc ? " (KC)" : ""}</div>
        <div class="tooltip-line">ชั้น ${escapeHtml(student.gradeClass || "-")} · Level ${escapeHtml(student.levelCode)} (${student.percent}%)</div>
        <div class="tooltip-line">${escapeHtml(statusLabel)}</div>
      `;
      els.chartTooltip.style.left = `${event.clientX + 14}px`;
      els.chartTooltip.style.top = `${event.clientY + 14}px`;
      els.chartTooltip.classList.remove("hidden");
    });

    dot.addEventListener("mouseleave", () => {
      els.chartTooltip.classList.add("hidden");
    });
  });
}

async function renderChart() {
  els.chartScroll.innerHTML = `<div class="empty-state"><div class="spinner"></div>กำลังโหลด...</div>`;
  setStatus("กำลังโหลด...");

  const needsFetch = !dataCache[activeSubject];

  if (needsFetch) {
    setLoadProgress(0);
    els.loadBarRow.classList.remove("hidden");
  }

  try {
    if (needsFetch) {
      dataCache[activeSubject] = await requestJson(`/api/progress-chart?subject=${encodeURIComponent(activeSubject)}`);
    }

    const data = dataCache[activeSubject];

    renderSummary(data);

    if (!data.students.length) {
      els.chartScroll.innerHTML = `<div class="empty-state">ไม่มีเด็ก active ในวิชานี้</div>`;
      setStatus("โหลดแล้ว — ไม่มีข้อมูล");
      return;
    }

    els.chartScroll.innerHTML = buildSvg(data);
    attachTooltipHandlers(els.chartScroll, data);
    setStatus(`โหลดแล้ว — ${data.students.length.toLocaleString("th-TH")} คน`);
  } catch (error) {
    els.chartScroll.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.summaryCards.innerHTML = "";
    setStatus(error.message, "error");
  } finally {
    els.loadBarRow.classList.add("hidden");
  }
}

function refresh() {
  dataCache = {};
  renderChart();
}

els.refreshButton.addEventListener("click", refresh);

renderSubjectTabs();
renderLegends();
renderChart();
