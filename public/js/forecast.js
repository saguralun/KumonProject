const els = {
  forecastDays: document.getElementById("forecastDays"),
  forecastButton: document.getElementById("forecastButton"),
  orderButton: document.getElementById("orderButton"),
  expectedStockButton: document.getElementById("expectedStockButton"),
  recalculateForecastButton: document.getElementById("recalculateForecastButton"),
  subjectTabs: document.getElementById("subjectTabs"),
  forecastResultsView: document.getElementById("forecastResultsView"),
  orderResultsView: document.getElementById("orderResultsView"),
  expectedStockResultsView: document.getElementById("expectedStockResultsView"),
  statusLine: document.getElementById("statusLine"),
  resultSubtitle: document.getElementById("resultSubtitle"),
  forecastSummary: document.getElementById("forecastSummary"),
  forecastTableWrap: document.getElementById("forecastTableWrap"),
  cdForecastTableWrap: document.getElementById("cdForecastTableWrap"),
  forecastDetailModal: document.getElementById("forecastDetailModal"),
  forecastDetailClose: document.getElementById("forecastDetailClose"),
  forecastDetailTitle: document.getElementById("forecastDetailTitle"),
  forecastDetailSubtitle: document.getElementById("forecastDetailSubtitle"),
  forecastDetailStats: document.getElementById("forecastDetailStats"),
  forecastDetailStudents: document.getElementById("forecastDetailStudents"),
  orderSuggestionTableWrap: document.getElementById("orderSuggestionTableWrap"),
  orderCdSuggestionTableWrap: document.getElementById("orderCdSuggestionTableWrap"),
  expectedStockSubtitle: document.getElementById("expectedStockSubtitle"),
  expectedStockTableWrap: document.getElementById("expectedStockTableWrap"),
  expectedStockCdTableWrap: document.getElementById("expectedStockCdTableWrap"),
  exportForecastButton: document.getElementById("exportForecastButton"),
  exportOrderButton: document.getElementById("exportOrderButton"),
  exportExpectedStockButton: document.getElementById("exportExpectedStockButton")
};

let lastForecastData = null;
let activeSubjectCode = null;
let lastOrderPlan = [];
let lastCdOrderPlan = [];
let currentView = "forecast";

const setStatus = createStatusSetter(els.statusLine);

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

const SUBJECT_ORDER = ["ME", "EFL", "TRP"];

