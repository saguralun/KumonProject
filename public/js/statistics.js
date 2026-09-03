const els = {
  statsGrid: document.getElementById("statsGrid"),
  statusLine: document.getElementById("statusLine"),
  legendIn: document.getElementById("legendIn"),
  legendOut: document.getElementById("legendOut"),
  chartTooltip: document.getElementById("chartTooltip")
};

const setStatus = createStatusSetter(els.statusLine);

// "เข้า" (in) group first, "ออก" (out) group second — matches
// statisticsService.js's STATUS_CODES order, so the stacked bar segments
// and the legend rows read top-to-bottom in the same "in, then out" order.
const STATUS_GROUPS = {
  in: ["N", "IT", "EO", "R"],
  out: ["A", "OT", "CP"]
};

const STATUS_LABELS_TH = {
  N: "New Enrolment",
  IT: "Incoming Transfer",
  EO: "Enrolling Other Subject",
  R: "Resumed",
  A: "Absent",
  OT: "Outgoing Transfer",
  CP: "Completer"
};

// Full color for the latest year's bar; STATUS_GRAYS is the same 7-step
// light-to-dark ramp used for the two older years' bars — same relative
// ordering (so segment proportions still read the same way), just
// desaturated to keep the latest year visually dominant, per the original
// "24 เดือนย้อนหลัง เป็นสีเทา เทียบกับเดือนนั้นๆ" request.
const STATUS_COLORS = {
  N: "#2563eb",
  IT: "#0891b2",
  EO: "#059669",
  R: "#65a30d",
  A: "#d97706",
  OT: "#ea580c",
  CP: "#dc2626"
};

const STATUS_GRAYS = {
  N: "#cbd5e1",
  IT: "#b6c2d1",
  EO: "#94a3b8",
  R: "#7c8ba0",
  A: "#64748b",
  OT: "#4b5768",
  CP: "#334155"
};

function renderLegend() {
  els.legendIn.innerHTML = STATUS_GROUPS.in.map((code) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${STATUS_COLORS[code]}"></span>
      ${escapeHtml(code)} — ${escapeHtml(STATUS_LABELS_TH[code])}
    </div>
  `).join("");

  els.legendOut.innerHTML = STATUS_GROUPS.out.map((code) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${STATUS_COLORS[code]}"></span>
      ${escapeHtml(code)} — ${escapeHtml(STATUS_LABELS_TH[code])}
    </div>
  `).join("");
}

