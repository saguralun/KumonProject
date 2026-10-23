export function setupKsisDesktop({ setStatus }) {
  const get = (id) => document.getElementById(id);
  const launch = get('ksisDesktopOpen');
  const root = document.querySelector('.ksis-page');
  function showLauncher(embedded) {
    root.classList.add('ksis-browser-launcher');
    launch.textContent = embedded ? 'กลับไปยัง K-sis ในแอป' : 'เปิด K-sis ในแอป';
    get('ksisDesktopStatus').textContent = embedded ? 'เปิด K-sis ในแอปอยู่แล้ว' : 'ยังไม่ได้เปิด K-sis ในแอป';
  }
  launch.addEventListener('click', async () => {
    launch.disabled = true; get('ksisDesktopStatus').textContent = 'กำลังเปิด K-sis ในแอป...';
    try {
      await requestJson('/api/ksis/desktop/open', { method: 'POST', body: '{}' });
      if (!window.kumonDesktop) showLauncher(true);
      else { get('ksisDesktopLaunch').classList.add('hidden'); get('ksisDesktopStatus').textContent = ''; setStatus('พร้อมใช้งาน'); }
    } catch (error) { get('ksisDesktopStatus').textContent = error.message; setStatus(error.message, 'error'); }
    finally { launch.disabled = false; }
  });
  if (!window.kumonDesktop) {
    const check = async () => {
      try {
        const status = await requestJson('/api/ksis/desktop/status');
        if (typeof status.embedded === 'boolean') showLauncher(status.embedded);
      } catch { /* Keep an unavailable status from authorizing any action. */ }
    };
    void check(); window.addEventListener('focus', check);
    return;
  }
  async function connectUnifiedDesktop() {
    try {
      const info = await window.kumonDesktop.info();
      if (!info.unified) return;
      await requestJson('/api/ksis/desktop/open', { method: 'POST', body: '{}' });
    } catch (error) {
      get('ksisDesktopLaunch').classList.remove('hidden');
      get('ksisDesktopStatus').textContent = error.message;
      setStatus(error.message, 'error');
    }
  }
  root.classList.add('ksis-embedded');
  get('ksisDesktopLaunch').classList.add('hidden');
  get('ksisBrowserPane').classList.remove('hidden');
  const slot = get('ksisBrowserSlot');
  let scheduled = false;
  const update = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      const rect = slot.getBoundingClientRect();
      window.kumonDesktop.setKsisBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        visible: !document.querySelector('dialog[open]') && !document.querySelector('.app-menu-open') && document.visibilityState === 'visible' });
    });
  };
  new ResizeObserver(update).observe(slot);
  new MutationObserver(update).observe(document.querySelector('.ksis-page'), { subtree: true, attributes: true, attributeFilter: ['class', 'open'] });
  window.addEventListener('resize', update); document.addEventListener('visibilitychange', update);
  document.addEventListener('app:dialog-change', update);
  get('ksisOpenReportB').addEventListener('click', async () => {
    const button = get('ksisOpenReportB'); button.disabled = true;
    try { await requestJson('/api/ksis/desktop/report-b', { method: 'POST', body: '{}' }); }
    catch (error) { setStatus(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  update();
  void connectUnifiedDesktop();
}
