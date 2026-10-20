export function setupKsisDraft({ open, setStatus, getPeriod }) {
  const get = (id) => document.getElementById(id);
  const read = get("ksisDraftPreview"), fill = get("ksisDraftFill"), acknowledge = get("ksisDraftAcknowledge");
  const subject = get("ksisDraftSubject"), source = get("ksisDraftSource"), container = get("ksisDraftRows"), dialog = get("ksisDraftDialog");
  let preview = null, busy = false, pending = false, generation = 0;
  const call = (action, data) => requestJson(`/api/report/ksis-draft/${action}`, { method: "POST", body: JSON.stringify(data) });
  const text = (value) => escapeHtml(String(value ?? ""));
  const subjectLabel = (value) => value === "ALL" ? "ทุกวิชา (ME / EFL / TRP)" : value;
  function buttons() {
    read.disabled = busy || pending; subject.disabled = busy || pending;
    fill.disabled = busy || pending || !preview?.rows.some((row) => row.ready);
    acknowledge.classList.toggle("hidden", !pending); acknowledge.disabled = busy;
  }
  function render() {
    const rows = preview?.rows.filter((row) => row.before) || [];
    container.innerHTML = rows.length ? `<table class="matching-table"><thead><tr><th>นักเรียน / รหัสคุมอง</th><th>ระดับ / หน้า</th><th>WS ที่ใช้</th><th>ST1</th><th>Zun Zun</th><th>AT</th><th>ผลตรวจ</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${text(row.name)}<div class="subtle">${text(row.kumonId)} • ${text(row.subject)}</div></td>
      <td>${text(row.before.level.value)} ${text(row.before.worksheet.value)} → ${text(row.desired.level || "คงเดิม")} ${text(row.desired.worksheet ?? "")}</td>
      <td>${text(row.before.used.value)} → ${text(row.desired.used)}</td><td>${text(row.before.status.value)} → ${text(row.desired.status)}</td>
      <td>${row.desired.zun.map((zun) => `${text(zun.level)} ${text(zun.worksheet)} • ${text(zun.used)} ชุด`).join("<br>") || "—"}</td>
      <td>${(row.desired.at || []).map((test) => `${text(test.date?.split("-").reverse().join("/"))} • ${text(test.level)}<br>${text(test.time)} นาที • ${text(test.score)} คะแนน • G${text(test.group)} • ผ่าน`).join("<br>") || "—"}</td>
      <td><span class="match-state ${row.ready ? "match-exact" : "match-conflict"}">${row.ready ? "พร้อมกรอก" : text(row.reason)}</span></td></tr>`).join("")}</tbody></table>` : `<div class="empty-state">${preview && !preview.rows.length ? "ไม่มีรายการใน Report ของเดือนและวิชาที่เลือก (รายชื่อมาจากบิลหรือประวัติสถานะของเดือนนั้น)" : "ไม่มีข้อมูลตรงกับหน้า KSIS ปัจจุบัน"}</div>`;
    buttons();
  }
  get("ksisDraftButton").addEventListener("click", open);
  read.addEventListener("click", async () => {
    if (busy || pending) return;
    const requestId = ++generation;
    busy = true; preview = null; buttons();
    source.textContent = "กำลังอ่าน Report และหน้า KSIS ปัจจุบัน...";
    try {
      const data = await call("preview", { ...getPeriod(), subject: subject.value });
      if (requestId !== generation) return;
      if (data.requiresLogin) { source.textContent = "กรุณาเข้าสู่ระบบใน Chrome ที่โปรแกรมเปิด แล้วกดเตรียมข้อมูลอีกครั้ง"; return; }
      preview = data;
      source.textContent = `${data.context} • หน้า ${data.page} • ${subjectLabel(data.subject)} • พร้อม ${data.rows.filter((row) => row.ready).length} รายวิชา • นอกหน้า ${data.rows.filter((row) => !row.before).length} รายการ • ยังไม่กรอก`;
      setStatus("ตรวจ Preview ก่อนกรอก KSIS");
    } catch (error) { source.textContent = error.message; setStatus(error.message, "error"); }
    finally { busy = false; render(); }
  });
  const invalidate = () => { if (!pending) { generation++; preview = null; if (dialog.open) dialog.close(); source.textContent = "เดือน/ปีหรือวิชาเปลี่ยน กรุณาเตรียมข้อมูลใหม่"; render(); } };
  subject.addEventListener("change", invalidate);
  for (const id of ["reportMonth", "reportYear"]) get(id).addEventListener("change", invalidate);
  fill.addEventListener("click", () => {
    if (!preview || busy || pending) return;
    get("ksisDraftConfirmText").textContent = `กรอก ${preview.rows.filter((row) => row.ready).length} รายวิชา • ${subjectLabel(preview.subject)} • ${preview.period.month}/${preview.period.year} • หน้า KSIS ${preview.page}`;
    dialog.showModal();
  });
  get("ksisDraftCancel").addEventListener("click", () => dialog.close());
  get("ksisDraftConfirm").addEventListener("click", async () => {
    if (busy || pending || !preview) return;
    dialog.close(); busy = true; buttons();
    try {
      const result = await call("fill", { previewId: preview.previewId });
      pending = true;
      source.textContent = `กรอกแล้ว ${result.filled} รายวิชา • หน้า ${result.page} • ยังไม่บันทึกหลัก กรุณาตรวจและกดบันทึกเองใน KSIS ก่อนเปลี่ยนหน้า`;
      setStatus("กรอกแล้ว รอตรวจและบันทึกหลักใน KSIS ด้วยตนเอง");
    } catch (error) { pending = error.message.includes("ค้างใน KSIS"); source.textContent = error.message; setStatus(error.message, "error"); }
    finally { busy = false; preview = null; buttons(); }
  });
  acknowledge.addEventListener("click", async () => {
    if (busy) return;
    if (!window.confirm("ยืนยันว่าตรวจและบันทึก หรือยกเลิกข้อมูลค้างใน KSIS ด้วยตนเองเรียบร้อยแล้วใช่ไหม?")) return;
    busy = true; buttons();
    try {
      await call("acknowledge", {}); pending = false;
      source.textContent = "รับทราบแล้ว เปลี่ยนหน้าบน KSIS แล้วเตรียมข้อมูลหน้าถัดไปได้";
    } catch (error) { setStatus(error.message, "error"); }
    finally { busy = false; buttons(); }
  });
}
