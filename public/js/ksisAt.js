const labels = { ready: 'พร้อมกรอก', existing: 'มีผลสอบตรงกันแล้ว', review: 'ต้องตรวจ', saved: 'บันทึกแล้ว', unconfirmed: 'รอยืนยันคู่', not_started: 'ยังไม่ได้กรอก' };
const classes = { ready: 'match-exact', existing: 'match-matched', saved: 'match-exact', review: 'match-conflict', unconfirmed: 'match-review', not_started: 'match-review' };

export function setupKsisAt({ shared, open, getPeriod, setStatus, onStateChange }) {
  const get = (id) => document.getElementById(id);
  const source = get('ksisAtSource'), container = get('ksisAtRows'), subject = get('ksisAtSubject'), dialog = get('ksisAtDialog');
  let preview = null, result = null, busy = false, pending = false, inspection = null;
  let confirmation = null;
  const confirmed = new Set();
  const text = (value) => escapeHtml(String(value ?? ''));
  const call = (action, data = {}) => requestJson(`/api/ksis/at/${action}`, { method: 'POST', body: JSON.stringify(data) }).finally(() => { void shared?.refresh(true); });
  const eligible = () => (preview?.rows || []).filter((row) => row.outcome === 'ready' && (!row.requiresIdentityConfirmation || confirmed.has(row.id)));
  const confirmationScope = () => JSON.stringify([preview?.previewId, preview?.period, preview?.subject, preview?.page,
    eligible().map(row => [row.id, row.desired]), [...confirmed].sort()]);
  dialog.addEventListener('close', () => { if (!dialog.open) confirmation = null; });
  function controls() {
    for (const id of ['ksisAtOpen', 'ksisAtPreview', 'ksisAtSubject']) get(id).disabled = busy || pending;
    get('ksisAtFill').disabled = busy || pending || !preview || !eligible().length;
    get('ksisAtAcknowledge').classList.toggle('hidden', !pending); get('ksisAtAcknowledge').disabled = busy;
    onStateChange({ busy, pending });
  }
  function render() {
    const rows = result?.rows || preview?.rows || [];
    const outcome = (row) => row.outcome === 'ready' ? result ? 'not_started' : row.requiresIdentityConfirmation && !confirmed.has(row.id) ? 'unconfirmed' : 'ready' : row.outcome;
    const counts = Object.fromEntries(Object.keys(labels).map((key) => [key, rows.filter((row) => outcome(row) === key).length]));
    get('ksisAtCounts').innerHTML = Object.entries(counts).filter(([, count]) => count).map(([key, count]) => `<span class="audit-total ${classes[key]}">${labels[key]} <strong>${count}</strong></span>`).join('');
    container.innerHTML = rows.length ? `<table class="matching-table at-table"><thead><tr><th>นักเรียน / วิชา</th><th>วันที่ / ระดับ</th><th>เวลา / คะแนน / Group</th><th>ผลตรวจ</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${text(row.name)}<div class="subtle">${text(row.kumonId || 'ยังไม่มีรหัสคุมอง')} • ${text(row.subject)}</div>
      ${row.requiresIdentityConfirmation ? `<div class="draft-identity">Report: ${text(row.name)} • ${text(row.birthDate)}<br>KSIS: ${text(row.targetName || 'ไม่พบคู่')} • ${text(row.targetBirthDate)}${row.outcome === 'ready' && !result ? `<label><input type="checkbox" data-at-identity="${text(row.id)}" aria-label="ยืนยันคู่ ${text(row.name)} ${text(row.desired.level)}" ${confirmed.has(row.id) ? 'checked' : ''} ${busy || pending ? 'disabled' : ''}>ยืนยันเด็กคนเดียวกัน</label>` : ''}</div>` : ''}</td>
      <td>${text(row.desired.date?.split('-').reverse().join('/'))}<div>${text(row.desired.level)}</div></td>
      <td>${text(row.desired.time)} นาที • ${text(row.desired.score)} คะแนน<div>G${text(row.desired.group)} • ผ่าน</div></td>
      <td><span class="match-state ${classes[outcome(row)]}">${labels[outcome(row)]}</span>${row.reason ? `<div class="audit-reason">${text(row.reason)}</div>` : ''}${row.key && /^\d{13}$/.test(row.kumonId) ? `<div><button type="button" class="secondary-button" data-at-inspect="${text(row.kumonId)}" ${busy ? 'disabled' : ''}>ตรวจแบบอ่านอย่างเดียว</button></div>` : ''}</td>
      </tr>`).join('')}</tbody></table>` : `<div class="empty-state">${preview ? 'ไม่มีผลสอบ AT ใน Report ของเดือนและวิชาที่เลือก' : 'ยังไม่มี Preview AT'}</div>`;
    renderInspection(); controls();
  }
  function renderInspection() {
    const target = get('ksisAtInspection');
    if (!target) return;
    target.classList.toggle('hidden', !inspection);
    if (!inspection) { target.innerHTML = ''; return; }
    const all = inspection.comparisons.length > 0 && inspection.comparisons.every((item) => item.persisted && item.matches);
    const summary = inspection.dirty ? 'มีข้อมูลแก้ค้างอยู่ ยังไม่ยืนยันการบันทึก ไม่รีเฟรชทิ้งค่า'
      : inspection.refreshed ? all ? 'อ่านข้อมูลที่บันทึกใหม่แล้ว • ตรงกับ Report' : 'อ่านข้อมูลที่บันทึกใหม่แล้ว • ไม่พบผลสอบที่ตรงครบ'
        : 'อ่านค่าปัจจุบันเท่านั้น • ยังไม่ได้ยืนยันกับข้อมูลที่บันทึก';
    target.innerHTML = `<h3>ตรวจ ${text(inspection.name)} • ${text(inspection.subject)}</h3><div role="status">${text(summary)}</div>
      <div class="subtle">หน้า ${text(inspection.page)} • ${text(inspection.kumonId)} • อ่านอย่างเดียว</div>
      <table class="matching-table at-inspection-table"><thead><tr><th></th><th>วันที่ / ระดับ</th><th>เวลา / คะแนน / Group</th><th>ผ่าน</th></tr></thead><tbody>${inspection.comparisons.map((item) => `<tr><th>Report</th><td>${text(item.desired.date)} • ${text(item.desired.level)}</td><td>${text(item.desired.time)} นาที • ${text(item.desired.score)} คะแนน • G${text(item.desired.group)}</td><td>ใช่</td></tr><tr><th>KSIS</th><td>${text(item.actual?.date.value || '—')} • ${text(item.actual?.level.value || '—')}</td><td>${text(item.actual?.time.value || '—')} นาที • ${text(item.actual?.score.value || '—')} คะแนน • ${text(item.actual?.group.value || '—')}</td><td>${item.actual?.passed ? 'ใช่' : 'ไม่ใช่'}</td></tr>`).join('')}</tbody></table>
      ${inspection.tests.filter((item) => item.error).map((item) => `<div class="audit-reason match-conflict">KSIS: ${text(item.error)}</div>`).join('')}
      ${inspection.lastSave ? `<div class="subtle">คำตอบบันทึกครั้งก่อน: HTTP ${text(inspection.lastSave.status ?? 'ไม่ทราบ')} ${inspection.lastSave.rows.map((row) => `• saveResult ${text(row.saveResult)} • ${text(row.error || 'ไม่มีข้อความผิดพลาด')}`).join(' ')}</div>` : ''}`;
  }
  container.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-at-inspect]');
    if (!button || busy) return;
    busy = true; render(); setStatus('กำลังตรวจ AT แบบอ่านอย่างเดียว...');
    try {
      const data = await call('inspect', { ...getPeriod(), subject: subject.value, kumonId: button.dataset.atInspect });
      if (data.requiresLogin) { setStatus('กรุณาเข้าสู่ระบบ KSIS ก่อนตรวจ', 'error'); return; }
      inspection = data; setStatus('ตรวจ AT แล้ว • ไม่มีการกรอกหรือบันทึก');
    } catch (error) { source.textContent = error.message; setStatus(error.message, 'error'); }
    finally { busy = false; render(); }
  });
  get('ksisAtButton').addEventListener('click', open);
  container.addEventListener('change', (event) => {
    const input = event.target.closest('[data-at-identity]');
    if (!input || busy || pending || result) return;
    if (input.checked) confirmed.add(input.dataset.atIdentity); else confirmed.delete(input.dataset.atIdentity);
    void shared?.confirm('at', preview.previewId, [...confirmed]);
    render(); [...container.querySelectorAll('[data-at-identity]')].find((element) => element.dataset.atIdentity === input.dataset.atIdentity)?.focus();
  });
  const invalidate = () => { if (!pending) { preview = result = null; confirmed.clear(); if (dialog.open) dialog.close(); source.textContent = 'กรุณาเตรียม AT ใหม่'; render(); } };
  for (const element of [subject, get('reportMonth'), get('reportYear')]) element.addEventListener('change', invalidate);
  async function prepare(action) {
    if (busy || pending) return;
    busy = true; preview = result = inspection = null; confirmed.clear(); render();
    source.textContent = 'กำลังอ่านหน้า AT ของ KSIS...';
    try {
      const data = await call(action, { ...getPeriod(), subject: subject.value });
      if (action === 'open') { source.textContent = 'เปิดหน้า AT แล้ว'; return; }
      if (data.requiresLogin) { source.textContent = 'กรุณาเข้าสู่ระบบ KSIS แล้วเตรียม AT อีกครั้ง'; return; }
      preview = data; source.textContent = `${data.context} • ${data.subject} • หน้า ${data.page} • ${data.rows.length} ผลสอบใน Report`;
      setStatus('เตรียม AT แล้ว กรุณาตรวจ Preview ก่อนบันทึก');
    } catch (error) { source.textContent = error.message; setStatus(error.message, 'error'); }
    finally { busy = false; render(); }
  }
  get('ksisAtOpen').addEventListener('click', () => prepare('open'));
  get('ksisAtPreview').addEventListener('click', () => prepare('preview'));
  get('ksisAtFill').addEventListener('click', () => {
    if (busy || pending || !preview || !eligible().length) return;
    confirmation = { scope: confirmationScope(), payload: { previewId: preview.previewId, confirmSave: true, confirmedIdentityMatches: [...confirmed] } };
    get('ksisAtConfirmText').textContent = `${preview.subject} • ${preview.period.month}/${preview.period.year} • หน้า ${preview.page} • ${eligible().length} ผลสอบ`;
    dialog.showModal();
  });
  get('ksisAtCancel').addEventListener('click', () => dialog.close());
  get('ksisAtConfirm').addEventListener('click', async () => {
    if (busy || pending || !preview || !eligible().length) return;
    const approved = confirmation;
    if (!approved || approved.scope !== confirmationScope()) {
      dialog.close(); setStatus('รายการ AT เปลี่ยนระหว่างยืนยัน กรุณาตรวจ Preview และยืนยันใหม่', 'error'); return;
    }
    dialog.close(); busy = true; render(); setStatus('กำลังกรอกและบันทึก AT ทีละผลสอบ...');
    try {
      result = await call('fill', approved.payload);
      pending = result.pendingDraft === true; source.textContent = result.message;
      setStatus(result.message, pending ? 'error' : 'success');
    } catch (error) {
      source.textContent = error.message; setStatus(error.message, 'error');
      // A lost response must not leave a consumed preview available for retry.
      try { const state = await requestJson('/api/ksis/desktop/status'); pending = state.pendingDraft === true && state.pendingWork === 'AT'; } catch { pending = true; }
    } finally { preview = null; busy = false; render(); }
  });
  get('ksisAtAcknowledge').addEventListener('click', async () => {
    if (busy || !await confirmAction('ยืนยันว่าบันทึกเองหรือยกเลิกข้อมูล AT ค้างบน KSIS แล้วใช่ไหม?')) return;
    busy = true; controls();
    try { await call('acknowledge'); pending = false; source.textContent = 'จัดการข้อมูลค้างแล้ว กรุณาเตรียม AT ใหม่'; }
    catch (error) { source.textContent = error.message; setStatus(error.message, 'error'); }
    finally { busy = false; controls(); }
  });
  void requestJson('/api/ksis/desktop/status').then((state) => {
    if (state.pendingDraft && state.pendingWork === 'AT') {
      open(); pending = true; source.textContent = 'มี AT จากรอบก่อนค้างอยู่ กรุณาตรวจบน KSIS ก่อนกรอกใหม่'; controls();
    }
  }).catch(() => {});
  shared?.subscribe('at', (state, workspace) => {
    const changed = preview?.previewId !== state.preview?.previewId;
    preview = state.preview; result = state.result; busy = workspace.busy; pending = state.pending || workspace.connection?.pendingWork === 'AT';
    confirmed.clear(); for (const key of state.confirmed) confirmed.add(key);
    if (state.subject) subject.value = state.subject;
    inspection = state.inspection || null;
    const scopeChanged = dialog.open && confirmation?.scope !== confirmationScope();
    if (dialog.open && (changed || busy || pending || scopeChanged)) dialog.close();
    source.textContent = state.error || (busy ? 'กำลังทำงานกับ KSIS...' : state.requiresLogin ? 'กรุณาเข้าสู่ระบบ KSIS แล้วเตรียมใหม่' : result?.message || (preview ? `${preview.context} • ${preview.subject} • หน้า ${preview.page} • ${preview.rows.length} ผลสอบใน Report` : 'ยังไม่ได้เตรียม AT'));
    if (workspace.active) setStatus(source.textContent, state.error || pending ? 'error' : 'neutral');
    render();
    if (scopeChanged) setStatus('รายการ AT เปลี่ยนระหว่างยืนยัน กรุณาตรวจ Preview และยืนยันใหม่', 'error');
  });
}
