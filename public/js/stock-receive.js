const els = {
  typeFilter: document.getElementById("typeFilter"),
  statusFilter: document.getElementById("statusFilter"),
  doSearch: document.getElementById("doSearch"),
  statusLine: document.getElementById("statusLine"),
  doForm: document.getElementById("doForm"),
  typeButtons: document.getElementById("typeButtons"),
  subjectButtons: document.getElementById("subjectButtons"),
  levelSelect: document.getElementById("levelSelect"),
  doItemsHeaderLabel: document.getElementById("doItemsHeaderLabel"),
  doItemsGrid: document.getElementById("doItemsGrid"),
  doItemsEmpty: document.getElementById("doItemsEmpty"),
  doTotal: document.getElementById("doTotal"),
  saveDoButton: document.getElementById("saveDoButton"),
  doListSubtitle: document.getElementById("doListSubtitle"),
  doTableWrap: document.getElementById("doTableWrap"),
  doDetailModal: document.getElementById("doDetailModal"),
  doDetailTitle: document.getElementById("doDetailTitle"),
  doDetailSubtitle: document.getElementById("doDetailSubtitle"),
  doDetailBody: document.getElementById("doDetailBody"),
  doDetailClose: document.getElementById("doDetailClose"),
  doProcessButton: document.getElementById("doProcessButton"),
  doDeleteButton: document.getElementById("doDeleteButton")
};

const ITEM_TYPES = [
  { type: "ws", label: "WS" },
  { type: "cd", label: "CD" }
];

const state = {
  masters: { subjects: [], levels: [], worksheets: [], cds: [] },
  selectedItemType: "ws",
  selectedSubjectId: null,
  selectedLevelMasterId: null,
  // masterId -> quantity string, as typed into the grid
  quantities: new Map(),
  selectedDoId: null,
  searchTimer: null,
  // Row count for the item grid, derived per-type from that type's own
  // largest level (e.g. 20 worksheets = 10 rows for WS; far fewer for CD)
  // so every level of the SAME type has same-sized boxes — a shorter level
  // (e.g. Zun's 10 worksheets) just leaves the second column blank.
  gridRowCount: 10
};

function selectInputText(input) {
  if (!input) {
    return;
  }

  input.select();
}

function bindSelectAllInput(input) {
  if (!input) {
    return;
  }

  input.addEventListener("focus", () => selectInputText(input));
  input.addEventListener("mousedown", (event) => {
    if (document.activeElement === input) {
      event.preventDefault();
      selectInputText(input);
    }
  });
  input.addEventListener("click", () => selectInputText(input));
}

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

function todayIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDateDisplay(dateText) {
  const value = String(dateText || "").slice(0, 10);
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value || "-";
  }

  return `${day}/${month}/${Number(year) + 543}`;
}

function typeBadgeHtml(type) {
  const code = String(type || "").toUpperCase();

  if (!code) {
    return "-";
  }

  return `<span class="type-badge type-${escapeHtml(type)}">${escapeHtml(code)}</span>`;
}

// ---- Master data helpers (type-aware: WS reads worksheets, CD reads cds) ----

function itemSourceForType(type) {
  return type === "cd" ? state.masters.cds : state.masters.worksheets;
}

// Which subjects actually have at least one item of this type (e.g. ME has
// no CDs at all — only EFL/TRP do).
function subjectsForType(type) {
  const source = itemSourceForType(type);
  const levelIdsWithItems = new Set(source.map((item) => item.levelMasterId));
  const subjectIdsWithItems = new Set(
    state.masters.levels
      .filter((level) => levelIdsWithItems.has(level.levelMasterId))
      .map((level) => level.subjectId)
  );

  return state.masters.subjects.filter((subject) => subjectIdsWithItems.has(subject.subjectId));
}

function levelsForSubject(subjectId) {
  const source = itemSourceForType(state.selectedItemType);
  const levelIdsWithItems = new Set(source.map((item) => item.levelMasterId));

  return state.masters.levels.filter((level) =>
    Number(level.subjectId) === Number(subjectId) && levelIdsWithItems.has(level.levelMasterId)
  );
}

// Normalizes worksheet/cd rows into a common {masterId, itemNo} shape.
function itemsForLevel(type, levelMasterId) {
  const source = itemSourceForType(type);

  return source
    .filter((item) => Number(item.levelMasterId) === Number(levelMasterId))
    .map((item) => ({
      masterId: type === "cd" ? item.cdMasterId : item.worksheetMasterId,
      itemNo: type === "cd" ? item.cdNo : item.worksheetNo
    }))
    .sort((a, b) => a.itemNo - b.itemNo);
}

