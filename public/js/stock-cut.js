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
  selectedDate: null
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
    >${escapeHtml(label)}</button>
  `).join("");
}

els.typeButtons.addEventListener("click", (event) => {
  const button = event.target.closest("[data-item-type]");

  if (!button || button.dataset.itemType === state.selectedItemType) {
    return;
  }

  state.selectedItemType = button.dataset.itemType;
  renderTypeButtons();
  loadPendingDates();
});

// ---- Pending dates list ----

async function loadPendingDates() {
  els.pendingSubtitle.textContent = "กำลังโหลด...";
  els.cutAllButton.disabled = true;
  els.pendingTableWrap.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;

  try {
    const data = await requestJson(`/api/stock-cut/pending-dates?type=${state.selectedItemType}`);

    state.pendingDates = data.rows || [];
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
  state.selectedDate = date;
  els.detailTitle.textContent = `รายละเอียดวันที่ ${formatDateDisplay(date)}`;
  els.detailSubtitle.textContent = state.selectedItemType.toUpperCase();
  els.detailBody.innerHTML = `<div class="empty-state">กำลังโหลด...</div>`;
  els.detailModal.classList.remove("hidden");

  try {
    const data = await requestJson(`/api/stock-cut/pending-dates/${date}?type=${state.selectedItemType}`);

    renderDetail(data.items || []);
  } catch (error) {
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

async function cutDates(dates) {
  try {
    const data = await requestJson("/api/stock-cut/process", {
      method: "POST",
      body: JSON.stringify({ type: state.selectedItemType, dates })
    });

    setStatus(`ตัด stock แล้ว ${data.itemsProcessed} รายการ (${data.recordsProcessed} record)`, "success");
    closeDetail();
    await loadPendingDates();
  } catch (error) {
    setStatus(error.message, "error");
  }
}

els.cutDayButton.addEventListener("click", () => {
  if (!state.selectedDate) {
    return;
  }

  if (!window.confirm(`ตัด stock ของวันที่ ${formatDateDisplay(state.selectedDate)} ใช่ไหม?`)) {
    return;
  }

  els.cutDayButton.disabled = true;
  cutDates([state.selectedDate]).finally(() => {
    els.cutDayButton.disabled = false;
  });
});

els.cutAllButton.addEventListener("click", () => {
  if (!state.pendingDates.length) {
    return;
  }

  if (!window.confirm(`ตัด stock ทั้งหมด ${state.pendingDates.length} วันใช่ไหม? รวม ${state.pendingDates.reduce((sum, row) => sum + row.totalQuantity, 0)} แผ่น/ชุด`)) {
    return;
  }

  els.cutAllButton.disabled = true;
  cutDates(state.pendingDates.map((row) => row.date));
});

// ---- Init ----

function init() {
  renderTypeButtons();
  loadPendingDates();
}

init();
