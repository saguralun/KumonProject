const els = {
  statsGrid: document.getElementById("statsGrid"),
  statusLine: document.getElementById("statusLine"),
  legendIn: document.getElementById("legendIn"),
  legendOut: document.getElementById("legendOut"),
  legendCurrent: document.getElementById("legendCurrent"),
  chartTooltip: document.getElementById("chartTooltip")
};

const setStatus = createStatusSetter(els.statusLine);

const STATUS_LABELS_TH = {
  N: "New Enrolment",
  IT: "Incoming Transfer",
  EO: "Enrolling Other Subject",
  R: "Resumed",
  A: "Absent",
  OT: "Outgoing Transfer",
  CP: "Completer",
  C: "Continue"
};

// Same color for all 3 years — with a year label already under every bar,
// a gray/color split wasn't needed to tell them apart.
const STATUS_COLORS = {
  N: "#2563eb",
  IT: "#0891b2",
  EO: "#059669",
  R: "#65a30d",
  A: "#d97706",
  OT: "#ea580c",
  CP: "#dc2626"
};

const CURRENT_COLOR = "#0f766e";

// Three side-by-side zones per month panel, each its own tight cluster of
// 3 year-bars (touching within a zone, a clear gap between zones) — per
// request: [ออก][เข้า][เรียนต่อ]. "current" (key stays "current" — it's
// just an internal id, not shown) has no `codes` (it's just C, not a
// stack) and is flagged `soloColor` so buildMonthSvg draws one plain bar
// per year instead of stacking segments.
const ZONES = [
  { key: "out", label: "ออก", codes: ["A", "OT", "CP"] },
  { key: "in", label: "เข้า", codes: ["N", "IT", "EO", "R"] },
  { key: "current", label: "เรียนต่อ", soloColor: true }
];

function renderLegend() {
  els.legendIn.innerHTML = ZONES.find((z) => z.key === "in").codes.map((code) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${STATUS_COLORS[code]}"></span>
      ${escapeHtml(code)} — ${escapeHtml(STATUS_LABELS_TH[code])}
    </div>
  `).join("");

  els.legendOut.innerHTML = ZONES.find((z) => z.key === "out").codes.map((code) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${STATUS_COLORS[code]}"></span>
      ${escapeHtml(code)} — ${escapeHtml(STATUS_LABELS_TH[code])}
    </div>
  `).join("");

  els.legendCurrent.innerHTML = `
    <div class="legend-row">
      <span class="legend-dot" style="background:${CURRENT_COLOR}"></span>
      C — ${escapeHtml(STATUS_LABELS_TH.C)}
    </div>
  `;
}

