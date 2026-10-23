// Version checks never install an update or interrupt work in progress.
export function startUpdateMonitor(onStatus, { isBusy = () => false } = {}) {
  let pending = false, lastCheck = -Infinity, stopped = false;
  async function check() {
    if (stopped || pending || document.hidden || isBusy() || Date.now() - lastCheck < 60000) return;
    pending = true;
    lastCheck = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/system/update-check', { cache: 'no-store', signal: controller.signal });
      const data = await response.json();
      if (!stopped && !isBusy() && response.ok && data.checked === true && typeof data.upToDate === 'boolean') onStatus(data);
    } catch {
      // Keep an existing update notice while offline; retry on the next check.
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
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('focus', check);
    window.removeEventListener('online', check);
    document.removeEventListener('visibilitychange', check);
    document.removeEventListener('app:menu-change', check);
  };
}
