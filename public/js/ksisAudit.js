const labels = { matched: "ตรงกัน", mismatch: "ไม่ตรงกัน", review: "ต้องตรวจ", missing_ksis: "ไม่พบใน KSIS", missing_report: "ไม่พบใน Report", skipped: "ข้าม A/OT" };
const classes = { matched: "match-exact", mismatch: "match-conflict", review: "match-review", missing_ksis: "match-conflict", missing_report: "match-review", skipped: "match-matched" };

export function setupKsisAudit({ shared, getPeriod, setStatus, onStateChange }) {
  const get = (id) => document.getElementById(id);
  const source = get("ksisAuditSource"), container = get("ksisAuditRows"), subject = get("ksisAuditSubject");
  const filter = get("ksisAuditFilter"), search = get("ksisAuditSearch");
  const text = (value) => escapeHtml(String(value ?? ""));
  let result = null, busy = false;
  function render() {
    const rows = (result?.rows || []).filter((row) => (filter.value === "all" || filter.value === "issues" && !["matched", "skipped"].includes(row.outcome) || filter.value === row.outcome)
      && `${row.name} ${row.kumonId} ${row.subject}`.toLocaleLowerCase("th").includes(search.value.trim().toLocaleLowerCase("th")));
    get("ksisAuditCount").textContent = result ? `แสดง ${rows.length} / ${result.rows.length} รายวิชา` : "";
    get("ksisAuditCounts").innerHTML = result ? Object.entries(labels).map(([key, label]) => `<span class="audit-total ${classes[key]}">${label} <strong>${result.counts[key] || 0}</strong></span>`).join("") : "";
    const field = (row, key) => {
      const changed = row.differences.some((item) => item.field === key);
      return `<td${changed ? ' class="audit-difference"' : ""}><span class="audit-value">${text(row.expected?.[key] ?? "—")}</span><span class="audit-value">${text(row.actual?.[key] ?? "—")}</span></td>`;
    };
    container.innerHTML = rows.length ? `<table class="matching-table audit-table"><thead><tr><th>นักเรียน / วิชา</th><th>แหล่งข้อมูล</th><th>ระดับ</th><th>หน้า</th><th>WS used</th><th>ST1</th><th>ผลตรวจ</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${text(row.name)}<div class="subtle">${text(row.matchMethod === 'name_birth_date' ? 'เทียบชื่อและวันเกิด • ' + row.birthDate : row.kumonId)} • ${text(row.subject)}${row.isKc ? " • KC" : ""}${row.page ? ` • หน้า ${row.page}` : ""}</div></td>
      <td><span class="audit-value">Report</span><span class="audit-value">KSIS</span></td>${["level", "worksheet", "used", "status"].map((key) => field(row, key)).join("")}
      <td><span class="match-state ${classes[row.outcome]}">${labels[row.outcome]}</span>${row.reason ? `<div class="audit-reason">${text(row.reason)}</div>` : ""}</td></tr>`).join("")}</tbody></table>`
      : `<div class="empty-state">${result ? "ไม่พบรายการตามตัวกรอง" : "ยังไม่มีผลตรวจ"}</div>`;
  }
  async function read(scope) {
    if (busy) return;
    busy = true; result = null; render(); onStateChange({ busy });
    for (const id of ["ksisAuditCurrent", "ksisAuditAll", "ksisAuditSubject"]) get(id).disabled = true;
    source.textContent = "กำลังอ่านข้อมูลที่บันทึกใหม่จาก KSIS และเทียบ Report...";
    setStatus("กำลังตรวจ WS ที่บันทึกจาก KSIS...");
    try {
      const data = await requestJson("/api/ksis/ws-audit", { method: "POST", body: JSON.stringify({ ...getPeriod(), scope, subject: subject.value }) });
      if (data.requiresLogin) {
        source.textContent = "กรุณาเข้าสู่ระบบ KSIS ที่เปิดไว้ แล้วกดตรวจอีกครั้ง";
        setStatus("กรุณาเข้าสู่ระบบ KSIS ก่อนตรวจ WS"); return;
      }
      result = data;
      source.textContent = `${data.context} • ${scope === "all" ? "ทุกหน้าตามตัวกรอง KSIS" : `หน้าที่เลือก ${data.originalPage}`} • อ่าน ${data.pagesRead} หน้า • ${data.period.month}/${data.period.year} • ${data.subject} • ตรวจเมื่อ ${new Date(data.verifiedAt).toLocaleString("th-TH")} • อ่านอย่างเดียว${data.outsidePage ? ` • นอกหน้าที่ตรวจ ${data.outsidePage} รายวิชา` : ""}${data.ignoredBlankRows ? ` • ไม่นับช่องวิชาว่าง ${data.ignoredBlankRows} แถว` : ""}${data.repeatedRows ? ` • รวมแถวเดิมที่แสดงซ้ำ ${data.repeatedRows} แถว` : ""}`;
      const issues = data.rows.filter((row) => !["matched", "skipped"].includes(row.outcome)).length;
      setStatus(`ตรวจ WS แล้ว • ตรง ${data.counts.matched} • ต้องตรวจ ${issues} รายวิชา`, issues ? "neutral" : "success");
    } catch (error) { source.textContent = error.message; setStatus(error.message, "error"); }
    finally {
      busy = false; for (const id of ["ksisAuditCurrent", "ksisAuditAll", "ksisAuditSubject"]) get(id).disabled = false;
      onStateChange({ busy }); render(); void shared?.refresh(true);
    }
  }
  get("ksisAuditCurrent").addEventListener("click", () => read("current"));
  get("ksisAuditAll").addEventListener("click", () => read("all"));
  filter.addEventListener("change", render); search.addEventListener("input", render);
  for (const element of [subject, get("reportMonth"), get("reportYear")]) element.addEventListener("change", () => {
    result = null; source.textContent = "เดือน/ปีหรือวิชาเปลี่ยน กรุณาตรวจใหม่"; render();
  });
  shared?.subscribe('audit', (state, workspace) => {
    result = state.result; busy = workspace.busy;
    if (state.subject) subject.value = state.subject;
    for (const id of ['ksisAuditCurrent', 'ksisAuditAll', 'ksisAuditSubject']) get(id).disabled = busy;
    source.textContent = state.error || (busy ? 'กำลังตรวจ WS...' : result ? `${result.context} • อ่าน ${result.pagesRead} หน้า • ตรวจเมื่อ ${new Date(result.verifiedAt).toLocaleString('th-TH')} • อ่านอย่างเดียว` : 'ยังไม่ได้ตรวจข้อมูล');
    onStateChange({ busy }); render();
  });
}
