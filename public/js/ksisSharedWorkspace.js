export function createKsisSharedWorkspace({ applyContext, setStatus }) {
  const listeners = new Map();
  let revision = -1, instance = '', snapshot = null, fetching = false, ready = false;
  const notify = () => {
    if (!snapshot) return;
    applyContext(snapshot);
    for (const [view, listener] of listeners) {
      const tool = snapshot.tools[view];
      if (tool) listener(tool, { busy: snapshot.busy, active: snapshot.activeView === view, connection: snapshot.connection });
    }
  };
  async function refresh(force = false) {
    if (fetching) return;
    fetching = true;
    try {
      const data = await requestJson(`/api/ksis/workspace?after=${force ? -1 : revision}&instance=${encodeURIComponent(instance)}`);
      if (!Number.isInteger(data.revision) || !data.instanceId) return;
      ready = true;
      if (data.unchanged) {
        if (snapshot && data.connection && data.instanceId === instance && data.revision === revision && JSON.stringify(snapshot.connection) !== JSON.stringify(data.connection)) {
          snapshot.connection = data.connection; notify();
        }
        return;
      }
      if (data.instanceId === instance && data.revision < revision) return;
      instance = data.instanceId; revision = data.revision; snapshot = data; notify();
    } catch {
      // Existing tabs on an older server keep working; never turn a failed sync into permission to save.
    } finally { fetching = false; }
  }
  const timer = setInterval(() => { void refresh(); }, 1000);
  window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
  window.addEventListener('focus', () => { void refresh(true); });
  return { refresh,
    subscribe(view, listener) { listeners.set(view, listener); if (snapshot?.tools[view]) listener(snapshot.tools[view], { busy: snapshot.busy, active: snapshot.activeView === view, connection: snapshot.connection }); },
    async confirm(view, previewId, confirmed) {
      if (!ready) return;
      try { await requestJson('/api/ksis/workspace/confirm', { method: 'POST', body: JSON.stringify({ view, previewId, confirmed }) }); }
      catch (error) { setStatus(error.message, 'error'); }
      await refresh(true);
    }
  };
}
