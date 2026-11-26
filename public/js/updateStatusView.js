// Informational only. Retrying a version check never installs an update.
export function createUpdateStatusView(parent, { compact = false } = {}) {
  if (!document.getElementById('updateCheckStyles')) {
    const style = document.createElement('style'); style.id = 'updateCheckStyles';
    style.textContent = `.update-check-status{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;max-width:100%;margin:8px 0;color:#52627a;font:12px Sarabun,Arial,sans-serif;line-height:1.5}.update-check-status[data-stale=true]{color:#92400e}.update-check-status button{border:1px solid #cbd5e1;border-radius:6px;padding:4px 8px;background:#fff;color:#1e40af;font:inherit;cursor:pointer;white-space:nowrap}.update-check-status button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}.update-check-status button:disabled{color:#52627a;cursor:wait}.app-menu-panel .update-check-status{padding:0 12px}`;
    document.head.append(style);
  }
  if (compact && !document.getElementById('updateCheckCompactStyles')) {
    const style = document.createElement('style'); style.id = 'updateCheckCompactStyles';
    style.textContent = `
      .auth-actions{display:flex;align-items:stretch;gap:8px;min-width:0}
      .auth-actions>.auth-logout{flex:1;min-width:0;width:auto!important;margin:0!important}
      .auth-actions>.update-check-compact{flex:1;min-width:0;margin:0;padding:0}
      .update-check-compact button{width:100%;min-height:36px;padding:6px 8px;border-radius:8px;font-weight:600}
      .update-check-compact [hidden]{display:none!important}
      .update-check-toast{position:fixed;right:24px;bottom:24px;z-index:1000;max-width:min(420px,calc(100vw - 48px));box-sizing:border-box;padding:14px 18px;border:1px solid #a8dac6;border-radius:12px;background:#ecfdf5;color:#185440;box-shadow:0 8px 28px #183b3526;font:600 14px/1.6 Sarabun,'Segoe UI',sans-serif;overflow-wrap:anywhere;pointer-events:none}
      .update-check-toast[data-error=true]{background:#fffbeb;color:#92400e;border-color:#f4d28a}
      .update-check-toast[hidden]{display:none!important}
      @media print{.update-check-toast{display:none!important}}
    `;
    document.head.append(style);
  }
  const root = document.createElement('div'); root.id = 'updateCheckStatus'; root.className = 'update-check-status';
  const message = document.createElement('span'); message.id = 'updateCheckMessage'; message.setAttribute('role', 'status');
  const retry = document.createElement('button'); retry.id = 'updateCheckRetry'; retry.type = 'button'; retry.textContent = 'ตรวจอีกครั้ง';
  let toast, toastTimer, manualCheck = false;
  if (compact) {
    root.classList.add('update-check-compact'); message.hidden = true;
    retry.textContent = 'ตรวจสอบอัปเดต';
    toast = document.createElement('div'); toast.id = 'updateCheckToast'; toast.className = 'update-check-toast';
    toast.hidden = true; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); toast.setAttribute('aria-atomic', 'true');
    document.body.append(toast);
  }
  function hideToast() { clearTimeout(toastTimer); if (toast) { toast.hidden = true; toast.textContent = ''; } }
  function showToast(text, error = false) {
    hideToast(); toast.textContent = text; toast.dataset.error = String(error); toast.hidden = false;
    toastTimer = setTimeout(hideToast, 5000);
  }
  root.append(message, retry); parent.append(root);
  return {
    onRetry(callback) {
      retry.addEventListener('click', async () => {
        manualCheck = true; hideToast();
        try { await callback(); }
        catch { if (compact) showToast('ตรวจสอบอัปเดตไม่ได้ กรุณาลองอีกครั้ง', true); }
        finally { manualCheck = false; }
      });
    },
    update(state) {
      retry.disabled = state.checking === true;
      if (compact) retry.textContent = state.checking ? 'กำลังตรวจสอบ...' : 'ตรวจสอบอัปเดต';
      root.dataset.stale = String(state.checked === false);
      const last = state.lastSuccessAt == null ? 'ยังไม่เคยตรวจสำเร็จ' : `ตรวจสำเร็จล่าสุด ${new Date(state.lastSuccessAt).toLocaleString('th-TH')}`;
      message.textContent = state.checking ? 'กำลังตรวจเวอร์ชัน...'
        : state.checked ? `${state.upToDate ? 'โปรแกรมเป็นรุ่นล่าสุด' : 'มีอัปเดตโปรแกรม'} • ${last}`
          : `ตรวจเวอร์ชันไม่ได้ • ${last}${state.lastSuccessAt == null ? '' : ' • ผลเดิมยังรอยืนยัน'}`;
      if (compact && manualCheck && !state.checking) {
        showToast(state.checked ? `ตรวจสอบแล้ว • ${state.upToDate ? 'โปรแกรมเป็นรุ่นล่าสุด' : 'มีอัปเดตโปรแกรม'}` : 'ตรวจสอบอัปเดตไม่ได้ กรุณาลองอีกครั้ง', !state.checked);
      }
    }
  };
}
