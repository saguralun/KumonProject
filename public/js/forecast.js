const els = {
  forecastDays: document.getElementById("forecastDays"),
  forecastSubject: document.getElementById("forecastSubject"),
  forecastIncludeKc: document.getElementById("forecastIncludeKc"),
  forecastButton: document.getElementById("forecastButton"),
  recalculateForecastButton: document.getElementById("recalculateForecastButton"),
  statusLine: document.getElementById("statusLine"),
  resultSubtitle: document.getElementById("resultSubtitle"),
  forecastSummary: document.getElementById("forecastSummary"),
  forecastTableWrap: document.getElementById("forecastTableWrap")
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

function renderForecastSummary(data) {
  const summary = data.summary || {};
  const cache = data.cache || {};

  els.forecastSummary.innerHTML = `
    <div class="forecast-card">
      <span>Enrollment ที่คำนวณ</span>
      <strong>${formatNumber(summary.activeEnrollments)}</strong>
    </div>
    <div class="forecast-card">
      <span>ชุดที่ต้องเตรียม</span>
      <strong>${formatNumber(summary.forecastPackets)}</strong>
    </div>
    <div class="forecast-card">
      <span>จำนวนเตรียม</span>
      <strong>${formatNumber(summary.totalPrepareQty)}</strong>
    </div>
    <div class="forecast-card">
      <span>ประมาณ CPWS</span>
      <strong>${formatNumber(summary.totalEstimatedCpws, 1)}</strong>
    </div>
    <div class="forecast-card">
      <span>Average cache</span>
      <strong>${escapeHtml(cache.recalculated ? "คำนวณใหม่" : "พร้อมใช้")}</strong>
    </div>
  `;
}

function renderForecastTable(data) {
  const rows = data.rows || [];

  renderForecastSummary(data);

  if (!rows.length) {
    els.forecastTableWrap.innerHTML = `<div class="empty-state">ไม่มีรายการที่ต้องเตรียม หรือยังไม่มีค่าเฉลี่ยพอสำหรับ forecast</div>`;
    return;
  }

  els.forecastTableWrap.innerHTML = `
    <table class="forecast-table">
      <thead>
        <tr>
          <th>Subject</th>
          <th>Level</th>
          <th>Packet</th>
          <th>Label</th>
          <th>ต้องเตรียม</th>
          <th>ประมาณ CPWS</th>
          <th>เด็ก</th>
          <th>Avg Days</th>
          <th>Avg CPWS</th>
          <th>Source</th>
          <th>Sample เด็ก</th>
          <th>ตัวอย่างเด็ก</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${escapeHtml(row.subject)}</td>
            <td>${escapeHtml(row.level)}</td>
            <td>${escapeHtml(row.packet)}</td>
            <td>${escapeHtml(row.label)}</td>
            <td><strong>${escapeHtml(row.prepareQty)}</strong></td>
            <td>${escapeHtml(formatNumber(row.neededCpws, 2))}</td>
            <td>${escapeHtml(row.students)}</td>
            <td>${escapeHtml(formatNumber(row.avgDays, 2))}</td>
            <td>${escapeHtml(formatNumber(row.avgCpws, 2))}</td>
            <td><span class="source-badge ${row.avgSource === "ALL" ? "all" : ""}">${escapeHtml(row.avgSource)}</span></td>
            <td>${escapeHtml(row.avgStudentCount)}</td>
            <td>${escapeHtml((row.enrollments || []).map((item) =>
              `#${item.enrollmentId} ${item.nickname || item.name}${item.isKc ? " KC" : ""}`
            ).join(", "))}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function generateForecast({ force = false } = {}) {
  const days = Number(els.forecastDays.value);
  const subject = els.forecastSubject.value;
  const includeKc = els.forecastIncludeKc.checked;

  els.forecastButton.disabled = true;
  els.recalculateForecastButton.disabled = true;
  setStatus(force ? "กำลังคำนวณ average ใหม่..." : "กำลัง Forecast...");
  els.forecastTableWrap.innerHTML = `<div class="empty-state">กำลังคำนวณ...</div>`;

  try {
    const params = new URLSearchParams({
      days: String(days),
      subject,
      includeKc: String(includeKc),
      force: String(force)
    });
    const data = await requestJson(`/api/forecast?${params.toString()}`);

    renderForecastTable(data);
    els.resultSubtitle.textContent = [
      `Forecast ${days} วัน`,
      subject === "all" ? "ทุกวิชา" : subject,
      includeKc ? "รวม KC" : "ไม่รวม KC",
      `${data.summary.totalPrepareQty} ชุด`,
      `cache ${formatDateTime(data.cache.calculatedAt)}`
    ].join(" • ");
    setStatus(`${data.cache.cacheAction} • Forecast แล้ว`);
  } catch (error) {
    els.forecastTableWrap.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    els.forecastSummary.innerHTML = "";
    els.resultSubtitle.textContent = "ยังไม่มีผลลัพธ์";
    setStatus(error.message, "error");
  } finally {
    els.forecastButton.disabled = false;
    els.recalculateForecastButton.disabled = false;
  }
}

els.forecastButton.addEventListener("click", () => generateForecast());
els.recalculateForecastButton.addEventListener("click", () => generateForecast({ force: true }));
