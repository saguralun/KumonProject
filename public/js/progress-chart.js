const els = {
  subjectTabs: document.getElementById("subjectTabs"),
  gradeFilter: document.getElementById("gradeFilter"),
  gradeFilterAll: document.getElementById("gradeFilterAll"),
  gradeFilterNone: document.getElementById("gradeFilterNone"),
  refreshButton: document.getElementById("refreshButton"),
  lineLegend: document.getElementById("lineLegend"),
  dotLegend: document.getElementById("dotLegend"),
  statusLine: document.getElementById("statusLine"),
  summaryCards: document.getElementById("summaryCards"),
  chartScroll: document.getElementById("chartScroll"),
  chartTooltip: document.getElementById("chartTooltip")
};

const SUBJECTS = ["ME", "EFL", "TRP"];
let activeSubject = "ME";
let dataCache = {};

// null = no filter applied yet (show every grade) — set to a real Set the
// first time the grade-filter checkboxes render for a subject, or by the
// user toggling one. Reset to null on subject switch since each subject
// can have a different grade list (TRP starts at ป.1, ME/EFL start at
// เตรียมอ.).
let selectedGrades = null;

const STATUS_COLORS = {
  none: "#94a3b8",
  "0": "#7dd3fc",
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

// Precise "how far ahead" text for the tooltip, from the server's exact
// gapMonths (see progressChartService.js). The 6M/2Y/3Y/5Y/7Y colors
// stay tied to the coarse award-tier lines — this is purely extra detail
// for the one dot you're hovering: under 6 months it's just "on pace",
// 6-11 months stays the flat "6 เดือน" label (that's still its own
// award tier, no finer breakdown wanted there), but a full year or more
// gets an exact "X ปี Y เดือน" reading instead of snapping to the
// nearest tier badge.
function formatGapLabel(gapMonths) {
  if (gapMonths === null || gapMonths === undefined || gapMonths < 0) {
    return STATUS_LABELS.none;
  }

  if (gapMonths < 6) {
    return STATUS_LABELS.KSIS;
  }

  if (gapMonths < 12) {
    return STATUS_LABELS["6M"];
  }

  const years = Math.floor(gapMonths / 12);
  const months = gapMonths % 12;

  return months === 0 ? `เกินชั้นเรียน ${years} ปี` : `เกินชั้นเรียน ${years} ปี ${months} เดือน`;
}

const setStatus = createStatusSetter(els.statusLine);

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
      selectedGrades = null; // different subject can have a different grade list
      renderSubjectTabs();
      renderChart();
    });
  });
}

// Small toggle buttons, one per grade this subject actually has — lets
// staff narrow the chart down to one or a few specific grades instead of
// always seeing every grade at once. Renders after data loads (grades
// come from the API response, not a fixed list) and re-renders each time
// so the "active" highlighting stays in sync with selectedGrades.
function renderGradeFilter(data) {
  if (selectedGrades === null) {
    selectedGrades = new Set(data.grades);
  }

  els.gradeFilter.innerHTML = data.grades.map((gradeLabel) => `
    <button
      type="button"
      class="grade-filter-tab ${selectedGrades.has(gradeLabel) ? "active" : ""}"
      data-grade="${escapeHtml(gradeLabel)}"
    >${escapeHtml(gradeLabel)}</button>
  `).join("");

  [...els.gradeFilter.querySelectorAll(".grade-filter-tab")].forEach((button) => {
    button.addEventListener("click", () => {
      const grade = button.dataset.grade;

      if (selectedGrades.has(grade)) {
        selectedGrades.delete(grade);
      } else {
        selectedGrades.add(grade);
      }

      renderGradeFilter(data);
      renderChart({ skipFetch: true });
    });
  });
}

