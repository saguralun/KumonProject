const labels = { exact: "ตรงแน่นอน", review: "วันเกิดต่างกัน", ambiguous: "พบหลายคู่", conflict: "รหัสขัดแย้ง", unmatched: "ไม่พบคู่", invalid: "ข้อมูลไม่ครบ", matched: "มีรหัสตรงแล้ว" };

export function setupKsisMatching({ open, setStatus, onStateChange = () => {} }) {
  const get = (id) => document.getElementById(id);
  const read = get("ksisReadRoster"), selectExact = get("ksisSelectExact"), confirm = get("ksisConfirmMatches");
  const source = get("ksisMatchingSource"), filter = get("ksisMatchFilter"), search = get("ksisMatchSearch");
  const container = get("ksisMatchRows"), count = get("ksisMatchCount"), dialog = get("ksisMatchConfirmDialog");
  let preview = null, busy = false;
  const chosen = new Map();
  const candidate = (row) => row.candidates.find((item) => item.studentId === chosen.get(row.kumonId));
  const eligible = (row) => !["matched", "invalid"].includes(row.status) && row.candidates.some((item) => !item.conflict);
  const optionText = (item) => `#${item.studentId} ${item.name} • ${item.birthDate || "ไม่ระบุวันเกิด"}`;
  function render() {
    onStateChange({ busy });
    const rows = (preview?.rows || []).filter((row) => (filter.value === "all" || row.status === filter.value)
      && `${row.fullName} ${row.kumonId} ${row.candidates.map((item) => item.name).join(" ")}`.toLocaleLowerCase("th").includes(search.value.trim().toLocaleLowerCase("th")));
    const selected = [...chosen.values()].filter(Boolean).length;
    count.textContent = `แสดง ${rows.length} / ${preview?.rows.length || 0} คน • เลือก ${selected} คน`;
    confirm.textContent = `ยืนยันรหัสที่เลือก (${selected})`;
    confirm.disabled = busy || !preview?.previewId || !selected;
    selectExact.disabled = busy || !preview?.rows.some((row) => row.status === "exact");
    container.innerHTML = rows.length ? `<table class="matching-table"><thead><tr><th>เลือก</th><th>KSIS</th><th>วันเกิด KSIS</th><th>นักเรียนในโปรแกรม</th><th>รหัสเดิม / วิชา</th><th>ผลเทียบ</th></tr></thead><tbody>${rows.map((row) => {
      const index = preview.rows.indexOf(row);
      const local = candidate(row) || row.candidates[0];
      return `<tr><td><input type="checkbox" data-match-check="${index}" aria-label="เลือก ${escapeHtml(row.fullName)}" ${chosen.has(row.kumonId) ? "checked" : ""} ${!eligible(row) || busy ? "disabled" : ""}></td>
        <td><strong>${escapeHtml(row.fullName)}</strong><div class="subtle">${escapeHtml(row.kumonId)}</div></td><td>${escapeHtml(row.birthDate)}</td>
        <td>${row.candidates.length ? !eligible(row) ? escapeHtml(optionText(local)) : `<select data-match-choice="${index}" aria-label="คู่ของ ${escapeHtml(row.fullName)}" ${busy ? "disabled" : ""}><option value="">เลือกนักเรียน</option>${row.candidates.map((item) => `<option value="${item.studentId}" ${chosen.get(row.kumonId) === item.studentId ? "selected" : ""} ${item.conflict ? "disabled" : ""}>${escapeHtml(optionText(item))}</option>`).join("")}</select>` : "—"}</td>
        <td>${local?.enrollments.map((item) => `${escapeHtml(item.subject)}: ${escapeHtml(item.kumonId || "—")}`).join("<br>") || "—"}</td>
        <td><span class="match-state match-${row.status}">${labels[row.status]}</span></td></tr>`;
    }).join("")}</tbody></table>` : '<div class="empty-state">ไม่พบรายการ</div>';
  }
  get("ksisMatchingButton").addEventListener("click", open);
  read.addEventListener("click", async () => {
    if (busy) return;
    busy = true; read.disabled = true; chosen.clear(); preview = null; render();
    source.textContent = "กำลังอ่านรายชื่อทุกหน้าจาก KSIS...";
    try {
      const data = await requestJson("/api/students/ksis/matching/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (data.requiresLogin) {
        source.textContent = "กรุณาเข้าสู่ระบบ KSIS ที่เปิดไว้ แล้วกดอ่านรายชื่ออีกครั้ง";
        return;
      }
      preview = data;
      source.textContent = `${data.context || "KSIS Report B"} • อ่าน ${data.pagesRead} หน้า • ${data.rows.length} คน • ยังไม่บันทึก`;
      setStatus("อ่านรายชื่อแล้ว กรุณาตรวจคู่ก่อนยืนยัน");
    } catch (error) { source.textContent = error.message; setStatus(error.message, "error"); }
    finally { busy = false; read.disabled = false; render(); }
  });
  selectExact.addEventListener("click", () => {
    for (const row of preview.rows.filter((item) => item.status === "exact")) chosen.set(row.kumonId, row.candidates[0].studentId);
    render();
  });
  container.addEventListener("change", (event) => {
    if (busy) return;
    const input = event.target;
    const row = preview?.rows[Number(input.dataset.matchCheck ?? input.dataset.matchChoice)];
    if (!row) return;
    if (input.matches("[data-match-choice]")) {
      if (input.value) chosen.set(row.kumonId, Number(input.value)); else chosen.delete(row.kumonId);
    } else if (input.matches("[data-match-check]")) {
      if (!input.checked) chosen.delete(row.kumonId);
      else {
        const safe = row.candidates.filter((item) => !item.conflict);
        if (safe.length === 1) chosen.set(row.kumonId, safe[0].studentId);
        else setStatus("พบหลายคู่ กรุณาเลือกนักเรียนจากช่องรายการ", "error");
      }
    }
    render();
  });
  filter.addEventListener("change", render); search.addEventListener("input", render);
  confirm.addEventListener("click", () => {
    const ids = [...chosen.values()];
    if (new Set(ids).size !== ids.length) { setStatus("เลือกเด็กคนเดียวให้หลายรหัส กรุณาตรวจรายการ", "error"); return; }
    get("ksisMatchConfirmText").textContent = `บันทึกรหัสคุมองให้เด็ก ${ids.length} คนที่เลือกใช่ไหม?`;
    dialog.showModal();
  });
  get("ksisCancelConfirm").addEventListener("click", () => dialog.close());
  get("ksisSaveConfirm").addEventListener("click", async () => {
    if (busy || !preview?.previewId) return;
    dialog.close(); busy = true; read.disabled = true; render();
    try {
      const data = await requestJson("/api/students/ksis/matching/confirm", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ previewId: preview.previewId, selections: [...chosen].map(([kumonId, studentId]) => ({ kumonId, studentId })) }) });
      preview.previewId = null;
      for (const row of preview.rows.filter((item) => chosen.has(item.kumonId))) {
        const local = candidate(row);
        row.status = "matched";
        row.candidates = [local];
        for (const enrollment of local.enrollments) enrollment.kumonId = row.kumonId;
      }
      chosen.clear();
      source.textContent = `บันทึกรหัสแล้ว ${data.studentsUpdated} คน / ${data.enrollmentsUpdated} รายวิชา • ไม่ได้เปลี่ยนข้อมูลบน KSIS`;
      setStatus(source.textContent);
    } catch (error) { setStatus(error.message, "error"); }
    finally { busy = false; read.disabled = false; render(); }
  });
}
