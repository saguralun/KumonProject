// No drafts or secrets are persisted. Each page supplies its current dirty/busy
// state; native browser close/reload and app navigation share that decision.
(() => {
  const sources = new Map();
  let asking = false, allowed = false, allowanceTimer;
  let nativeCloseSupported = true;
  if (window.kumonDesktop) {
    // A running older desktop can reload new web files before it is restarted.
    // Its default Electron behavior silently blocks beforeunload; preserve its
    // old close behavior until the new main-process confirmation is available.
    if (typeof window.kumonDesktop.info !== 'function') nativeCloseSupported = false;
    else {
      const detectCloseSupport = () => Promise.resolve().then(() => window.kumonDesktop.info()).then(info => {
        // Only a successful response from a known desktop identifies a legacy
        // host. A provisional frame/IPC failure is unknown, not "unsupported".
        if (info?.embedded === true) nativeCloseSupported = info.leaveConfirmation === true;
      }).catch(() => {});
      void detectCloseSupport();
      window.addEventListener('load', detectCloseSupport, { once: true });
      window.addEventListener('focus', detectCloseSupport);
    }
  }

  function readState() {
    const dirty = [], busy = [];
    let uncertain = false;
    for (const [label, read] of sources) {
      try {
        const state = read() || {};
        if (state.dirty) dirty.push(label);
        if (state.busy) busy.push(label);
        uncertain ||= Boolean(state.uncertain);
      } catch { dirty.push(label); }
    }
    return { dirty: dirty.length > 0, busy: busy.length > 0, uncertain, labels: [...new Set([...dirty, ...busy])] };
  }

  async function confirmLeave() {
    if (asking) return false;
    const state = readState();
    if (!state.dirty && !state.busy) return true;
    asking = true;
    try {
      if (state.busy) {
        await showAppMessage(`กำลังบันทึกหรือรอผล (${state.labels.join(', ')}) กรุณารอให้ทราบผลก่อนออกจากหน้า`);
        return false;
      }
      const pending = state.uncertain ? '\nมีคำขอ DO ที่ยังไม่ทราบผล การออกจากหน้าไม่ยกเลิกคำขอเดิม กรุณาตรวจผลก่อนส่งซ้ำ' : '';
      return await confirmAction(`มีข้อมูลที่ยังไม่ได้บันทึก (${state.labels.join(', ')}) ออกจากหน้านี้และทิ้งค่าที่แก้ค้างใช่ไหม?${pending}`, {
        confirmText: 'ออกจากหน้า', cancelText: 'กลับไปทำงาน'
      });
    } finally { asking = false; }
  }

  function allowNextUnload() {
    allowed = true;
    clearTimeout(allowanceTimer);
    // A blocked/204 navigation must not leave the current form unprotected.
    allowanceTimer = setTimeout(() => { allowed = false; }, 2000);
  }

  function navigate(url) {
    allowNextUnload();
    window.location.assign(url);
  }

  window.kumonLeaveGuard = Object.freeze({
    register(label, read) { sources.set(label, read); return () => sources.delete(label); },
    readState, confirmLeave, allowNextUnload, navigate
  });

  window.addEventListener('beforeunload', event => {
    const state = readState();
    if (nativeCloseSupported && !allowed && (state.dirty || state.busy)) {
      event.preventDefault(); event.returnValue = '';
    }
  });
  window.addEventListener('pageshow', () => { allowed = false; });
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest?.('a[href]');
    if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    const url = new URL(link.href, window.location.href);
    if (url.origin !== window.location.origin || url.protocol !== window.location.protocol
        || (url.pathname === location.pathname && url.search === location.search)
        || url.pathname.startsWith('/api/')) return;
    const state = readState();
    if (!state.dirty && !state.busy) return;
    event.preventDefault();
    void confirmLeave().then(confirmed => { if (confirmed) navigate(url.href); });
  });
})();