// Grades/students/reference-line points trimmed down to just the
// selected grades — buildSvg never needs to know filtering happened at
// all, it just draws whatever grade list it's handed.
function filterDataByGrades(data) {
  if (!selectedGrades || selectedGrades.size === data.grades.length) {
    return data;
  }

  const grades = data.grades.filter((gradeLabel) => selectedGrades.has(gradeLabel));
  const gradeIndexSet = new Set(data.grades
    .map((gradeLabel, index) => (selectedGrades.has(gradeLabel) ? index : -1))
    .filter((index) => index !== -1));

  return {
    ...data,
    grades,
    students: data.students.filter((student) => selectedGrades.has(student.gradeClass)),
    referenceLines: data.referenceLines.map((line) => ({
      ...line,
      points: line.points.filter((_, index) => gradeIndexSet.has(index))
    }))
  };
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

function buildSvg(data) {
  const cellWidth = 74;
  const levelHeight = 32; // fixed pixels per curriculum level unit — no more growing cells
  const marginLeft = 64;
  const marginTop = 16;
  const marginBottom = 70;
  const marginRight = 90;
  const dotRadius = 3.5;
  const dotSlot = 10; // minimum center-to-center spacing between two dots
  const cellPaddingX = 4;

  const numGrades = data.grades.length;
  const numLevels = data.levels.length;
  const chartWidth = numGrades * cellWidth;
  const chartHeight = numLevels * levelHeight;
  const dotsPerColumn = Math.max(1, Math.floor((cellWidth - (cellPaddingX * 2)) / dotSlot));

  const xScale = (gradeIndex) => marginLeft + (gradeIndex * cellWidth);
  // A plain, fixed linear scale — levelPosition 0 sits at the very
  // bottom, numLevels at the very top. Unlike the old per-level grid-cell
  // layout, this never needs to grow: a dot's Y is always exactly where
  // its real levelPosition says, so it can freely sit across a grid line
  // instead of being boxed into whichever single level "owns" it.
  const yScale = (levelPosition) => marginTop + ((numLevels - levelPosition) * levelHeight);

  const totalWidth = marginLeft + chartWidth + marginRight;
  const totalHeight = marginTop + chartHeight + marginBottom;

  // Each award band gets a fixed number of evenly-spaced slots instead of
  // students landing at their exact raw position: the KSIS band (0-6
  // months ahead) gets 1 slot dead center, the 6M-2Y band (6-24 months,
  // 18 months wide) gets 3 slots 6 months apart, and so on — every band
  // divided into 6-month-wide slots. Concretely this is a single global
  // grid of slot centers at ..., -9, -3, 3, 9, 15, 21, ... (every 6
  // months, offset by 3 so each band's slots fall exactly inside it) —
  // a student's real "months ahead of pace" snaps to the nearest one.
  //
  // Months-ahead isn't sent from the server directly (it's null for
  // anyone behind pace, since computeGradeSyncStatus deliberately never
  // exposes a negative gap) — so both directions are derived here from
  // the six known reference-line points already on this same grade
  // column (0/6M/2Y/3Y/5Y/7Y), which is exactly the same real-time
  // month<->levelPosition relationship the server used to place those
  // lines, just linearly interpolated between the known points instead
  // of recomputing the full curriculum-structure math client-side.
  const EDGE_MONTHS = { "0": 0, "6M": 6, "2Y": 24, "3Y": 36, "5Y": 60, "7Y": 84 };

  function interpolate(x, points, getX, getY) {
    // points are ascending in getX. Pick the segment x actually falls
    // in, or the first/last segment to extrapolate past either end.
    let a = points[0];
    let b = points[1];

    if (x >= getX(points[points.length - 1])) {
      a = points[points.length - 2];
      b = points[points.length - 1];
    } else {
      for (let i = 0; i < points.length - 1; i += 1) {
        if (x >= getX(points[i]) && x <= getX(points[i + 1])) {
          a = points[i];
          b = points[i + 1];
          break;
        }
      }
    }

    const frac = (x - getX(a)) / (getX(b) - getX(a));

    return getY(a) + (frac * (getY(b) - getY(a)));
  }

  function edgesForGrade(gradeIndex) {
    return data.referenceLines.map((line) => ({
      months: EDGE_MONTHS[line.code],
      levelPosition: line.points[gradeIndex].levelPosition
    }));
  }

  function snapLevelPosition(levelPosition, edges) {
    const months = interpolate(levelPosition, edges, (e) => e.levelPosition, (e) => e.months);
    const snappedMonths = (Math.round((months - 3) / 6) * 6) + 3;

    return interpolate(snappedMonths, edges, (e) => e.months, (e) => e.levelPosition);
  }

  const parts = [];

  parts.push(`<svg class="progress-svg" width="${totalWidth}" height="${totalHeight}" viewBox="0 0 ${totalWidth} ${totalHeight}" xmlns="http://www.w3.org/2000/svg">`);

  // Table-like grid — one line per level boundary and per grade, purely
  // as a background reference now (dots are free to cross them).
  for (let levelIndex = 0; levelIndex <= numLevels; levelIndex += 1) {
    const y = yScale(levelIndex);

    parts.push(`<line class="grid-line" x1="${marginLeft}" y1="${y}" x2="${marginLeft + chartWidth}" y2="${y}" />`);
  }

  for (let gradeIndex = 0; gradeIndex <= numGrades; gradeIndex += 1) {
    const x = xScale(gradeIndex);

    parts.push(`<line class="grid-line" x1="${x}" y1="${marginTop}" x2="${x}" y2="${marginTop + chartHeight}" />`);
  }

  // Y axis labels (levels), centered in each level's fixed band.
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

  // Reference lines (0 / 6M / 2Y / 3Y / 5Y / 7Y) — a real-time staircase,
  // each grade's segment computed with the exact same formula
  // computeGradeSyncStatus() uses for that same student's own status
  // (see progressChartService.js), so a dot's status color is always
  // consistent with which side of these lines its real position falls
  // on: both derive from the identical "expectedMonths = grade*12 +
  // schoolYearFraction(today)*12" baseline, and now that dots plot at
  // their exact continuous position instead of a snapped grid cell,
  // that consistency no longer needs any extra clamping to hold.
  data.referenceLines.forEach((line) => {
    const color = STATUS_COLORS[line.code] || "#94a3b8";
    const stepPoints = line.points.flatMap((point, index) => {
      const y = yScale(point.levelPosition);

      return [`${xScale(index)},${y}`, `${xScale(index + 1)},${y}`];
    });

    parts.push(`<polyline class="ref-line" points="${stepPoints.join(" ")}" stroke="${color}" />`);

    const lastPoint = line.points[line.points.length - 1];

    parts.push(`<text class="ref-line-label" x="${xScale(data.grades.length) + 4}" y="${yScale(lastPoint.levelPosition) + 3}" fill="${color}">${escapeHtml(line.code)}</text>`);
  });

  // Student dots — snapped onto that fixed 6-month slot grid instead of
  // their exact raw position, so a dot sits in one of a small, sane
  // number of predictable spots per band instead of anywhere continuous.
  // Grouped by which exact slot they land on FIRST, then packed sideways
  // within that one group — not by generic distance to any other already-
  // placed dot, which would wrongly treat two students on two DIFFERENT
  // (but pixel-close) canonical slots as if they were competing for the
  // same row. Only when one slot itself is more crowded than a row can
  // hold does it add an extra row directly below that same slot (never
  // above — never make a student look more advanced than they are).
  for (let gradeIndex = 0; gradeIndex < numGrades; gradeIndex += 1) {
    const gradeLabel = data.grades[gradeIndex];
    const edges = edgesForGrade(gradeIndex);
    const students = data.students.filter((student) => student.gradeClass === gradeLabel);

    const cellLeft = xScale(gradeIndex) + cellPaddingX;
    const slots = new Map(); // key: snapped levelPosition (rounded) -> { y, students[] }

    students.forEach((student) => {
      const snappedLevelPosition = snapLevelPosition(student.levelPosition, edges);
      const key = snappedLevelPosition.toFixed(4);

      if (!slots.has(key)) {
        slots.set(key, { y: yScale(snappedLevelPosition), students: [] });
      }

      slots.get(key).students.push(student);
    });

    slots.forEach(({ y: slotY, students: slotStudents }) => {
      const sorted = [...slotStudents].sort((a, b) => b.levelPosition - a.levelPosition);

      sorted.forEach((student, index) => {
        const column = index % dotsPerColumn;
        const extraRow = Math.floor(index / dotsPerColumn);
        const x = cellLeft + (column * dotSlot) + (dotSlot / 2);
        const y = slotY + (extraRow * dotSlot);
        const color = STATUS_COLORS[student.gradeSyncStatus?.code || "none"];

        parts.push(`<circle class="student-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${dotRadius}" fill="${color}" data-enrollment-id="${student.enrollmentId}" />`);
      });
    });
  }

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

      const statusLabel = formatGapLabel(student.gradeSyncStatus?.gapMonths);

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

// { skipFetch: true } is used by the grade-filter toggle handlers — they
// only change what's already-loaded data gets filtered down to, so
// there's no reason to re-hit the API or show the loading spinner again.
async function renderChart({ skipFetch = false } = {}) {
  if (!skipFetch) {
    els.chartScroll.innerHTML = `<div class="empty-state"><div class="spinner"></div>กำลังโหลด...</div>`;
    setStatus("กำลังโหลด...");
  }

  try {
    if (!dataCache[activeSubject]) {
      dataCache[activeSubject] = await requestJson(`/api/progress-chart?subject=${encodeURIComponent(activeSubject)}`);
    }

    const data = dataCache[activeSubject];

    renderGradeFilter(data);

    const filtered = filterDataByGrades(data);

    renderSummary(filtered);

    if (!filtered.grades.length) {
      els.chartScroll.innerHTML = `<div class="empty-state">ยังไม่ได้เลือกชั้นเรียนเลย — เลือกอย่างน้อย 1 ชั้นทางซ้าย</div>`;
      setStatus("ยังไม่ได้เลือกชั้นเรียน");
      return;
    }

    if (!filtered.students.length) {
      els.chartScroll.innerHTML = `<div class="empty-state">ไม่มีเด็ก active ในชั้นเรียน/วิชานี้</div>`;
      setStatus("โหลดแล้ว — ไม่มีข้อมูล");
      return;
    }

    els.chartScroll.innerHTML = buildSvg(filtered);
    attachTooltipHandlers(els.chartScroll, filtered);
    setStatus(`โหลดแล้ว — ${filtered.students.length.toLocaleString("th-TH")} คน`);
  } catch (error) {
    els.chartScroll.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.summaryCards.innerHTML = "";
    setStatus(error.message, "error");
  }
}

function refresh() {
  dataCache = {};
  renderChart();
}

els.refreshButton.addEventListener("click", refresh);
els.gradeFilterAll.addEventListener("click", () => {
  const data = dataCache[activeSubject];

  if (!data) {
    return;
  }

  selectedGrades = new Set(data.grades);
  renderChart({ skipFetch: true });
});
els.gradeFilterNone.addEventListener("click", () => {
  selectedGrades = new Set();
  renderChart({ skipFetch: true });
});

renderSubjectTabs();
renderLegends();
renderChart();
