const els = {
  form: document.getElementById("scheduleForm"),
  weekdaySelect: document.getElementById("weekdaySelect"),
  addButton: document.getElementById("addScheduleButton"),
  formMessage: document.getElementById("formMessage"),
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

function setFormMessage(text, isSuccess = false) {
  if (!text) {
    els.formMessage.classList.add("hidden");
    return;
  }

  els.formMessage.textContent = text;
  els.formMessage.classList.remove("hidden");
  els.formMessage.classList.toggle("is-success", isSuccess);
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
    ? `ใช้อยู่ ${schedule.usageCount} enrollment`
    : "ยังไม่มี enrollment ใช้";
  const statusText = schedule.isActive ? "เปิด" : "ปิด";

  return `
    <div class="slot-item ${schedule.isActive ? "" : "is-inactive"}">
      <div>
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
  setFormMessage("");
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
    renderSummary(data.summary);
    renderWeekdays(data.schedulesByWeekday);
    setFormMessage("เพิ่มเวลาเปิดแล้ว", true);
    setStatus("บันทึกแล้ว");
  } catch (error) {
    setFormMessage(error.message);
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
    setFormMessage(isActive ? "เปิดเวลาเรียนแล้ว" : "ปิดเวลาเรียนแล้ว", true);
    setStatus("บันทึกแล้ว");
  } catch (error) {
    setFormMessage(error.message);
    setStatus(error.message, true);
    input.checked = !isActive;
    input.disabled = false;
  }
}

els.form.addEventListener("submit", addSchedule);
els.refreshButton.addEventListener("click", loadSchedules);

loadSchedules();
