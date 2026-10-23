const els = {
  typeButtons: document.getElementById("typeButtons"),
  statusLine: document.getElementById("statusLine"),
  pendingSubtitle: document.getElementById("pendingSubtitle"),
  pendingTableWrap: document.getElementById("pendingTableWrap"),
  cutAllButton: document.getElementById("cutAllButton"),
  detailModal: document.getElementById("detailModal"),
  detailTitle: document.getElementById("detailTitle"),
  detailSubtitle: document.getElementById("detailSubtitle"),
  detailBody: document.getElementById("detailBody"),
  detailClose: document.getElementById("detailClose"),
  cutDayButton: document.getElementById("cutDayButton")
};

const ITEM_TYPES = [
  { type: "ws", label: "WS" },
  { type: "cd", label: "CD" }
];

const state = {
  selectedItemType: "ws",
  pendingDates: [],
  selectedDate: null,
  cutting: false,
  pendingRequest: 0,
  pendingLoaded: false,
  detailRequest: 0
};

const setStatus = createStatusSetter(els.statusLine);

function formatDateDisplay(dateText) {
  const value = String(dateText || "").slice(0, 10);
  const [year, month, day] = value.split("-");

  if (!year || !month || !day) {
    return value || "-";
  }

  return `${day}/${month}/${Number(year) + 543}`;
}

// ---- Type toggle ----

function renderTypeButtons() {
  els.typeButtons.innerHTML = ITEM_TYPES.map(({ type, label }) => `
    <button
      type="button"
      class="subject-button ${type === state.selectedItemType ? "active" : ""}"
      data-item-type="${type}"
      ${state.cutting ? 'disabled' : ''}
    >${escapeHtml(label)}</button>
  `).join("");
}

els.typeButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-item-type]");

  if (!button || state.cutting || button.dataset.itemType === state.selectedItemType) {
    return;
  }

  state.selectedItemType = button.dataset.itemType;
  closeDetail();
  renderTypeButtons();
  loadPendingDates();
});

// ---- Pending dates list ----

async function loadPendingDates() {
  const requestId = ++state.pendingRequest, type = state.selectedItemType;
  state.pendingLoaded = false;
  els.pendingSubtitle.textContent = "กำลังโหลด...";
  els.cutAllButton.disabled = true;
  els.pendingTableWrap.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;

  try {
    const data = await requestJson(`/api/stock-cut/pending-dates?type=${type}`);
    if (requestId !== state.pendingRequest || type !== state.selectedItemType) return;

    state.pendingDates = data.rows || [];
    state.pendingLoaded = true;
    renderPendingTable();

    if (!state.pendingDates.length) {
      els.pendingSubtitle.textContent = "ไม่มีรายการค้างตัด stock";
      return;
    }

    const totalItems = state.pendingDates.reduce((sum, row) => sum + row.itemCount, 0);
    const totalQuantity = state.pendingDates.reduce((sum, row) => sum + row.totalQuantity, 0);

    els.pendingSubtitle.textContent = `${state.pendingDates.length} วัน • ${totalItems} รายการ • ${totalQuantity} แผ่น/ชุด`;
    els.cutAllButton.disabled = false;
  } catch (error) {
    if (requestId !== state.pendingRequest || type !== state.selectedItemType) return;
    els.pendingTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    setStatus(error.message, "error");
  }
}

function renderPendingTable() {
  if (!state.pendingDates.length) {
    els.pendingTableWrap.innerHTML = `<div class="empty-state">ไม่มีรายการค้างตัด stock — เก็บครบแล้ว</div>`;
    return;
  }

  els.pendingTableWrap.innerHTML = `
    <table class="do-table">
      <thead>
        <tr>
          <th>วันที่</th>
          <th>รายการ</th>
          <th>จำนวนที่ใช้</th>
        </tr>
      </thead>
      <tbody>
        ${state.pendingDates.map((row) => `
          <tr data-date="${escapeHtml(row.date)}">
            <td><strong>${escapeHtml(formatDateDisplay(row.date))}</strong></td>
            <td>${row.itemCount}</td>
            <td>${row.totalQuantity}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

els.pendingTableWrap.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-date]");

  if (row) {
    openDetail(row.dataset.date);
  }
});

