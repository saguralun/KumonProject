// Version checks never install an update or interrupt work in progress.
export function startUpdateMonitor(onStatus, { isBusy = () => false, onCheckState = () => {} } = {}) {
  let pending = false, lastCheck = -Infinity, stopped = false;
  let lastSuccessAt = null;
  try {
    const stored = Number(sessionStorage.getItem('kumondb.update.last-success'));
    if (stored > 0 && stored <= Date.now()) lastSuccessAt = stored;
  } catch { /* Version feedback also works when browser storage is disabled. */ }
  const report = data => { if (!stopped) onCheckState({ ...data, lastSuccessAt }); };
  async function check({ force = false } = {}) {
    if (stopped || pending || document.hidden || isBusy() || !force && Date.now() - lastCheck < 60000) return;
    pending = true;
    lastCheck = Date.now();
    report({ checking: true });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/system/update-check', { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!response.ok || data.checked !== true || typeof data.upToDate !== 'boolean') throw new Error('Version check unavailable');
      if (!stopped) {
        lastSuccessAt = Date.now();
        try { sessionStorage.setItem('kumondb.update.last-success', String(lastSuccessAt)); } catch { /* Optional feedback cache only. */ }
        if (!isBusy()) onStatus(data);
        report({ checking: false, checked: true, upToDate: data.upToDate });
      }
    } catch {
      // Keep the last version badge, while explicitly marking the check stale.
      report({ checking: false, checked: false });
    } finally {
      clearTimeout(timeout);
      pending = false;
    }
  }
  const timer = setInterval(check, 5 * 60000);
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);
  document.addEventListener('app:menu-change', check);
  check();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('focus', check);
    window.removeEventListener('online', check);
    document.removeEventListener('visibilitychange', check);
    document.removeEventListener('app:menu-change', check);
  };
  stop.check = () => check({ force: true });
  return stop;
}
