// Informational only. Retrying a version check never installs an update.
export function createUpdateStatusView(parent) {
  if (!document.getElementById('updateCheckStyles')) {
    const style = document.createElement('style'); style.id = 'updateCheckStyles';
    style.textContent = `.update-check-status{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;max-width:100%;margin:8px 0;color:#52627a;font:12px Sarabun,Arial,sans-serif;line-height:1.5}.update-check-status[data-stale=true]{color:#92400e}.update-check-status button{border:1px solid #cbd5e1;border-radius:6px;padding:4px 8px;background:#fff;color:#1e40af;font:inherit;cursor:pointer;white-space:nowrap}.update-check-status button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}.update-check-status button:disabled{color:#52627a;cursor:wait}.app-menu-panel .update-check-status{padding:0 12px}`;
    document.head.append(style);
  }
  const root = document.createElement('div'); root.id = 'updateCheckStatus'; root.className = 'update-check-status';
  const message = document.createElement('span'); message.id = 'updateCheckMessage'; message.setAttribute('role', 'status');
  const retry = document.createElement('button'); retry.id = 'updateCheckRetry'; retry.type = 'button'; retry.textContent = 'ตรวจอีกครั้ง';
  root.append(message, retry); parent.append(root);
  return {
    onRetry(callback) { retry.addEventListener('click', () => { void callback(); }); },
    update(state) {
      retry.disabled = state.checking === true;
      root.dataset.stale = String(state.checked === false);
      const last = state.lastSuccessAt == null ? 'ยังไม่เคยตรวจสำเร็จ' : `ตรวจสำเร็จล่าสุด ${new Date(state.lastSuccessAt).toLocaleString('th-TH')}`;
      message.textContent = state.checking ? 'กำลังตรวจเวอร์ชัน...'
        : state.checked ? `${state.upToDate ? 'โปรแกรมเป็นรุ่นล่าสุด' : 'มีอัปเดตโปรแกรม'} • ${last}`
          : `ตรวจเวอร์ชันไม่ได้ • ${last}${state.lastSuccessAt == null ? '' : ' • ผลเดิมยังรอยืนยัน'}`;
    }
  };
}