// Largest item count across all levels of this type, halved into rows for
// the 2-column grid.
function computeMaxGridRowCount(type) {
  const source = itemSourceForType(type);
  const counts = new Map();

  source.forEach((item) => {
    counts.set(item.levelMasterId, (counts.get(item.levelMasterId) || 0) + 1);
  });

  const maxCount = Math.max(1, ...counts.values());

  return Math.ceil(maxCount / 2);
}

// ---- Type -> Subject -> Level -> quantity grid (one box per WS#/CD#,
// matching the legacy tool: pick a level and get every item in it at once;
// blank/0 boxes are simply left out of the DO on save). ----

function renderTypeButtons() {
  els.typeButtons.innerHTML = ITEM_TYPES.map(({ type, label }) => `
    <button
      type="button"
      class="subject-button ${type === state.selectedItemType ? "active" : ""}"
      data-item-type="${type}"
    >
      ${escapeHtml(label)}
    </button>
  `).join("");

  els.doItemsHeaderLabel.textContent = `จำนวนที่รับต่อ ${state.selectedItemType.toUpperCase()}`;
}

function renderSubjectButtons() {
  const subjects = subjectsForType(state.selectedItemType);

  els.subjectButtons.innerHTML = subjects.map((subject) => `
    <button
      type="button"
      class="subject-button ${Number(subject.subjectId) === Number(state.selectedSubjectId) ? "active" : ""}"
      data-subject-id="${subject.subjectId}"
    >
      ${escapeHtml(subject.subjectCode)}
    </button>
  `).join("");
}

function renderLevelOptions() {
  const levels = levelsForSubject(state.selectedSubjectId);

  els.levelSelect.innerHTML = `
    <option value="">- เลือก Level -</option>
    ${levels.map((level) => `
      <option value="${level.levelMasterId}" ${Number(level.levelMasterId) === Number(state.selectedLevelMasterId) ? "selected" : ""}>
        ${escapeHtml(level.levelCode)}
      </option>
    `).join("")}
  `;
}

function selectItemType(type) {
  if (type === state.selectedItemType) {
    return;
  }

  state.selectedItemType = type;
  state.gridRowCount = computeMaxGridRowCount(type);

  const subjects = subjectsForType(type);

  state.selectedSubjectId = subjects[0]?.subjectId ?? null;
  state.selectedLevelMasterId = null;
  state.quantities.clear();

  renderTypeButtons();
  renderSubjectButtons();
  renderLevelOptions();
  renderItemsGrid();
}

function selectSubject(subjectId) {
  state.selectedSubjectId = subjectId;
  state.selectedLevelMasterId = null;
  state.quantities.clear();
  renderSubjectButtons();
  renderLevelOptions();
  renderItemsGrid();
}

function selectLevel(levelMasterId) {
  state.selectedLevelMasterId = levelMasterId || null;
  state.quantities.clear();
  renderItemsGrid();
}

function renderItemsGrid() {
  const items = state.selectedLevelMasterId
    ? itemsForLevel(state.selectedItemType, state.selectedLevelMasterId)
    : [];
  const level = state.masters.levels.find((item) => Number(item.levelMasterId) === Number(state.selectedLevelMasterId));

  els.doItemsEmpty.classList.toggle("hidden", items.length > 0);
  els.doItemsGrid.classList.toggle("hidden", items.length === 0);

  // Column-major layout: fill the left column top-to-bottom first, then the
  // right column, sized to exactly fill the card height with no scrolling.
  // Row count is fixed per type (not derived from this level's own count)
  // so every level of the same type has same-sized boxes — a short level
  // just leaves its second column blank.
  els.doItemsGrid.style.gridTemplateRows = `repeat(${state.gridRowCount}, minmax(0, 1fr))`;

  // Halfway divider within each column (e.g. after row 5 of 10) so users
  // don't lose their place and mistype into the wrong box.
  const halfRow = Math.ceil(state.gridRowCount / 2);
  const labelPrefix = state.selectedItemType === "cd" ? "CD" : "";

  els.doItemsGrid.innerHTML = items.map((item, index) => {
    const isHalfway = state.gridRowCount > 1 && (index % state.gridRowCount) === halfRow;

    return `
    <label class="do-item-cell ${isHalfway ? "do-item-cell-halfway" : ""}">
      <span>${escapeHtml(level?.levelCode || "")}${labelPrefix}${item.itemNo}</span>
      <input
        type="number"
        min="0"
        step="1"
        inputmode="numeric"
        data-master-id="${item.masterId}"
        value="${escapeHtml(state.quantities.get(item.masterId) || "")}"
        placeholder="0"
      >
    </label>
  `;
  }).join("");

  updateTotals();
}