// One small multiple per calendar month, with one stacked bar per year —
// the latest year in full color, the two older years in the matching
// grayscale ramp. maxTotal is shared across all 12 panels (computed once
// over the whole dataset) so bar heights stay visually comparable between
// different months, not just within one panel.
function buildMonthSvg(monthData, years, maxTotal, statusCodes) {
  const barWidth = 46;
  const barGap = 20;
  const chartHeight = 110;
  const marginTop = 18; // room for the total-count label above each bar
  const marginBottom = 30; // room for the year label + the "current" count below each bar
  const marginLeft = 6;
  const marginRight = 6;

  const groupWidth = barWidth + barGap;
  const chartWidth = (years.length * groupWidth) - barGap;
  const totalWidth = marginLeft + chartWidth + marginRight;
  const totalHeight = marginTop + chartHeight + marginBottom;
  const baselineY = marginTop + chartHeight;

  const parts = [];

  parts.push(`<svg class="stats-svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">`);
  parts.push(`<line class="stats-baseline" x1="${marginLeft}" y1="${baselineY}" x2="${marginLeft + chartWidth}" y2="${baselineY}" />`);

  years.forEach((year, yearIndex) => {
    const isLatest = yearIndex === years.length - 1;
    const palette = isLatest ? STATUS_COLORS : STATUS_GRAYS;
    const yearData = monthData.years[year];
    const barX = marginLeft + (yearIndex * groupWidth);

    parts.push(`<text class="stats-axis-label" x="${barX + (barWidth / 2)}" y="${baselineY + 13}" text-anchor="middle">${year}</text>`);

    if (yearData.isFuture) {
      parts.push(`<rect class="stats-future-box" x="${barX}" y="${baselineY - 22}" width="${barWidth}" height="22" rx="4" />`);
      parts.push(`<text class="stats-future-label" x="${barX + (barWidth / 2)}" y="${baselineY - 8}" text-anchor="middle">ยังไม่ถึง</text>`);
      return;
    }

    // "Current" (C) — a separate steady-state headcount, not one of the
    // stacked in/out segments (see statisticsService.js for why: it's
    // 10x+ larger some months and would swallow the rest of the bar).
    // Shown as its own small line under the year label instead.
    parts.push(`<text class="stats-current-label" x="${barX + (barWidth / 2)}" y="${totalHeight - 2}" text-anchor="middle">ปัจจุบัน ${yearData.current}</text>`);

    if (yearData.total > 0) {
      parts.push(`<text class="stats-total-label" x="${barX + (barWidth / 2)}" y="${marginTop - 5}" text-anchor="middle">${yearData.total}</text>`);
    }

    let cumulativeY = baselineY;

    statusCodes.forEach((code) => {
      const value = yearData.byStatus[code] || 0;

      if (value <= 0) {
        return;
      }

      const segmentHeight = maxTotal > 0 ? (value / maxTotal) * chartHeight : 0;
      const y = cumulativeY - segmentHeight;

      parts.push(
        `<rect class="stats-bar-segment" x="${barX}" y="${y.toFixed(1)}" width="${barWidth}" height="${segmentHeight.toFixed(1)}" fill="${palette[code]}" ` +
        `data-year="${year}" data-month="${monthData.month}" data-code="${code}" data-value="${value}" />`
      );

      cumulativeY = y;
    });
  });

  parts.push(`</svg>`);

  return parts.join("");
}

function attachTooltipHandlers(container, monthLabel) {
  container.querySelectorAll(".stats-bar-segment").forEach((segment) => {
    segment.addEventListener("mousemove", (event) => {
      const { year, code, value } = segment.dataset;

      els.chartTooltip.innerHTML = `
        <div class="tooltip-title">${escapeHtml(monthLabel)} ${escapeHtml(year)}</div>
        <div class="tooltip-line">${escapeHtml(code)} — ${escapeHtml(STATUS_LABELS_TH[code] || code)}</div>
        <div class="tooltip-line">${escapeHtml(value)} คน</div>
      `;
      els.chartTooltip.style.left = `${event.clientX + 14}px`;
      els.chartTooltip.style.top = `${event.clientY + 14}px`;
      els.chartTooltip.classList.remove("hidden");
    });

    segment.addEventListener("mouseleave", () => {
      els.chartTooltip.classList.add("hidden");
    });
  });
}

function renderGrid(data) {
  const maxTotal = Math.max(
    1,
    ...data.months.flatMap((monthData) => data.years.map((year) => monthData.years[year].total))
  );

  els.statsGrid.innerHTML = data.months.map((monthData) => `
    <div class="month-panel">
      <div class="month-panel-title">${escapeHtml(monthData.monthLabel)}</div>
      ${buildMonthSvg(monthData, data.years, maxTotal, data.statusCodes)}
    </div>
  `).join("");

  data.months.forEach((monthData, index) => {
    const panel = els.statsGrid.children[index];

    attachTooltipHandlers(panel, monthData.monthLabel);
  });
}

async function loadStatistics() {
  els.statsGrid.innerHTML = `<div class="empty-state"><div class="spinner"></div>กำลังโหลด...</div>`;
  setStatus("กำลังโหลด...");

  try {
    const data = await requestJson("/api/statistics/enrollment-status");

    renderGrid(data);
    setStatus(`โหลดแล้ว — เทียบปี ${data.years.join(" / ")}`);
  } catch (error) {
    els.statsGrid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, "error");
  }
}

renderLegend();
loadStatistics();
