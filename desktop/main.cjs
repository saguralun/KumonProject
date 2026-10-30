const path = require('node:path');
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const { appOrigin, isKsisUrl, isWorkspaceUrl, isAppUrl, isStudentManagerUrl, clampBounds } = require('./security.cjs');

const origin = appOrigin(process.env.KUMON_APP_ORIGIN);
if (!process.env.KUMON_DESKTOP_PROFILE || !path.isAbsolute(process.env.KUMON_DESKTOP_PROFILE)) throw new Error('Missing isolated desktop profile');
app.setPath('userData', process.env.KUMON_DESKTOP_PROFILE);
const unified = process.env.KUMON_DESKTOP_MAIN === '1';
app.setName(unified ? 'KumonDB' : 'KumonDB K-sis');
app.setAppUserModelId('KumonDB.Desktop');
let window, ksis, bounds = null, visible = false;
let activeAccount = null, printing = false, ready = false;
let studentPreview = null;
const accountViews = new Map();
const securePreferences = { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true };

function isKsisSurface(url) {
  return isWorkspaceUrl(url, origin) || Boolean(studentPreview && studentPreview.userId === activeAccount && isStudentManagerUrl(url, origin));
}

function layout() {
  if (!window || window.isDestroyed() || !ksis || ksis.webContents.isDestroyed()) return;
  const size = window.getContentBounds();
  const rect = clampBounds(bounds, size);
  const show = visible && (!unified || activeAccount !== null) && rect && rect.width > 0 && rect.height > 0 && isKsisSurface(window.webContents.getURL());
  const wasVisible = ksis.getVisible();
  ksis.setVisible(Boolean(show));
  if (show) { ksis.setBounds(rect); if (!wasVisible) ksis.webContents.invalidate(); }
}

function trustedSender(event, workspaceOnly = true) {
  return window && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame
    && (workspaceOnly ? isKsisSurface(event.senderFrame.url) : isAppUrl(event.senderFrame.url, origin));
}

function secureRemoteSession(remoteSession) {
  remoteSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  remoteSession.setPermissionCheckHandler(() => false);
  remoteSession.on('will-download', (event) => event.preventDefault());
}

function createRemoteView(remoteSession) {
  const view = new WebContentsView({ webPreferences: { ...securePreferences, session: remoteSession } });
  window.contentView.addChildView(view); view.setVisible(false);
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  view.webContents.on('will-navigate', (event, url) => { if (!isKsisUrl(url)) event.preventDefault(); });
  view.webContents.on('will-redirect', (event, url) => { if (!isKsisUrl(url)) event.preventDefault(); });
  view.webContents.on('will-attach-webview', (event) => event.preventDefault());
  return view;
}

// Called only by the owning Node process through Electron's main-process channel.
module.exports.activateKsisAccount = async ({ userId, profileDirectory }) => {
  if (!unified || !Number.isSafeInteger(userId) || userId < 1 || !path.isAbsolute(profileDirectory)) throw new Error('Invalid desktop account');
  if (ksis) ksis.setVisible(false);
  let view = accountViews.get(userId);
  if (!view || view.webContents.isDestroyed()) {
    const remoteSession = session.fromPath(profileDirectory);
    secureRemoteSession(remoteSession);
    view = createRemoteView(remoteSession); accountViews.set(userId, view);
    await view.webContents.loadURL(`about:blank#kumon-ksis-${userId}`);
  }
  activeAccount = userId; ksis = view; layout();
  return { userId };
};
module.exports.activeKsisAccount = () => activeAccount;
module.exports.setStudentPreview = ({ userId, previewId, enabled }) => {
  if (enabled) {
    if (!unified || userId !== activeAccount || typeof previewId !== 'string') throw new Error('Invalid student preview');
    studentPreview = { userId, previewId };
  } else if (studentPreview?.userId === userId && studentPreview.previewId === previewId) {
    studentPreview = null;
    if (window && isStudentManagerUrl(window.webContents.getURL(), origin)) visible = false;
  }
  layout();
};
module.exports.isReady = () => ready;
app.kumonDesktopController = module.exports;

async function printHtml(event, html) {
  if (!trustedSender(event, false) || typeof html !== 'string' || html.length > 2_000_000 || printing) throw new Error('Print unavailable');
  printing = true;
  const view = new WebContentsView({ webPreferences: { ...securePreferences, javascript: false, partition: 'kumon-print' } });
  // The print document is local content only, with no access to app/KSIS sessions.
  view.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'file://*/*'] }, (_details, callback) => callback({ cancel: true }));
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  try {
    const policy = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">';
    await view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(policy + html)}`);
    return await new Promise((resolve, reject) => view.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
      if (success || /cancel/i.test(reason)) resolve({ printed: success });
      else reject(new Error(reason || 'Print failed'));
    }));
  } finally { view.webContents.close(); printing = false; }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    if (unified) {
      const ownerPid = Number(process.env.KUMON_DESKTOP_OWNER_PID);
      if (!Number.isSafeInteger(ownerPid) || ownerPid < 1) throw new Error('Missing desktop owner');
      // Do not leave an orphaned single-instance window after an authorized server restart.
      const ownerWatch = setInterval(() => {
        try { process.kill(ownerPid, 0); }
        catch (error) { if (error.code === 'ESRCH') app.quit(); }
      }, 150);
      ownerWatch.unref();
    }
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    if (!unified) {
      session.defaultSession.on('will-download', (event) => event.preventDefault());
      session.defaultSession.webRequest.onBeforeRequest({ urls: [`${origin}/api/auth/login/*`] }, (_details, callback) => callback({ cancel: true }));
    }
    window = new BrowserWindow({ width: 1600, height: 950, minWidth: 1000, minHeight: 650, title: 'KumonDB',
      backgroundColor: '#eef3f8', icon: path.join(__dirname, '../launcher/kumondb.ico'),
      webPreferences: { ...securePreferences, preload: path.join(__dirname, 'preload.cjs') } });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event, url) => {
      try {
        const destination = new URL(url);
        if (destination.origin !== origin) event.preventDefault();
        else if (!unified && destination.pathname === '/login.html') {
          event.preventDefault(); visible = false; layout();
          void window.loadFile(path.join(__dirname, 'session-ended.html'));
        }
      }
      catch { event.preventDefault(); }
    });
    window.webContents.on('did-start-navigation', (_event, _url, _inPlace, mainFrame) => { if (mainFrame) { visible = false; layout(); } });
    window.webContents.on('did-navigate', (_event, url) => {
      if (unified && new URL(url).pathname === '/login.html') activeAccount = null;
      layout();
    });
    await window.loadFile(path.join(__dirname, 'loading.html'));
    if (!unified) ksis = createRemoteView(session.defaultSession);
    window.on('resize', layout);
    window.on('closed', () => {
      for (const view of new Set([...accountViews.values(), ksis].filter(Boolean))) if (!view.webContents.isDestroyed()) view.webContents.close();
      app.quit();
    });
    ipcMain.handle('kumon:desktop-info', (event) => {
      if (!trustedSender(event, false)) throw new Error('Untrusted sender');
      return { embedded: true, unified };
    });
    ipcMain.handle('kumon:print-html', printHtml);
    ipcMain.on('kumon:ksis-bounds', (event, value) => {
      if (!trustedSender(event)) return;
      bounds = clampBounds(value, window.getContentBounds()); visible = value?.visible === true; layout();
    });
    if (ksis) await ksis.webContents.loadURL('about:blank');
    ready = true;
  });
}
app.on('window-all-closed', () => app.quit());
