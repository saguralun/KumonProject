const labels = { matched: 'ตรงกัน', mismatch: 'ไม่ตรงกัน', review: 'ต้องตรวจ', missing_ksis: 'ไม่พบใน KSIS', missing_report: 'ไม่พบใน Report' };
const classes = { matched: 'match-exact', mismatch: 'match-conflict', review: 'match-review', missing_ksis: 'match-conflict', missing_report: 'match-review' };
const fields = [['date', 'วันที่สอบ'], ['level', 'ระดับ'], ['time', 'เวลา'], ['score', 'คะแนน'], ['group', 'Group'], ['passed', 'ผ่าน']];

export function setupKsisAtAudit({ shared, getPeriod, setStatus, onStateChange }) {
  const get = (id) => document.getElementById(id), text = (value) => escapeHtml(String(value ?? ''));
  const subject = get('ksisAtAuditSubject'), source = get('ksisAtAuditSource'), filter = get('ksisAtAuditFilter'), search = get('ksisAtAuditSearch');
  let result = null, busy = false;
  const format = (field, value) => value == null || value === '' ? '—' : field === 'passed' ? value ? 'ใช่' : 'ไม่ใช่'
    : field === 'date' ? String(value).split('-').reverse().join('/') : field === 'group' ? `G${value}` : value;
  function render() {
    const rows = (result?.rows || []).filter((row) => (filter.value === 'all' || filter.value === 'issues' && row.outcome !== 'matched' || row.outcome === filter.value)
      && `${row.name} ${row.kumonId} ${row.birthDate || ''}`.toLocaleLowerCase('th').includes(search.value.trim().toLocaleLowerCase('th')));
    get('ksisAtAuditCounts').innerHTML = result ? Object.entries(labels).map(([key, label]) => `<span class="audit-total ${classes[key]}">${label} <strong>${result.counts[key] || 0}</strong></span>`).join('') : '';
    get('ksisAtAuditCount').textContent = result ? `แสดง ${rows.length} / ${result.rows.length} ผลสอบ` : '';
    get('ksisAtAuditRows').innerHTML = rows.length ? `<table class="matching-table audit-table at-audit-table"><thead><tr><th>นักเรียน / วิชา</th>${fields.map(([, label]) => `<th>${label}</th>`).join('')}<th>ผลตรวจ</th></tr></thead><tbody>${rows.map((row) => `<tr>
      <td>${text(row.name)}<div class="subtle">${text(row.kumonId || 'ไม่มีรหัสคุมอง')} • ${text(row.subject)}${row.page ? ` • หน้า ${row.page}` : ''}</div>${row.matchMethod === 'name_birth_date' ? `<div class="subtle">ชื่อและวันเกิด • ${text(row.birthDate)}</div>` : ''}</td>
      ${fields.map(([field, label]) => `<td data-label="${label}"${row.differences.some((item) => item.field === field) ? ' class="audit-difference"' : ''}><span class="audit-value"><span class="subtle">Report </span>${text(format(field, row.expected?.[field]))}</span><span class="audit-value"><span class="subtle">KSIS </span>${text(format(field, row.actual?.[field]))}</span></td>`).join('')}
      <td><span class="match-state ${classes[row.outcome]}">${labels[row.outcome]}</span>${row.reason ? `<div class="audit-reason">${text(row.reason)}</div>` : ''}</td></tr>`).join('')}</tbody></table>` : `<div class="empty-state">${result ? 'ไม่พบรายการตามตัวกรอง' : 'ยังไม่มีผลตรวจ AT'}</div>`;
  }
  function describe() {
    source.textContent = result ? `${result.context} • ${result.subject} • ${result.scope === 'all' ? 'ทุกหน้าตามตัวกรอง KSIS' : `หน้าที่เลือก ${result.originalPage}`} • อ่าน ${result.pagesRead} หน้า • ตรวจเมื่อ ${new Date(result.verifiedAt).toLocaleString('th-TH')} • อ่านอย่างเดียว${result.outsidePage ? ` • นอกหน้า ${result.outsidePage} ผลสอบ` : ''}` : 'ยังไม่ได้ตรวจ AT';
  }
  async function read(scope) {
    if (busy) return;
    busy = true; result = null; render(); onStateChange({ busy });
    for (const id of ['ksisAtAuditCurrent', 'ksisAtAuditAll', 'ksisAtAuditSubject']) get(id).disabled = true;
    source.textContent = 'กำลังอ่าน AT ที่บันทึกจาก KSIS...'; setStatus(source.textContent);
    try {
      const data = await requestJson('/api/ksis/at-audit', { method: 'POST', body: JSON.stringify({ ...getPeriod(), subject: subject.value, scope }) });
      if (data.requiresLogin) { source.textContent = 'กรุณาเข้าสู่ระบบ KSIS แล้วกดตรวจอีกครั้ง'; setStatus(source.textContent); return; }
      result = data; describe();
      const issues = result.rows.filter((row) => row.outcome !== 'matched').length;
      setStatus(`ตรวจ AT แล้ว • ตรง ${result.counts.matched} • ต้องตรวจ ${issues} ผลสอบ`, issues ? 'neutral' : 'success');
    } catch (error) { source.textContent = error.message; setStatus(error.message, 'error'); }
    finally {
      busy = false; for (const id of ['ksisAtAuditCurrent', 'ksisAtAuditAll', 'ksisAtAuditSubject']) get(id).disabled = false;
      onStateChange({ busy }); render(); void shared?.refresh(true);
    }
  }
  get('ksisAtAuditCurrent').addEventListener('click', () => read('current'));
  get('ksisAtAuditAll').addEventListener('click', () => read('all'));
  filter.addEventListener('change', render); search.addEventListener('input', render);
  for (const element of [subject, get('reportMonth'), get('reportYear')]) element.addEventListener('change', () => {
    result = null; source.textContent = 'เดือน/ปีหรือวิชาเปลี่ยน กรุณาตรวจ AT ใหม่'; render();
  });
  shared?.subscribe('atAudit', (state, workspace) => {
    result = state.result; busy = workspace.busy;
    if (state.subject) subject.value = state.subject;
    for (const id of ['ksisAtAuditCurrent', 'ksisAtAuditAll', 'ksisAtAuditSubject']) get(id).disabled = busy;
    describe();
    if (state.error || busy) source.textContent = state.error || 'กำลังตรวจ AT...';
    else if (state.requiresLogin) source.textContent = 'กรุณาเข้าสู่ระบบ KSIS แล้วกดตรวจอีกครั้ง';
    onStateChange({ busy }); render();
  });
}
