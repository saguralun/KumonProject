const KSIS_ORIGIN = 'https://kao.ksis.kumon.com';

function appOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid local application origin');
  return url.origin;
}

function isKsisUrl(value) {
  try { const url = new URL(value); return url.origin === KSIS_ORIGIN && url.pathname.startsWith('/kth/') && !url.username && !url.password; }
  catch { return false; }
}

function isWorkspaceUrl(value, origin) {
  try { const url = new URL(value); return url.origin === origin && url.pathname === '/ksis.html'; }
  catch { return false; }
}

function isAppUrl(value, origin) {
  try { const url = new URL(value); return url.origin === origin && !url.username && !url.password; }
  catch { return false; }
}

function clampBounds(value, size) {
  if (!value || !['x', 'y', 'width', 'height'].every((key) => Number.isFinite(value[key]))) return null;
  const x = Math.max(0, Math.min(size.width, Math.round(value.x)));
  const y = Math.max(0, Math.min(size.height, Math.round(value.y)));
  return { x, y, width: Math.max(0, Math.min(size.width - x, Math.round(value.width))), height: Math.max(0, Math.min(size.height - y, Math.round(value.height))) };
}

module.exports = { appOrigin, isKsisUrl, isWorkspaceUrl, isAppUrl, clampBounds };