// ---- Detail modal ----

async function openDetail(date) {
  const requestId = ++state.detailRequest, type = state.selectedItemType;
  state.selectedDate = date;
  els.detailTitle.textContent = `รายละเอียดวันที่ ${formatDateDisplay(date)}`;
  els.detailSubtitle.textContent = state.selectedItemType.toUpperCase();
  els.detailBody.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;
  els.detailModal.classList.remove("hidden");
  els.cutDayButton.disabled = true;

  try {
    const data = await requestJson(`/api/stock-cut/pending-dates/${date}?type=${type}`);
    if (requestId !== state.detailRequest || type !== state.selectedItemType || date !== state.selectedDate) return;

    renderDetail(data.items || []);
    els.cutDayButton.disabled = state.cutting || !data.items?.length;
  } catch (error) {
    if (requestId !== state.detailRequest || type !== state.selectedItemType || date !== state.selectedDate) return;
    els.detailBody.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  }
}

function renderDetail(items) {
  if (!items.length) {
    els.detailBody.innerHTML = `<div class="empty-state">ไม่มีรายการแล้ว (อาจถูกตัดไปจากที่อื่นแล้ว)</div>`;
    return;
  }

  els.detailBody.innerHTML = `
    <div class="do-detail-items">
      <table>
        <thead>
          <tr>
            <th>วิชา</th><th>Level</th><th>เลข</th><th>ใช้ไป</th><th>Stock ตอนนี้</th><th>เหลือหลังตัด</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
            <tr class="${item.resultingStock < 0 ? "is-negative-stock" : ""}">
              <td>${escapeHtml(item.subjectCode)}</td>
              <td>${escapeHtml(item.levelCode)}</td>
              <td>${escapeHtml(item.itemNo)}</td>
              <td>${item.quantity}</td>
              <td>${item.currentStock}</td>
              <td>${item.resultingStock}${item.resultingStock < 0 ? " ⚠️" : ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function closeDetail() {
  state.detailRequest++;
  els.detailModal.classList.add("hidden");
  state.selectedDate = null;
}

els.detailClose.addEventListener("click", closeDetail);
els.detailModal.addEventListener("mousedown", (event) => {
  if (event.target === els.detailModal) {
    closeDetail();
  }
});

// ---- Cutting ----

async function cutDates(dates, type) {
  if (state.cutting) return;
  state.cutting = true; els.cutDayButton.disabled = els.cutAllButton.disabled = true; renderTypeButtons();
  try {
    const data = await requestJson("/api/stock-cut/process", {
      method: "POST",
      body: JSON.stringify({ type, dates })
    });

    setStatus(`ตัด stock แล้ว ${data.itemsProcessed} รายการ (${data.recordsProcessed} record)`, "success");
    closeDetail();
    await loadPendingDates();
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    state.cutting = false; renderTypeButtons();
    els.cutAllButton.disabled = !state.pendingLoaded || state.pendingDates.length === 0;
    els.cutDayButton.disabled = !state.selectedDate;
  }
}

els.cutDayButton.addEventListener("click", async () => {
  if (state.cutting || !state.selectedDate) {
    return;
  }

  const date = state.selectedDate, type = state.selectedItemType;
  if (!await confirmAction(`ตัด stock ของวันที่ ${formatDateDisplay(date)} ใช่ไหม?`)) {
    return;
  }

  await cutDates([date], type);
});

els.cutAllButton.addEventListener("click", async () => {
  if (state.cutting || !state.pendingDates.length) {
    return;
  }

  const dates = state.pendingDates.map(row => row.date), type = state.selectedItemType;
  if (!await confirmAction(`ตัด stock ทั้งหมด ${dates.length} วันใช่ไหม? รวม ${state.pendingDates.reduce((sum, row) => sum + row.totalQuantity, 0)} แผ่น/ชุด`)) {
    return;
  }

  await cutDates(dates, type);
});

// ---- Init ----

function init() {
  renderTypeButtons();
  loadPendingDates();
}

init();
