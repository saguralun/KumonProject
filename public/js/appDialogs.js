// One asynchronous confirmation path for browsers and the embedded desktop.
(() => {
  let active = false;
  function show(message, { title = 'ยืนยันรายการ', confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', notice = false } = {}) {
    if (active) return Promise.resolve(false);
    active = true;
    if (!document.getElementById('appDialogStyles')) {
      const style = document.createElement('style'); style.id = 'appDialogStyles';
      style.textContent = `.app-action-dialog{box-sizing:border-box;width:min(460px,calc(100vw - 32px));max-height:calc(100vh - 32px);margin:auto;padding:20px;border:1px solid #ccd7e5;border-radius:8px;background:#fff;color:#15283c;overflow:auto;font:14px Sarabun,Arial,sans-serif;letter-spacing:0}.app-action-dialog::backdrop{background:#0e16226b}.app-action-dialog h2{margin:0 0 12px;font-size:18px}.app-action-dialog p{white-space:pre-line;overflow-wrap:anywhere}.app-dialog-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;margin-top:20px}.app-action-dialog button{min-height:36px;padding:7px 14px;border:1px solid #ccd7e5;border-radius:6px;font:inherit;cursor:pointer;background:#fff;color:#15283c}.app-action-dialog #appDialogConfirm{background:#059669;border-color:#059669;color:#fff}.app-action-dialog button:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}`;
      document.head.append(style);
    }
    const dialog = document.createElement('dialog'); dialog.id = 'appActionDialog'; dialog.className = 'app-action-dialog';
    dialog.setAttribute('aria-labelledby', 'appDialogTitle'); dialog.setAttribute('aria-describedby', 'appDialogMessage');
    const heading = document.createElement('h2'); heading.id = 'appDialogTitle'; heading.textContent = title;
    const content = document.createElement('p'); content.id = 'appDialogMessage'; content.textContent = String(message);
    const actions = document.createElement('div'); actions.className = 'app-dialog-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.id = 'appDialogCancel'; cancel.textContent = cancelText;
    const confirm = document.createElement('button'); confirm.type = 'button'; confirm.id = 'appDialogConfirm'; confirm.textContent = confirmText;
    if (!notice) actions.append(cancel);
    actions.append(confirm); dialog.append(heading, content, actions); document.body.append(dialog);
    const previousFocus = document.activeElement;
    return new Promise((resolve, reject) => {
      cancel.addEventListener('click', () => dialog.close('cancel'));
      confirm.addEventListener('click', () => dialog.close('confirm'));
      dialog.addEventListener('close', () => {
        const accepted = dialog.returnValue === 'confirm'; dialog.remove(); active = false;
        document.dispatchEvent(new CustomEvent('app:dialog-change', { detail: { open: false } }));
        if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus();
        resolve(accepted);
      }, { once: true });
      try { dialog.showModal(); document.dispatchEvent(new CustomEvent('app:dialog-change', { detail: { open: true } })); (notice ? confirm : cancel).focus(); }
      catch (error) { dialog.remove(); active = false; reject(error); }
    });
  }
  window.confirmAction = (message, options) => show(message, options);
  window.showAppMessage = (message) => show(message, { title: 'แจ้งเตือน', confirmText: 'ปิด', notice: true });
})();
