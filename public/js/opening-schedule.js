const els = {
  form: document.getElementById("scheduleForm"),
  weekdaySelect: document.getElementById("weekdaySelect"),
  startTime: document.getElementById("startTime"),
  durationSelect: document.getElementById("durationSelect"),
  endTime: document.getElementById("endTime"),
  addButton: document.getElementById("addScheduleButton"),
  statusLine: document.getElementById("statusLine"),
  weekdayCount: document.getElementById("weekdayCount"),
  slotCount: document.getElementById("slotCount"),
  activeCount: document.getElementById("activeCount"),
  inactiveCount: document.getElementById("inactiveCount"),
  listSubtitle: document.getElementById("listSubtitle"),
  weekdayGrid: document.getElementById("weekdayGrid"),
  refreshButton: document.getElementById("refreshButton")
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.error || "เกิดข้อผิดพลาด");
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(text, isError = false) {
  els.statusLine.textContent = text;
  els.statusLine.classList.toggle("is-error", isError);
}

// เวลาจบ = เวลาเริ่ม + ช่วงเวลา (30 / 60 นาที) คำนวณให้อัตโนมัติ ผู้ใช้แก้เองไม่ได้
function syncEndTime() {
  const start = els.startTime.value;

  if (!start) {
    els.endTime.value = "";
    return;
  }

  const [hours, minutes] = start.split(":").map(Number);
  const total = Math.min(hours * 60 + minutes + Number(els.durationSelect.value), 24 * 60 - 1);
  const endHours = String(Math.floor(total / 60)).padStart(2, "0");
  const endMinutes = String(total % 60).padStart(2, "0");

  els.endTime.value = `${endHours}:${endMinutes}`;
}

function renderWeekdayOptions(weekdays) {
  els.weekdaySelect.innerHTML = weekdays
    .map((weekday) => `<option value="${weekday.id}">${escapeHtml(weekday.name)} (${escapeHtml(weekday.code)})</option>`)
    .join("");
}

function renderSummary(summary) {
  els.weekdayCount.textContent = summary.weekdays;
  els.slotCount.textContent = summary.slots;
  els.activeCount.textContent = summary.activeSlots;
  els.inactiveCount.textContent = summary.inactiveSlots;
  els.listSubtitle.textContent = `${summary.slots} เวลาเปิด • เปิด ${summary.activeSlots} • ปิด ${summary.inactiveSlots}`;
}

function renderSlot(schedule) {
  const usageText = schedule.usageCount > 0
    ? `${schedule.usageCount} ID`
    : "ยังไม่มี ID";
  const statusText = schedule.isActive ? "เปิด" : "ปิด";
  const deleteButton = schedule.usageCount > 0
    ? ""
    : `<button type="button" class="slot-delete" data-delete-id="${schedule.id}" title="ลบเวลาเปิดนี้" aria-label="ลบเวลาเปิดนี้">✕</button>`;

  return `
    <div class="slot-item ${schedule.isActive ? "" : "is-inactive"}">
      ${deleteButton}
      <div class="slot-body">
        <div class="slot-time">${escapeHtml(schedule.startTime)}-${escapeHtml(schedule.endTime)}</div>
        <div class="slot-meta ${schedule.usageCount > 0 ? "is-used" : ""}">
          ${escapeHtml(statusText)} • ${escapeHtml(usageText)}
        </div>
      </div>
      <label class="switch" title="${escapeHtml(schedule.isActive ? "ปิดเวลาเปิดนี้" : "เปิดเวลาเปิดนี้")}">
        <input type="checkbox" data-toggle-id="${schedule.id}" ${schedule.isActive ? "checked" : ""}>
        <span></span>
      </label>
    </div>
  `;
}

function renderWeekdays(groups) {
  els.weekdayGrid.innerHTML = groups.map((group) => `
    <section class="weekday-card">
      <div class="weekday-card-header">
        <div class="weekday-name">${escapeHtml(group.weekdayName)}</div>
        <div class="weekday-code">${escapeHtml(group.weekdayCode)}</div>
      </div>
      <div class="slot-list">
        ${group.schedules.length
          ? group.schedules.map(renderSlot).join("")
          : `<div class="empty-day">ยังไม่มีเวลาเปิด</div>`}
      </div>
    </section>
  `).join("");

  els.weekdayGrid.querySelectorAll("[data-toggle-id]").forEach((input) => {
    input.addEventListener("change", () => toggleSchedule(input));
  });

  els.weekdayGrid.querySelectorAll("[data-delete-id]").forEach((button) => {
    button.addEventListener("click", () => deleteSchedule(button));
  });
}

async function loadSchedules() {
  setStatus("กำลังโหลด...");

  try {
    const data = await requestJson("/api/system/opening-schedules");
    renderWeekdayOptions(data.weekdays);
    renderSummary(data.summary);
    renderWeekdays(data.schedulesByWeekday);
    setStatus("พร้อมใช้งาน");
  } catch (error) {
    setStatus(error.message, true);
    els.weekdayGrid.innerHTML = `<div class="empty-day">${escapeHtml(error.message)}</div>`;
  }
}

async function addSchedule(event) {
  event.preventDefault();
  els.addButton.disabled = true;

  try {
    const formData = new FormData(els.form);
    const data = await requestJson("/api/system/opening-schedules", {
      method: "POST",
      body: JSON.stringify({
        weekdayId: formData.get("weekdayId"),
        startTime: formData.get("startTime"),
        endTime: formData.get("endTime")
      })
    });

    els.form.reset();
    syncEndTime();
    renderSummary(data.summary);
    renderWeekdays(data.schedulesByWeekday);
    setStatus("เพิ่มเวลาเปิดแล้ว");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    els.addButton.disabled = false;
  }
}

async function toggleSchedule(input) {
  const scheduleId = input.dataset.toggleId;
  const isActive = input.checked;

  input.disabled = true;

  try {
    const data = await requestJson(`/api/system/opening-schedules/${scheduleId}/active`, {
      method: "POST",
      body: JSON.stringify({ isActive })
    });

    renderSummary(data.summary);
    renderWeekdays(data.schedulesByWeekday);
    setStatus(isActive ? "เปิดเวลาเรียนแล้ว" : "ปิดเวลาเรียนแล้ว");
  } catch (error) {
    setStatus(error.message, true);
    input.checked = !isActive;
    input.disabled = false;
  }
}

async function deleteSchedule(button) {
  const scheduleId = button.dataset.deleteId;

  if (!window.confirm("ลบเวลาเปิดนี้? (ยังไม่มี ID ผูกอยู่)")) {
    return;
  }

  button.disabled = true;

  try {
    const data = await requestJson(`/api/system/opening-schedules/${scheduleId}`, {
      method: "DELETE"
    });

    renderSummary(data.summary);
    renderWeekdays(data.schedulesByWeekday);
    setStatus("ลบเวลาเปิดแล้ว");
  } catch (error) {
    setStatus(error.message, true);
    button.disabled = false;
  }
}

els.form.addEventListener("submit", addSchedule);
els.startTime.addEventListener("input", syncEndTime);
els.durationSelect.addEventListener("change", syncEndTime);
els.refreshButton.addEventListener("click", loadSchedules);

loadSchedules();