function updateTotals() {
  const entries = [...state.quantities.entries()].filter(([, value]) => Number(value) > 0);
  const totalQty = entries.reduce((sum, [, value]) => sum + Number(value), 0);

  els.doTotal.textContent = `รวม ${entries.length} รายการ • ${totalQty} ชุด`;
  els.saveDoButton.disabled = entries.length === 0;
}

els.typeButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-item-type]");

  if (button) {
    selectItemType(button.dataset.itemType);
  }
});

els.subjectButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-subject-id]");

  if (button) {
    selectSubject(Number(button.dataset.subjectId));
  }
});

els.levelSelect.addEventListener("change", () => {
  selectLevel(els.levelSelect.value ? Number(els.levelSelect.value) : null);
});

els.doItemsGrid.addEventListener("input", (event) => {
  const masterId = event.target.dataset.masterId;

  if (!masterId) {
    return;
  }

  const value = event.target.value.trim();

  if (value) {
    state.quantities.set(Number(masterId), value);
  } else {
    state.quantities.delete(Number(masterId));
  }

  event.target.classList.toggle("has-value", Number(value) > 0);
  updateTotals();
});

// ---- DO form submit ----

els.doForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(els.doForm);
  const items = [...state.quantities.entries()]
    .filter(([, value]) => Number(value) > 0)
    .map(([masterId, value]) => ({ masterId, quantity: Number(value) }));

  if (!items.length) {
    setStatus("กรุณาเพิ่มรายการที่ถูกต้องอย่างน้อย 1 รายการ", "error");
    return;
  }

  els.saveDoButton.disabled = true;
  setStatus("กำลังบันทึก...");

  try {
    const data = await requestJson("/api/stock-receive/dos", {
      method: "POST",
      body: JSON.stringify({
        type: state.selectedItemType,
        doNo: formData.get("doNo"),
        outDate: formData.get("outDate"),
        receiveDate: formData.get("receiveDate"),
        items
      })
    });

    setStatus(`บันทึก DO ${data.doNo} แล้ว รอ Process เข้า stock`, "success");
    resetForm();
    await loadDeliveryOrders();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    updateTotals();
  }
});

function resetForm() {
  els.doForm.reset();
  setDefaultDates();
  state.selectedLevelMasterId = null;
  state.quantities.clear();
  els.levelSelect.value = "";
  renderItemsGrid();
}

function setDefaultDates() {
  const today = todayIsoDate();

  els.doForm.elements.outDate.value = today;
  els.doForm.elements.receiveDate.value = today;
}

// ---- DO list ----

function statusPillHtml(row) {
  return row.isStockProcessed
    ? `<span class="status-pill is-processed">Processed</span>`
    : `<span class="status-pill is-pending">รอ Process</span>`;
}