// zoneMax = { out, in, current } — each zone's own max, computed once over
// the WHOLE dataset (all 12 months) so bars stay comparable month to
// month within that zone, without letting Current's much larger scale
// flatten the out/in zones (the whole reason these are separate zones).
//
// monthData.years is THIS panel's own 3-year window — not shared across
// panels: a month that hasn't happened yet in the current year (e.g.
// October while today is in September) shows 2023/2024/2025 instead of
// 2024/2025/2026, so every panel always has 3 real, complete years rather
// than a placeholder for a year that isn't over yet. headYear (the latest
// year in that window) is shown as a heading inside the panel so it's
// clear which "latest year" this specific month is comparing against —
// it's 2026 for most months, but one year behind for any month later in
// the year than right now.
function buildMonthSvg(monthData, zoneMax) {
  const years = monthData.years;
  const barWidth = 22;
  const gapWithinZone = 3;
  const zoneGap = 20;
  const chartHeight = 90;
  const zoneLabelRow = 12; // ออก/เข้า/เรียนต่อ labels — headYear moved out to the HTML title line, so this is the topmost row again
  const marginTop = zoneLabelRow + 14; // + per-bar total label
  const marginBottom = 18; // year label
  const marginLeft = 6;
  const marginRight = 6;

  const zoneWidth = (years.length * barWidth) + ((years.length - 1) * gapWithinZone);
  const chartWidth = (ZONES.length * zoneWidth) + ((ZONES.length - 1) * zoneGap);
  const totalWidth = marginLeft + chartWidth + marginRight;
  const totalHeight = marginTop + chartHeight + marginBottom;
  const baselineY = marginTop + chartHeight;

  const parts = [];

  parts.push(`<svg class="stats-svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">`);
  parts.push(`<line class="stats-baseline" x1="${marginLeft}" y1="${baselineY}" x2="${marginLeft + chartWidth}" y2="${baselineY}" />`);

  ZONES.forEach((zone, zoneIndex) => {
    const zoneX = marginLeft + (zoneIndex * (zoneWidth + zoneGap));

    parts.push(`<text class="stats-zone-label" x="${zoneX + (zoneWidth / 2)}" y="${zoneLabelRow}" text-anchor="middle">${escapeHtml(zone.label)}</text>`);

    years.forEach((year, yearIndex) => {
      const yearData = monthData.yearData[year];
      const barX = zoneX + (yearIndex * (barWidth + gapWithinZone));
      const currentMonthClass = yearData.isCurrentMonth ? " stats-bar-current" : "";

      parts.push(`<text class="stats-axis-label" x="${barX + (barWidth / 2)}" y="${baselineY + 13}" text-anchor="middle">${year}</text>`);

      if (zone.soloColor) {
        const value = yearData.current;
        const max = zoneMax.current;
        const segmentHeight = max > 0 ? (value / max) * chartHeight : 0;

        if (value > 0) {
          parts.push(`<text class="stats-total-label" x="${barX + (barWidth / 2)}" y="${marginTop - 5}" text-anchor="middle">${value}</text>`);
          parts.push(
            `<rect class="stats-bar-segment${currentMonthClass}" x="${barX}" y="${(baselineY - segmentHeight).toFixed(1)}" width="${barWidth}" height="${segmentHeight.toFixed(1)}" fill="${CURRENT_COLOR}" ` +
            `data-year="${year}" data-month="${monthData.month}" data-code="C" data-value="${value}" data-current-month="${yearData.isCurrentMonth}" />`
          );
        }
        return;
      }

      const zoneTotal = zone.codes.reduce((sum, code) => sum + (yearData.byStatus[code] || 0), 0);
      const max = zoneMax[zone.key];

      if (zoneTotal > 0) {
        parts.push(`<text class="stats-total-label" x="${barX + (barWidth / 2)}" y="${marginTop - 5}" text-anchor="middle">${zoneTotal}</text>`);
      }

      let cumulativeY = baselineY;

      // The "still counting" dashed outline (currentMonthClass) is added
      // to every segment of a current-month bar, not just one — each
      // segment strokes its own edges, which reads fine as one dashed
      // outline given how thin these stacked segments are.
      zone.codes.forEach((code) => {
        const value = yearData.byStatus[code] || 0;

        if (value <= 0) {
          return;
        }

        const segmentHeight = max > 0 ? (value / max) * chartHeight : 0;
        const y = cumulativeY - segmentHeight;

        parts.push(
          `<rect class="stats-bar-segment${currentMonthClass}" x="${barX}" y="${y.toFixed(1)}" width="${barWidth}" height="${segmentHeight.toFixed(1)}" fill="${STATUS_COLORS[code]}" ` +
          `data-year="${year}" data-month="${monthData.month}" data-code="${code}" data-value="${value}" data-current-month="${yearData.isCurrentMonth}" />`
        );

        cumulativeY = y;
      });
    });
  });

  parts.push(`</svg>`);

  return parts.join("");
}

function attachTooltipHandlers(container, monthLabel) {
  container.querySelectorAll(".stats-bar-segment").forEach((segment) => {
    segment.addEventListener("mousemove", (event) => {
      const { year, code, value, currentMonth } = segment.dataset;

      els.chartTooltip.innerHTML = `
        <div class="tooltip-title">${escapeHtml(monthLabel)} ${escapeHtml(year)}${currentMonth === "true" ? " · กำลังนับ" : ""}</div>
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

// One max per zone, computed over the whole dataset (every month, and
// each month's own 3-year window — these can differ month to month, see
// buildMonthSvg) — keeps bar heights comparable across different months
// within a zone, while each zone's own scale stays independent of the
// others (Current is 10x+ the out/in totals some months and would
// otherwise flatten those zones to nothing on a shared axis).
function computeZoneMax(data) {
  const max = { out: 1, in: 1, current: 1 };

  data.months.forEach((monthData) => {
    monthData.years.forEach((year) => {
      const yearData = monthData.yearData[year];

      ZONES.forEach((zone) => {
        if (zone.soloColor) {
          max[zone.key] = Math.max(max[zone.key], yearData.current);
        } else {
          const zoneTotal = zone.codes.reduce((sum, code) => sum + (yearData.byStatus[code] || 0), 0);

          max[zone.key] = Math.max(max[zone.key], zoneTotal);
        }
      });
    });
  });

  return max;
}

function renderGrid(data) {
  const zoneMax = computeZoneMax(data);

  els.statsGrid.innerHTML = data.months.map((monthData) => {
    const isCurrentMonthPanel = monthData.years.some((year) => monthData.yearData[year].isCurrentMonth);

    return `
      <div class="month-panel${isCurrentMonthPanel ? " is-current-month" : ""}">
        <div class="month-panel-title">
          <span>${escapeHtml(monthData.monthLabel)}</span>
          <span class="head-year-label">ปี ${monthData.headYear}</span>
          ${isCurrentMonthPanel ? `<span class="current-month-badge">🔴 เดือนนี้ ยังนับไม่ครบ</span>` : ""}
        </div>
        ${buildMonthSvg(monthData, zoneMax)}
      </div>
    `;
  }).join("");

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
    setStatus("โหลดแล้ว");
  } catch (error) {
    els.statsGrid.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, "error");
  }
}

renderLegend();
loadStatistics();