function getAvailableSubjects(data) {
  const codes = new Set();

  (data.rows || []).forEach((row) => codes.add(row.subject));
  (data.cdRows || []).forEach((row) => codes.add(row.subject));

  return [...codes].sort((a, b) => {
    const indexA = SUBJECT_ORDER.indexOf(a);
    const indexB = SUBJECT_ORDER.indexOf(b);

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
}

function renderSubjectTabs() {
  const subjects = getAvailableSubjects(lastForecastData || {});

  els.subjectTabs.innerHTML = subjects.map((code) => `
    <button
      type="button"
      class="subject-tab ${code === activeSubjectCode ? "active" : ""}"
      data-subject="${escapeHtml(code)}"
    >${escapeHtml(code)}</button>
  `).join("");

  [...els.subjectTabs.querySelectorAll(".subject-tab")].forEach((button) => {
    button.addEventListener("click", () => {
      activeSubjectCode = button.dataset.subject;

      if (currentView === "order") {
        renderOrderSuggestionTable();
      } else if (currentView === "expected") {
        renderExpectedStockTable();
      } else {
        renderActiveSubject();
      }
    });
  });
}

function renderForecastSummary(rows, cdRows, cache) {
  const levelCount = new Set(rows.map((row) => row.levelMasterId)).size;
  const totalPrepareQty = rows.reduce((sum, row) => sum + row.prepareQty, 0);
  const totalEstimatedCpws = rows.reduce((sum, row) => sum + row.neededCpws, 0);
  const totalPrepareCd = cdRows.reduce((sum, row) => sum + row.prepareQty, 0);

  els.forecastSummary.innerHTML = `
    <div class="forecast-card">
      <span>วิชา</span>
      <strong>${escapeHtml(activeSubjectCode || "-")}</strong>
    </div>
    <div class="forecast-card">
      <span>ระดับที่มีในช่วงนี้</span>
      <strong>${formatNumber(levelCount)}</strong>
    </div>
    <div class="forecast-card">
      <span>WS ต้องเตรียม</span>
      <strong>${formatNumber(totalPrepareQty)}</strong>
    </div>
    <div class="forecast-card">
      <span>ประมาณ CPWS</span>
      <strong>${formatNumber(totalEstimatedCpws, 1)}</strong>
    </div>
    <div class="forecast-card">
      <span>CD ต้องเตรียม</span>
      <strong>${formatNumber(totalPrepareCd)}</strong>
    </div>
    <div class="forecast-card">
      <span>Average cache</span>
      <strong>${escapeHtml(cache.recalculated ? "คำนวณใหม่" : "พร้อมใช้")}</strong>
    </div>
  `;
}

// Lookup used by the click-a-cell detail modal — key is "subjectId:levelMasterId:packet".
let wsRowLookup = new Map();

function buildWsPivot(rows) {
  const columnSet = new Set();
  const levelMap = new Map();
  const levelOrder = [];

  rows.forEach((row) => {
    columnSet.add(Number(row.packet));

    const levelKey = `${row.subjectId}:${row.levelMasterId}`;

    if (!levelMap.has(levelKey)) {
      levelMap.set(levelKey, {
        subjectId: row.subjectId,
        levelMasterId: row.levelMasterId,
        subjectCode: row.subject,
        levelCode: row.level,
        values: {},
        total: 0
      });
      levelOrder.push(levelKey);
    }

    const level = levelMap.get(levelKey);

    level.values[row.packet] = row.prepareQty;
    level.total += row.prepareQty;

    wsRowLookup.set(`${row.subjectId}:${row.levelMasterId}:${row.packet}`, row);
  });

  levelOrder.sort((a, b) => {
    const levelA = levelMap.get(a);
    const levelB = levelMap.get(b);

    return levelA.subjectId - levelB.subjectId || levelA.levelMasterId - levelB.levelMasterId;
  });

  const columns = [...columnSet].sort((a, b) => a - b);
  const levels = levelOrder.map((key) => levelMap.get(key));
  const columnTotals = {};

  columns.forEach((column) => {
    columnTotals[column] = levels.reduce((sum, level) => sum + (level.values[column] || 0), 0);
  });

  const grandTotal = levels.reduce((sum, level) => sum + level.total, 0);

  return { columns, levels, columnTotals, grandTotal };
}

function renderWsPivotTable(pivot) {
  if (!pivot.levels.length) {
    els.forecastTableWrap.innerHTML = `<div class="empty-state">ไม่มีรายการที่ต้องเตรียม หรือยังไม่มีค่าเฉลี่ยพอสำหรับ forecast</div>`;
    return;
  }

  els.forecastTableWrap.innerHTML = `
    <table class="forecast-pivot-table">
      <thead>
        <tr>
          <th class="is-sticky-col">Level</th>
          ${pivot.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}
          <th class="is-total-col">รวม</th>
        </tr>
      </thead>
      <tbody>
        ${pivot.levels.map((level) => `
          <tr>
            <td class="is-sticky-col">${escapeHtml(level.levelCode)}</td>
            ${pivot.columns.map((column) => {
              const value = level.values[column];

              return value === undefined
                ? `<td class="is-blank"></td>`
                : `<td class="is-cell" data-subject-id="${level.subjectId}" data-level-id="${level.levelMasterId}" data-packet="${column}">${formatNumber(value)}</td>`;
            }).join("")}
            <td class="is-total-col"><strong>${formatNumber(level.total)}</strong></td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td class="is-sticky-col">รวม</td>
          ${pivot.columns.map((column) => `<td><strong>${formatNumber(pivot.columnTotals[column])}</strong></td>`).join("")}
          <td class="is-total-col"><strong>${formatNumber(pivot.grandTotal)}</strong></td>
        </tr>
      </tfoot>
    </table>
  `;

  [...els.forecastTableWrap.querySelectorAll("td.is-cell")].forEach((cell) => {
    cell.addEventListener("click", () => {
      const row = wsRowLookup.get(`${cell.dataset.subjectId}:${cell.dataset.levelId}:${cell.dataset.packet}`);

      if (row) {
        openForecastDetail(row);
      }
    });
  });
}

function openDetailModal({ title, subtitle, statsHtml, enrollments = [], students = 0 }) {
  els.forecastDetailTitle.textContent = title;
  els.forecastDetailSubtitle.textContent = subtitle;
  els.forecastDetailStats.innerHTML = statsHtml;

  const sampleNote = enrollments.length < students
    ? `<div class="subtle">แสดง ${enrollments.length} คนแรก จากทั้งหมด ${students} คน</div>`
    : "";

  els.forecastDetailStudents.innerHTML = `
    ${sampleNote}
    ${enrollments.map((item) => `
      <div class="forecast-student-chip">
        <span>#${item.enrollmentId} ${escapeHtml(item.nickname || item.name)}</span>
        ${item.isKc ? `<span class="is-kc">KC</span>` : ""}
      </div>
    `).join("") || `<div class="subtle">ไม่มีข้อมูลตัวอย่างเด็ก</div>`}
  `;

  els.forecastDetailModal.classList.remove("hidden");
}

function openForecastDetail(row) {
  openDetailModal({
    title: `${row.label} (${row.subject})`,
    subtitle: `Level ${row.level} · Packet ${row.packet}`,
    statsHtml: `
      <div class="forecast-card">
        <span>ต้องเตรียม</span>
        <strong>${formatNumber(row.prepareQty)}</strong>
      </div>
      <div class="forecast-card">
        <span>ประมาณ CPWS</span>
        <strong>${formatNumber(row.neededCpws, 2)}</strong>
      </div>
      <div class="forecast-card">
        <span>เด็กที่เกี่ยวข้อง</span>
        <strong>${formatNumber(row.students)}</strong>
      </div>
      <div class="forecast-card">
        <span>Avg Days</span>
        <strong>${formatNumber(row.avgDays, 2)}</strong>
      </div>
      <div class="forecast-card">
        <span>Avg CPWS</span>
        <strong>${formatNumber(row.avgCpws, 2)}</strong>
      </div>
      <div class="forecast-card">
        <span>Source</span>
        <strong>${escapeHtml(row.avgSource)} (${formatNumber(row.avgStudentCount)} คน)</strong>
      </div>
    `,
    enrollments: row.enrollments || [],
    students: row.students
  });
}

function openForecastCdDetail(row) {
  openDetailModal({
    title: `CD (${row.subject})`,
    subtitle: `Level ${row.level}`,
    statsHtml: `
      <div class="forecast-card">
        <span>ต้องเตรียม (CD)</span>
        <strong>${formatNumber(row.prepareQty)}</strong>
      </div>
      <div class="forecast-card">
        <span>เด็กที่ข้าม level นี้</span>
        <strong>${formatNumber(row.students)}</strong>
      </div>
    `,
    enrollments: row.enrollments || [],
    students: row.students
  });
}

function closeForecastDetail() {
  els.forecastDetailModal.classList.add("hidden");
}

function renderActiveSubject() {
  const data = lastForecastData || { rows: [], cdRows: [], cache: {} };

  renderSubjectTabs();

  if (!activeSubjectCode) {
    els.forecastSummary.innerHTML = "";
    els.forecastTableWrap.innerHTML = `<div class="empty-state">ยังไม่มี Forecast</div>`;
    els.cdForecastTableWrap.innerHTML = `<div class="empty-state">ยังไม่มี Forecast</div>`;
    return;
  }

  const rows = (data.rows || []).filter((row) => row.subject === activeSubjectCode);
  const cdRows = (data.cdRows || []).filter((row) => row.subject === activeSubjectCode);

  wsRowLookup = new Map();

  renderForecastSummary(rows, cdRows, data.cache || {});
  renderCdForecastTable({ cdRows });
  renderWsPivotTable(buildWsPivot(rows));
}

// Lookup used by the click-a-cell detail modal — key is "subjectId:levelMasterId".
let cdRowLookup = new Map();

function renderCdForecastTable(data) {
  const cdRows = data.cdRows || [];

  cdRowLookup = new Map();

  if (!cdRows.length) {
    els.cdForecastTableWrap.innerHTML = `<div class="empty-state">ไม่มี level ที่ต้องแจก CD ในช่วง forecast นี้</div>`;
    return;
  }

  cdRows.forEach((row) => {
    cdRowLookup.set(`${row.subjectId}:${row.levelMasterId}`, row);
  });

  els.cdForecastTableWrap.innerHTML = `
    <table class="forecast-pivot-table">
      <thead>
        <tr>
          <th class="is-sticky-col">Level</th>
          <th>ต้องเตรียม (CD)</th>
          <th class="is-total-col">เด็ก</th>
        </tr>
      </thead>
      <tbody>
        ${cdRows.map((row) => `
          <tr>
            <td class="is-sticky-col">${escapeHtml(row.level)}</td>
            <td class="is-cell" data-subject-id="${row.subjectId}" data-level-id="${row.levelMasterId}">${formatNumber(row.prepareQty)}</td>
            <td class="is-total-col">${formatNumber(row.students)}</td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td class="is-sticky-col">รวม</td>
          <td><strong>${formatNumber(cdRows.reduce((sum, row) => sum + row.prepareQty, 0))}</strong></td>
          <td class="is-total-col"><strong>${formatNumber(cdRows.reduce((sum, row) => sum + row.students, 0))}</strong></td>
        </tr>
      </tfoot>
    </table>
  `;

  [...els.cdForecastTableWrap.querySelectorAll("td.is-cell")].forEach((cell) => {
    cell.addEventListener("click", () => {
      const row = cdRowLookup.get(`${cell.dataset.subjectId}:${cell.dataset.levelId}`);

      if (row) {
        openForecastCdDetail(row);
      }
    });
  });
}

// Order formula (client-side — reuses the forecast already on screen plus
// live stock, no separate lead-time/buffer inputs):
//   1. levelTotal = sum of prepareQty across every packet in that level
//      (the same number already shown in the WS pivot's "รวม" column).
//   2. targetStock = 5 (flat base) + ceil(levelTotal / 10) — one flat
//      minimum-stock target that applies to every packet in the level.
//   3. per packet: remaining = currentStock - packetForecast.
//      remaining >= targetStock -> no order. Otherwise
//      rawOrder = targetStock - remaining.
//   4. round rawOrder to the nearest multiple of 5 (or 3 when levelTotal is
//      under 30 — low-volume levels round on a finer step) so every order
//      quantity ends in 0/5 (or 0/3/6/9 for the low-volume case).
// TRP 7A/6A are excluded — same reason as the Stock page: no real WS packet
// ever gets stocked for them (cpws is essentially never TRUE there).
const NO_REAL_STOCK_LEVELS = new Set(["TRP:7A", "TRP:6A"]);

// The 20 packets per level split into 4 zones of 5 — the baseline target is
// computed per zone (zoneTotal / 2.5) instead of once for the whole level
// (levelTotal / 10), so a level with demand concentrated in one zone (e.g.
// everyone still early, zone A) doesn't prop up the target for packets in a
// zone nobody's near yet (zone D). Both old and new formulas scale demand by
// the same factor overall (2x) — this just applies it per zone instead of
// spreading it across all 20 packets.
const ORDER_ZONES = [
  [1, 11, 21, 31, 41],
  [51, 61, 71, 81, 91],
  [101, 111, 121, 131, 141],
  [151, 161, 171, 181, 191]
];

function getZoneIndex(packet) {
  return ORDER_ZONES.findIndex((zone) => zone.includes(packet));
}

function computeOrderPlan(forecastRows, stockData) {
  // forecast lookup + per-zone totals — keyed off forecast rows only
  // (packets with no active student nearby simply aren't in here, and
  // contribute 0).
  const forecastLookup = new Map();
  const zoneTotals = new Map();

  forecastRows.forEach((row) => {
    if (NO_REAL_STOCK_LEVELS.has(`${row.subject}:${row.level}`)) {
      return;
    }

    const levelKey = `${row.subjectId}:${row.levelMasterId}`;

    forecastLookup.set(`${levelKey}:${row.packet}`, row.prepareQty);

    const zoneIndex = getZoneIndex(Number(row.packet));

    if (zoneIndex !== -1) {
      if (!zoneTotals.has(levelKey)) {
        zoneTotals.set(levelKey, [0, 0, 0, 0]);
      }

      zoneTotals.get(levelKey)[zoneIndex] += row.prepareQty;
    }
  });

  const orders = [];

  // Drive the actual per-packet check off the full stock universe (every
  // packet that physically exists per level, stock = 0 included) — not just
  // whatever packets the current forecast window happens to touch. A packet
  // with zero forecasted demand right now still gets used over time (the
  // Stock Cut flow keeps deducting from it), so it still needs its target
  // stock checked, just with packetForecast = 0 when there's no forecast row.
  (stockData.subjects || []).forEach((subject) => {
    subject.ws.levels.forEach((level) => {
      const levelKey = `${subject.subjectId}:${level.levelMasterId}`;
      const zones = zoneTotals.get(levelKey) || [0, 0, 0, 0];

      Object.entries(level.values).forEach(([packet, currentStock]) => {
        const packetNum = Number(packet);
        const zoneIndex = getZoneIndex(packetNum);
        const zoneTotal = zoneIndex === -1 ? 0 : zones[zoneIndex];
        const targetStock = 5 + Math.ceil(zoneTotal / 2.5);
        const packetForecast = forecastLookup.get(`${levelKey}:${packet}`) || 0;
        const remaining = currentStock - packetForecast;

        // No forecasted demand anywhere in this packet's zone — still show
        // the level/packet in the table, just never flag an order for it (a
        // bare 5-unit baseline nobody's about to touch).
        let orderQty = 0;

        if (zoneTotal > 0 && remaining < targetStock) {
          const rawOrder = targetStock - remaining;
          const roundTo = zoneTotal < 30 ? 3 : 5;

          orderQty = Math.round(rawOrder / roundTo) * roundTo;
        }

        orders.push({
          subjectId: subject.subjectId,
          subject: subject.subjectCode,
          levelMasterId: level.levelMasterId,
          levelType: level.levelType,
          level: level.levelCode,
          packet: packetNum,
          zoneTotal,
          targetStock,
          currentStock,
          packetForecast,
          orderQty,
          expectedStock: currentStock - packetForecast + orderQty
        });
      });
    });
  });

  return orders.sort((a, b) => b.orderQty - a.orderQty);
}

// Same formula as computeOrderPlan, applied to CD. CD forecast has no
// per-packet breakdown (one number per level), and every level only ever
// carries one CD in practice — so the whole level's forecast attributes to
// that single cd_no slot. Field is still named `packet` (aliasing cd_no) so
// this can share buildOrderPivot()/the pivot table renderer with WS as-is.
function computeCdOrderPlan(cdForecastRows, stockData) {
  const levelTotals = new Map();

  cdForecastRows.forEach((row) => {
    const levelKey = `${row.subjectId}:${row.levelMasterId}`;

    levelTotals.set(levelKey, (levelTotals.get(levelKey) || 0) + row.prepareQty);
  });

  const orders = [];

  (stockData.subjects || []).forEach((subject) => {
    subject.cd.levels.forEach((level) => {
      const levelKey = `${subject.subjectId}:${level.levelMasterId}`;
      const levelTotal = levelTotals.get(levelKey) || 0;
      const targetStock = 5 + Math.ceil(levelTotal / 10);

      Object.entries(level.values).forEach(([cdNo, currentStock]) => {
        const packetForecast = levelTotal;
        const remaining = currentStock - packetForecast;

        let orderQty = 0;

        if (levelTotal > 0 && remaining < targetStock) {
          const rawOrder = targetStock - remaining;
          const roundTo = levelTotal < 30 ? 3 : 5;

          orderQty = Math.round(rawOrder / roundTo) * roundTo;
        }

        orders.push({
          subjectId: subject.subjectId,
          subject: subject.subjectCode,
          levelMasterId: level.levelMasterId,
          levelType: level.levelType,
          level: level.levelCode,
          packet: Number(cdNo),
          levelTotal,
          targetStock,
          currentStock,
          packetForecast,
          orderQty,
          expectedStock: currentStock - packetForecast + orderQty
        });
      });
    });
  });

  return orders.sort((a, b) => b.orderQty - a.orderQty);
}

function buildOrderPivot(orders, valueKey = "orderQty") {
  const columnSet = new Set();
  const levelMap = new Map();
  const levelOrder = [];

  orders.forEach((row) => {
    columnSet.add(row.packet);

    const levelKey = `${row.subjectId}:${row.levelMasterId}`;

    if (!levelMap.has(levelKey)) {
      levelMap.set(levelKey, {
        subjectId: row.subjectId,
        levelMasterId: row.levelMasterId,
        levelType: row.levelType,
        levelCode: row.level,
        values: {},
        total: 0
      });
      levelOrder.push(levelKey);
    }

    const level = levelMap.get(levelKey);
    const value = row[valueKey];

    level.values[row.packet] = value;
    level.total += value;
  });

  // Main levels (level_type 1) before Zun (level_type 2) — Zun levels have
  // low level_master_id values (they were seeded first), so sorting by id
  // alone puts them ahead of every main level instead of after O, same fix
  // Stock/Forecast already apply.
  levelOrder.sort((a, b) => {
    const levelA = levelMap.get(a);
    const levelB = levelMap.get(b);

    return levelA.levelType - levelB.levelType || levelA.levelMasterId - levelB.levelMasterId;
  });

  const columns = [...columnSet].sort((a, b) => a - b);
  const levels = levelOrder.map((key) => levelMap.get(key));
  const columnTotals = {};

  columns.forEach((column) => {
    columnTotals[column] = levels.reduce((sum, level) => sum + (level.values[column] || 0), 0);
  });

  const grandTotal = levels.reduce((sum, level) => sum + level.total, 0);

  return { columns, levels, columnTotals, grandTotal };
}

function orderCellClass(value) {
  return value > 0 ? "is-order" : "is-zero";
}

// Same red/orange bands as the Stock page, since these cells are a
// projected quantity (not an order flag).
function expectedStockCellClass(value) {
  if (value < 5) {
    return "is-out";
  }

  if (value < 10) {
    return "is-low";
  }

  return "is-zero";
}

function renderOrderPivotInto(wrapEl, orders, {
  columnPrefix = "",
  emptyMessage = "ไม่มีข้อมูล",
  valueKey = "orderQty",
  cellClass = orderCellClass
} = {}) {
  if (!activeSubjectCode) {
    wrapEl.innerHTML = `<div class="empty-state">ยังไม่มี Forecast</div>`;
    return;
  }

  const pivot = buildOrderPivot(orders.filter((row) => row.subject === activeSubjectCode), valueKey);

  if (!pivot.levels.length) {
    wrapEl.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  wrapEl.innerHTML = `
    <table class="forecast-pivot-table">
      <thead>
        <tr>
          <th class="is-sticky-col">Level</th>
          ${pivot.columns.map((column) => `<th>${escapeHtml(columnPrefix)}${escapeHtml(column)}</th>`).join("")}
          <th class="is-total-col">รวม</th>
        </tr>
      </thead>
      <tbody>
        ${pivot.levels.map((level) => `
          <tr>
            <td class="is-sticky-col">${escapeHtml(level.levelCode)}</td>
            ${pivot.columns.map((column) => {
              const value = level.values[column];

              return value === undefined
                ? `<td class="is-blank"></td>`
                : `<td class="${cellClass(value)}">${formatNumber(value)}</td>`;
            }).join("")}
            <td class="is-total-col"><strong>${formatNumber(level.total)}</strong></td>
          </tr>
        `).join("")}
      </tbody>
      <tfoot>
        <tr>
          <td class="is-sticky-col">รวม</td>
          ${pivot.columns.map((column) => `<td><strong>${formatNumber(pivot.columnTotals[column])}</strong></td>`).join("")}
          <td class="is-total-col"><strong>${formatNumber(pivot.grandTotal)}</strong></td>
        </tr>
      </tfoot>
    </table>
  `;
}

function renderOrderSuggestionTable() {
  renderSubjectTabs();
  renderOrderPivotInto(els.orderSuggestionTableWrap, lastOrderPlan);
  renderOrderPivotInto(els.orderCdSuggestionTableWrap, lastCdOrderPlan, {
    columnPrefix: "CD",
    emptyMessage: "วิชานี้ไม่มี CD"
  });
}

async function loadOrderSuggestion() {
  els.orderSuggestionTableWrap.innerHTML = `<div class="empty-state">กำลังคำนวณ...</div>`;
  els.orderCdSuggestionTableWrap.innerHTML = `<div class="empty-state">กำลังคำนวณ...</div>`;

  try {
    const stockData = await requestJson("/api/stock-summary");

    lastOrderPlan = computeOrderPlan((lastForecastData && lastForecastData.rows) || [], stockData);
    lastCdOrderPlan = computeCdOrderPlan((lastForecastData && lastForecastData.cdRows) || [], stockData);

    // activeSubjectCode is already set from the forecast run that unlocked
    // this button — reuse it so the order view opens on whichever subject
    // was showing, same tabs, same selection, no reset.
    renderOrderSuggestionTable();
  } catch (error) {
    els.orderSuggestionTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.orderCdSuggestionTableWrap.innerHTML = "";
  }
}

// Expect Stock reuses the exact same order plan (each row already carries
// expectedStock = currentStock - packetForecast + orderQty) — just a
// different value/coloring on the same pivot renderer.
function renderExpectedStockTable() {
  renderSubjectTabs();
  renderOrderPivotInto(els.expectedStockTableWrap, lastOrderPlan, {
    valueKey: "expectedStock",
    cellClass: expectedStockCellClass
  });
  renderOrderPivotInto(els.expectedStockCdTableWrap, lastCdOrderPlan, {
    columnPrefix: "CD",
    emptyMessage: "วิชานี้ไม่มี CD",
    valueKey: "expectedStock",
    cellClass: expectedStockCellClass
  });
}

async function loadExpectedStock() {
  els.expectedStockTableWrap.innerHTML = `<div class="empty-state">กำลังคำนวณ...</div>`;
  els.expectedStockCdTableWrap.innerHTML = `<div class="empty-state">กำลังคำนวณ...</div>`;

  try {
    const stockData = await requestJson("/api/stock-summary");

    lastOrderPlan = computeOrderPlan((lastForecastData && lastForecastData.rows) || [], stockData);
    lastCdOrderPlan = computeCdOrderPlan((lastForecastData && lastForecastData.cdRows) || [], stockData);

    const days = lastForecastData?.params?.days;

    els.expectedStockSubtitle.textContent = days
      ? `stock ที่มีอยู่ − Forecast ${days} วันที่จะใช้ + จำนวนที่แนะนำสั่ง = stock ที่เหลือ ถ้าสั่งตามนี้จริง`
      : `stock ที่มีอยู่ − Forecast ที่จะใช้ + จำนวนที่แนะนำสั่ง = stock ที่เหลือ ถ้าสั่งตามนี้จริง`;

    renderExpectedStockTable();
  } catch (error) {
    els.expectedStockTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.expectedStockCdTableWrap.innerHTML = "";
  }
}

async function generateForecast({ force = false } = {}) {
  const days = Number(els.forecastDays.value);

  els.forecastButton.disabled = true;
  els.recalculateForecastButton.disabled = true;
  setStatus(force ? "กำลังคำนวณ average ใหม่..." : "กำลัง Forecast...");
  els.forecastTableWrap.innerHTML = `<div class="empty-state">กำลังคำนวณ...</div>`;

  try {
    const params = new URLSearchParams({
      days: String(days),
      subject: "all",
      includeKc: "false",
      force: String(force)
    });
    const data = await requestJson(`/api/forecast?${params.toString()}`);

    lastForecastData = data;

    const subjects = getAvailableSubjects(data);

    if (!activeSubjectCode || !subjects.includes(activeSubjectCode)) {
      activeSubjectCode = subjects[0] || null;
    }

    renderActiveSubject();
    els.orderButton.disabled = false;
    els.orderButton.title = "";
    els.expectedStockButton.disabled = false;
    els.expectedStockButton.title = "";

    els.resultSubtitle.textContent = [
      `Forecast ${days} วัน`,
      "ทุกวิชา 100%",
      "ไม่รวม KC",
      `${data.summary.totalPrepareQty} ชุด`,
      `cache ${formatDateTime(data.cache.calculatedAt)}`
    ].join(" • ");
    setStatus(`${data.cache.cacheAction} • Forecast แล้ว`);
  } catch (error) {
    els.forecastTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.cdForecastTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.forecastSummary.innerHTML = "";
    els.resultSubtitle.textContent = "ยังไม่มีผลลัพธ์";
    setStatus(error.message, "error");
  } finally {
    els.forecastButton.disabled = false;
    els.recalculateForecastButton.disabled = false;
  }
}

// Excel export — 5 sheets per view (WS x ME/EFL/TRP, CD x EFL/TRP; ME has
// no CD). Reuses whatever pivot data is already computed for the screen —
// the exported numbers are exactly what's displayed, no separate calc path.
const WS_EXPORT_SUBJECTS = ["ME", "EFL", "TRP"];
const CD_EXPORT_SUBJECTS = ["EFL", "TRP"];

function pivotToSheetPayload(name, pivot) {
  return {
    name,
    columns: pivot.columns,
    rows: pivot.levels.map((level) => ({
      label: level.levelCode,
      values: level.values,
      total: level.total
    })),
    columnTotals: pivot.columnTotals,
    grandTotal: pivot.grandTotal
  };
}

// CD forecast rows have no packet breakdown (one number per level) — reuse
// buildOrderPivot with a synthetic single "packet" (1) so the CD sheet has
// the same Level/column/รวม shape as everything else.
function buildCdForecastPivot(cdRows, subjectCode) {
  const mapped = cdRows
    .filter((row) => row.subject === subjectCode)
    .map((row) => ({
      subjectId: row.subjectId,
      levelMasterId: row.levelMasterId,
      levelType: 1,
      level: row.level,
      packet: 1,
      qty: row.prepareQty
    }));

  return buildOrderPivot(mapped, "qty");
}

async function downloadWorkbook(filename, sheets) {
  const response = await fetch("/api/export/pivot-workbook", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename, sheets })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));

    throw new Error(data.error || "Export failed");
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `${filename}.xlsx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function runExport(button, filename, sheets) {
  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "⏳ กำลัง export...";

  try {
    await downloadWorkbook(filename, sheets);
  } catch (error) {
    alert(`Export ไม่สำเร็จ: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function exportForecastExcel() {
  const rows = (lastForecastData && lastForecastData.rows) || [];
  const cdRows = (lastForecastData && lastForecastData.cdRows) || [];
  const sheets = [
    ...WS_EXPORT_SUBJECTS.map((code) =>
      pivotToSheetPayload(`WS - ${code}`, buildWsPivot(rows.filter((row) => row.subject === code)))
    ),
    ...CD_EXPORT_SUBJECTS.map((code) =>
      pivotToSheetPayload(`CD - ${code}`, buildCdForecastPivot(cdRows, code))
    )
  ];

  runExport(els.exportForecastButton, "Forecast", sheets);
}

function exportOrderExcel() {
  const sheets = [
    ...WS_EXPORT_SUBJECTS.map((code) =>
      pivotToSheetPayload(`WS - ${code}`, buildOrderPivot(lastOrderPlan.filter((row) => row.subject === code)))
    ),
    ...CD_EXPORT_SUBJECTS.map((code) =>
      pivotToSheetPayload(`CD - ${code}`, buildOrderPivot(lastCdOrderPlan.filter((row) => row.subject === code)))
    )
  ];

  runExport(els.exportOrderButton, "Order", sheets);
}

function exportExpectedStockExcel() {
  const sheets = [
    ...WS_EXPORT_SUBJECTS.map((code) =>
      pivotToSheetPayload(
        `WS - ${code}`,
        buildOrderPivot(lastOrderPlan.filter((row) => row.subject === code), "expectedStock")
      )
    ),
    ...CD_EXPORT_SUBJECTS.map((code) =>
      pivotToSheetPayload(
        `CD - ${code}`,
        buildOrderPivot(lastCdOrderPlan.filter((row) => row.subject === code), "expectedStock")
      )
    )
  ];

  runExport(els.exportExpectedStockButton, "Expect Stock", sheets);
}

// One-way switch — once you commit to ordering, the forecast controls lock
// so nothing here (button, days, subject tabs) can quietly recompute the
// numbers you're about to order against. Refresh the page to forecast again.
// Lock everything that would recompute the forecast itself — the subject
// tabs stay live since every view reads them, they just switch which one
// re-renders.
function lockForecastControls() {
  els.forecastButton.disabled = true;
  els.forecastButton.title = "สั่งซื้อไปแล้ว — refresh หน้าใหม่ถ้าจะ Forecast อีกครั้ง";
  els.recalculateForecastButton.disabled = true;
  els.forecastDays.disabled = true;
}

function showOrderView() {
  currentView = "order";
  els.forecastResultsView.classList.add("hidden");
  els.expectedStockResultsView.classList.add("hidden");
  els.orderResultsView.classList.remove("hidden");

  lockForecastControls();
  loadOrderSuggestion();
}

function showExpectedStockView() {
  currentView = "expected";
  els.forecastResultsView.classList.add("hidden");
  els.orderResultsView.classList.add("hidden");
  els.expectedStockResultsView.classList.remove("hidden");

  lockForecastControls();
  loadExpectedStock();
}

els.forecastButton.addEventListener("click", () => generateForecast());
els.recalculateForecastButton.addEventListener("click", () => generateForecast({ force: true }));
els.orderButton.addEventListener("click", showOrderView);
els.expectedStockButton.addEventListener("click", showExpectedStockView);
els.exportForecastButton.addEventListener("click", exportForecastExcel);
els.exportOrderButton.addEventListener("click", exportOrderExcel);
els.exportExpectedStockButton.addEventListener("click", exportExpectedStockExcel);
els.forecastDetailClose.addEventListener("click", closeForecastDetail);
els.forecastDetailModal.addEventListener("click", (event) => {
  if (event.target === els.forecastDetailModal) {
    closeForecastDetail();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !els.forecastDetailModal.classList.contains("hidden")) {
    closeForecastDetail();
  }
});
