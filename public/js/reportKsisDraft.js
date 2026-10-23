export function setupKsisDraft({ shared, open, setStatus, getPeriod, onStateChange = () => {} }) {
  const get = (id) => document.getElementById(id);
  const read = get("ksisDraftPreview"), fill = get("ksisDraftFill"), acknowledge = get("ksisDraftAcknowledge");
  const inspect = get('ksisDraftInspect');
  const subject = get("ksisDraftSubject"), source = get("ksisDraftSource"), container = get("ksisDraftRows"), dialog = get("ksisDraftDialog");
  let preview = null, result = null, inspection = null, busy = false, pending = false, generation = 0;
  let automaticallyChecked = null;
  const confirmedMatches = new Set();
  const eligibleRows = () => (preview?.rows || []).filter((row) => row.ready && (!row.requiresIdentityConfirmation || confirmedMatches.has(row.key)));
  const call = (action, data) => requestJson(`/api/ksis/draft/${action}`, { method: "POST", body: JSON.stringify(data) }).finally(() => { void shared?.refresh(true); });
  const text = (value) => escapeHtml(String(value ?? ""));
  const subjectLabel = (value) => value === "ALL" ? "ทุกวิชา (ME / EFL / TRP)" : value;
  function buttons() {
    read.disabled = busy || pending; subject.disabled = busy || pending;
    fill.disabled = busy || pending || !eligibleRows().length;
    acknowledge.classList.toggle("hidden", !pending); acknowledge.disabled = busy;
    inspect.classList.toggle('hidden', !pending); inspect.disabled = busy;
    onStateChange({ busy, pending });
  }
  function render() {
    const rows = (result?.rows || preview?.rows || []).filter((row) => (row.before || row.requiresIdentityConfirmation) && !row.skipped);
    if (preview && !result && !busy) {
      source.textContent = `${preview.context} • หน้า ${preview.page} • ${subjectLabel(preview.subject)} • WS เท่านั้น • พร้อม ${eligibleRows().length} รายวิชา • รอยืนยันชื่อ ${preview.rows.filter((row) => row.ready && row.requiresIdentityConfirmation && !confirmedMatches.has(row.key)).length} รายวิชา • ข้าม A ${preview.rows.filter((row) => row.before && row.skipped).length} รายวิชา • นอกหน้า ${preview.rows.filter((row) => !row.before).length} รายการ • จะกรอกและบันทึกเฉพาะหน้านี้`;
    }
    const outcomes = { saved: ["กรอกและบันทึกแล้ว", "match-exact"], filled: ["กรอกแล้ว (รอตรวจการบันทึก)", "match-review"], failed: ["ต้องตรวจ", "match-conflict"], not_started: ["ยังไม่ได้กรอก", "match-review"], blocked: ["ไม่ผ่านการตรวจ", "match-conflict"] };
    container.innerHTML = rows.length ? `${result ? '<h3 class="draft-result-title">สรุปการกรอกหน้านี้</h3>' : ""}<table class="matching-table"><thead><tr><th>นักเรียน / รหัสคุมอง</th><th>ระดับ / หน้า</th><th>WS ที่ใช้</th><th>ST1</th><th>${result ? "ผลการกรอก" : "ผลตรวจ"}</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${text(row.name)}<div class="subtle">${text(row.requiresIdentityConfirmation ? "ยังไม่มีรหัสคุมอง" : row.kumonId)} • ${text(row.subject)}${row.isKc ? " • KC" : ""}</div>
      ${row.requiresIdentityConfirmation ? `<div class="draft-identity"><div>Report: ${text(row.name)} • ${text(row.birthDate)}</div><div>KSIS: ${text(row.before?.fullName || "ไม่พบคู่")} • ${text(row.before?.birthDate || "—")}</div>${!result && row.ready ? `<label><input type="checkbox" data-confirm-identity="${text(row.key)}" aria-label="ยืนยันคู่ ${text(row.name)} ${text(row.subject)}" ${confirmedMatches.has(row.key) ? "checked" : ""} ${busy || pending ? "disabled" : ""}> ยืนยันว่าเป็นเด็กคนเดียวกัน • ${text(row.subject)}</label>` : ""}</div>` : ""}</td>
      <td>${text(row.before?.level.value || "—")} ${text(row.before?.worksheet.value)} → ${text(row.desired.level || "คงเดิม")} ${text(row.desired.worksheet ?? "")}</td>
      <td>${text(row.before?.used.value ?? "—")} → ${text(row.desired.used)}</td><td>${text(row.before?.status.value || "—")} → ${text(row.desired.status)}</td>
      <td><span class="match-state ${result ? outcomes[row.outcome]?.[1] || "match-review" : row.ready ? row.requiresIdentityConfirmation && !confirmedMatches.has(row.key) ? "match-review" : "match-exact" : "match-conflict"}">${result ? outcomes[row.outcome]?.[0] || "ยังไม่ได้กรอก" : row.ready ? row.requiresIdentityConfirmation && !confirmedMatches.has(row.key) ? "รอยืนยันคู่ชื่อและวันเกิด" : "พร้อมกรอก" : text(row.reason)}</span>${result && row.resultReason ? `<div class="draft-result-reason${["filled", "saved"].includes(row.outcome) ? " draft-result-notice" : ""}">${text(row.resultReason)}</div>` : ""}</td></tr>`).join("")}</tbody></table>` : `<div class="empty-state">${preview && !preview.rows.length ? "ไม่มีรายการใน Report ของเดือนและวิชาที่เลือก (รายชื่อมาจากบิลหรือประวัติสถานะของเดือนนั้น)" : preview?.rows.some((row) => row.before && row.skipped) ? "ข้ามรายการสถานะ A ในหน้านี้ ให้จัดการสถานะเองบน KSIS" : "ไม่มีข้อมูลตรงกับหน้า KSIS ปัจจุบัน"}</div>`;
    if (result && inspection?.previousResultUnverified) {
      container.innerHTML = `<details class="draft-previous-result"><summary>ผลรอบก่อน • บันทึกยืนยันแล้ว ${text(result.savedCount || 0)} รายวิชา • รายการที่เหลือต้องตรวจ WS หลังเข้าสู่ระบบ</summary>${container.innerHTML}</details>`;
    }
    buttons();
  }
  get("ksisDraftButton").addEventListener("click", open);
  container.addEventListener('change', (event) => {
    const input = event.target.closest('[data-confirm-identity]');
    if (!input || busy || pending || result) return;
    if (input.checked) confirmedMatches.add(input.dataset.confirmIdentity); else confirmedMatches.delete(input.dataset.confirmIdentity);
    void shared?.confirm('draft', preview.previewId, [...confirmedMatches]);
    render();
    [...container.querySelectorAll('[data-confirm-identity]')].find((element) => element.dataset.confirmIdentity === input.dataset.confirmIdentity)?.focus();
  });
  read.addEventListener("click", async () => {
    if (busy || pending) return;
    const requestId = ++generation;
    busy = true; preview = null; result = null; inspection = null; confirmedMatches.clear(); render();
    source.textContent = "กำลังอ่าน Report และหน้า KSIS ปัจจุบัน...";
    try {
      const data = await call("preview", { ...getPeriod(), subject: subject.value });
      if (requestId !== generation) return;
      if (data.requiresLogin) { source.textContent = "กรุณาเข้าสู่ระบบ KSIS ที่เปิดไว้ แล้วกดเตรียมข้อมูลอีกครั้ง"; return; }
      preview = data;
      setStatus("ตรวจ Preview ก่อนกรอก KSIS");
    } catch (error) { source.textContent = error.message; setStatus(error.message, "error"); }
    finally { busy = false; render(); }
  });
  const invalidate = () => { if (!pending) { generation++; preview = null; result = null; confirmedMatches.clear(); if (dialog.open) dialog.close(); source.textContent = "เดือน/ปีหรือวิชาเปลี่ยน กรุณาเตรียมข้อมูลใหม่"; render(); } };
  subject.addEventListener("change", invalidate);
  for (const id of ["reportMonth", "reportYear"]) get(id).addEventListener("change", invalidate);
  fill.addEventListener("click", () => {
    if (!preview || busy || pending) return;
    get("ksisDraftConfirmText").textContent = `กรอกและบันทึก ${eligibleRows().length} รายวิชา • ยืนยันคู่ชื่อแล้ว ${eligibleRows().filter((row) => row.requiresIdentityConfirmation).length} รายวิชา • ${subjectLabel(preview.subject)} • ${preview.period.month}/${preview.period.year} • หน้า KSIS ${preview.page}`;
    get("ksisDraftConfirmScope").textContent = "กรอกระดับ หน้าปัจจุบัน WS used และ ST1 เท่านั้น • ไม่กรอก Zun/AT/DT • ข้ามสถานะ A • KC ใช้ WS used = 1 • บันทึกทุก 10 คน โดยรวมทุกวิชาของเด็กคนเดียวกัน • ท้ายหน้าไม่ครบ 10 คนก็บันทึก • ไม่เปลี่ยนหน้าอัตโนมัติ";
    dialog.showModal();
  });
  get("ksisDraftCancel").addEventListener("click", () => dialog.close());
  get("ksisDraftConfirm").addEventListener("click", async () => {
    if (busy || pending || !preview) return;
    dialog.close(); busy = true; inspection = null; render();
    setStatus("กำลังกรอก WS และบันทึกทุก 10 คน...");
    try {
      result = await call("fill", { previewId: preview.previewId, saveAfterFill: true,
        confirmedIdentityMatches: eligibleRows().filter((row) => row.requiresIdentityConfirmation).map((row) => ({ enrollmentId: row.enrollmentId, key: row.key })) });
      pending = result.pendingDraft !== false;
      source.textContent = `${result.stopped ? `${result.error} • ` : ""}กรอกแล้ว ${result.studentsFilled ?? result.filled} คน / ${result.filled} รายวิชา • บันทึกแล้ว ${result.studentsSaved || 0} คน / ${result.savedCount || 0} รายวิชา (${result.batchesSaved || 0} รอบ) • ข้าม A ${result.skipped || 0} รายวิชา${result.filterNotices ? ` • KSIS ยังแสดงข้อความตัวกรองเดิม ${result.filterNotices} รายวิชา` : ""} • หน้า ${result.page} • ${result.saved ? "บันทึกเฉพาะหน้านี้แล้ว" : "ยังไม่ยืนยันผลบันทึกครบทั้งหมด"}`;
      setStatus(result.stopped ? result.error : "กรอกและบันทึก WS ของหน้านี้แล้ว พร้อมให้ตรวจอีกครั้ง", result.stopped ? "error" : "success");
    } catch (error) {
      try { pending = (await requestJson('/api/ksis/desktop/status')).pendingDraft !== false; }
      catch { pending = true; }
      source.textContent = error.message; setStatus(error.message, "error");
    }
    finally { busy = false; preview = null; render(); }
  });
  const inspectCurrent = async () => {
    if (busy) return;
    busy = true; buttons();
    try {
      inspection = await call('inspect', {}); pending = inspection.pendingDraft !== false;
      source.textContent = inspection.message; setStatus(inspection.message, pending ? 'error' : 'neutral');
    } catch (error) { source.textContent = error.message; setStatus(error.message, 'error'); }
    finally { busy = false; render(); }
  };
  inspect.addEventListener('click', inspectCurrent);
  acknowledge.addEventListener("click", async () => {
    if (busy) return;
    if (!window.confirm("ยืนยันว่าตรวจและบันทึก หรือยกเลิกข้อมูลค้างใน KSIS ด้วยตนเองเรียบร้อยแล้วใช่ไหม?")) return;
    busy = true; buttons();
    try {
      inspection = await call("acknowledge", {}); pending = false;
      source.textContent = inspection.message || "รับทราบแล้ว กรุณาเตรียมข้อมูลใหม่";
      setStatus(source.textContent);
    } catch (error) { setStatus(error.message, "error"); }
    finally { busy = false; buttons(); }
  });
  shared?.subscribe('draft', (state, workspace) => {
    const changed = preview?.previewId !== state.preview?.previewId;
    preview = state.preview; result = state.result; inspection = state.inspection; busy = workspace.busy;
    pending = state.pending || (workspace.connection?.pendingDraft === true && workspace.connection?.pendingWork === 'WS');
    confirmedMatches.clear(); for (const key of state.confirmed) confirmedMatches.add(key);
    if (state.subject) subject.value = state.subject;
    if (dialog.open && (changed || busy || pending)) dialog.close();
    source.textContent = state.error || (busy ? 'กำลังทำงานกับ KSIS...' : inspection?.message || (state.requiresLogin ? 'กรุณาเข้าสู่ระบบ KSIS แล้วเตรียมใหม่' : result ? `${result.error || ''} • บันทึกแล้ว ${result.savedCount || 0} รายวิชา • หน้า ${result.page}` : 'ยังไม่ได้เตรียมข้อมูล'));
    if (workspace.active) setStatus(source.textContent, state.error || pending ? 'error' : 'neutral');
    render();
    const attempt = result?.attemptId || JSON.stringify([result?.error, result?.page, result?.savedCount, result?.rows?.map((row) => row.key)]);
    if (workspace.active && pending && !busy && result && automaticallyChecked !== attempt) {
      automaticallyChecked = attempt;
      void inspectCurrent();
    }
  });
}