function renderDoTable(rows) {
  if (!rows.length) {
    els.doTableWrap.innerHTML = `<div class="empty-state">ไม่พบ DO ในเงื่อนไขนี้</div>`;
    return;
  }

  els.doTableWrap.innerHTML = `
    <table class="do-table">
      <thead>
        <tr>
          <th>ประเภท</th>
          <th>สถานะ</th>
          <th>เลข DO</th>
          <th>วันที่รับ</th>
          <th>รายการ</th>
          <th>รวมชุด</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr data-do-id="${row.doId}">
            <td>${typeBadgeHtml(row.type)}</td>
            <td>${statusPillHtml(row)}</td>
            <td><strong>${escapeHtml(row.doNo)}</strong></td>
            <td>${escapeHtml(formatDateDisplay(row.receiveDate))}</td>
            <td>${row.itemCount}</td>
            <td>${row.totalQuantity}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function loadDeliveryOrders() {
  const params = new URLSearchParams({
    type: els.typeFilter.value,
    status: els.statusFilter.value,
    query: els.doSearch.value.trim(),
    limit: "300"
  });

  els.doListSubtitle.textContent = "กำลังโหลด...";

  try {
    const data = await requestJson(`/api/stock-receive/dos?${params.toString()}`);

    renderDoTable(data.rows);
    els.doListSubtitle.textContent = `แสดง ${data.rows.length} รายการ`;
  } catch (error) {
    els.doTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.doListSubtitle.textContent = "โหลดไม่สำเร็จ";
  }
}

els.doTableWrap.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-do-id]");

  if (row) {
    openDoDetail(Number(row.dataset.doId));
  }
});

els.typeFilter.addEventListener("change", loadDeliveryOrders);
els.statusFilter.addEventListener("change", loadDeliveryOrders);
els.doSearch.addEventListener("input", () => {
  clearTimeout(state.searchTimer);
  state.searchTimer = setTimeout(loadDeliveryOrders, 180);
});

// ---- DO detail modal ----

async function openDoDetail(doId) {
  state.selectedDoId = doId;

  try {
    const data = await requestJson(`/api/stock-receive/dos/${doId}`);
    const deliveryOrder = data.deliveryOrder;

    els.doDetailTitle.textContent = `DO ${deliveryOrder.doNo}`;
    els.doDetailSubtitle.textContent = deliveryOrder.isStockProcessed
      ? "Process เข้า stock แล้ว"
      : "ยังไม่ได้ Process เข้า stock";
    els.doDetailBody.innerHTML = `
      <div class="do-detail-meta">
        <div><span>ประเภท</span>${typeBadgeHtml(deliveryOrder.type)}</div>
        <div><span>Out Date</span>${escapeHtml(formatDateDisplay(deliveryOrder.outDate))}</div>
        <div><span>Receive Date</span>${escapeHtml(formatDateDisplay(deliveryOrder.receiveDate))}</div>
        <div><span>รอบบิล</span>${deliveryOrder.receiveMonth}/${deliveryOrder.receiveYear}</div>
        <div><span>รวม</span>${deliveryOrder.itemCount} รายการ • ${deliveryOrder.totalQuantity} ชุด</div>
      </div>
      <div class="do-detail-items">
        <table>
          <thead>
            <tr><th>ประเภท</th><th>วิชา</th><th>Level</th><th>เลข</th><th>จำนวน</th></tr>
          </thead>
          <tbody>
            ${deliveryOrder.items.map((item) => `
              <tr>
                <td>${typeBadgeHtml(item.type)}</td>
                <td>${escapeHtml(item.subjectCode)}</td>
                <td>${escapeHtml(item.levelCode)}</td>
                <td>${item.itemNo}</td>
                <td>${item.quantity}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;

    els.doProcessButton.classList.toggle("hidden", deliveryOrder.isStockProcessed);
    els.doDeleteButton.classList.toggle("hidden", deliveryOrder.isStockProcessed);
    els.doDetailModal.classList.remove("hidden");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function closeDoDetail() {
  els.doDetailModal.classList.add("hidden");
  state.selectedDoId = null;
}

els.doDetailClose.addEventListener("click", closeDoDetail);
els.doDetailModal.addEventListener("mousedown", (event) => {
  if (event.target === els.doDetailModal) {
    closeDoDetail();
  }
});

els.doProcessButton.addEventListener("click", async () => {
  if (!state.selectedDoId) {
    return;
  }

  if (!window.confirm("Process DO นี้เข้า stock จริงใช่ไหม? บวกจำนวนเข้า stock.quantity ทันที")) {
    return;
  }

  els.doProcessButton.disabled = true;

  try {
    const data = await requestJson(`/api/stock-receive/dos/${state.selectedDoId}/process`, { method: "POST" });

    setStatus(`Process DO ${data.doNo} เข้า stock แล้ว (${data.itemsProcessed} รายการ)`, "success");
    closeDoDetail();
    await loadDeliveryOrders();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.doProcessButton.disabled = false;
  }
});

els.doDeleteButton.addEventListener("click", async () => {
  if (!state.selectedDoId) {
    return;
  }

  if (!window.confirm("ลบ DO นี้ใช่ไหม? ลบได้เฉพาะ DO ที่ยังไม่ได้ Process")) {
    return;
  }

  els.doDeleteButton.disabled = true;

  try {
    await requestJson(`/api/stock-receive/dos/${state.selectedDoId}`, { method: "DELETE" });
    setStatus("ลบ DO แล้ว", "success");
    closeDoDetail();
    await loadDeliveryOrders();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    els.doDeleteButton.disabled = false;
  }
});

// ---- Init ----

async function init() {
  bindSelectAllInput(els.doSearch);
  bindSelectAllInput(els.doForm.elements.doNo);
  setDefaultDates();

  try {
    const data = await requestJson("/api/stock-receive/masters");

    state.masters = data.masters;
    state.gridRowCount = computeMaxGridRowCount(state.selectedItemType);

    const subjects = subjectsForType(state.selectedItemType);

    state.selectedSubjectId = subjects[0]?.subjectId ?? null;
    renderTypeButtons();
    renderSubjectButtons();
    renderLevelOptions();
    renderItemsGrid();
  } catch (error) {
    setStatus(error.message, "error");
  }

  await loadDeliveryOrders();
}

init();
