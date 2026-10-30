import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApplicationDesktop } from '../../services/ksisDesktop.js';

export async function controlFixture(pageName, handle, { embedded = false } = {}) {
  const requests = [], errors = [], app = express(); app.use(express.json());
  app.get('/migration.html', (_req, res) => res.sendFile(path.resolve('migration/migrationCenter.html')));
  app.get('/api/auth/me', (_req, res) => res.json({ user: { role: 'admin', displayName: 'Controls fixture' }, permissions: ['*'] }));
  app.use('/api', async (req, res) => {
    requests.push({ path: req.path, method: req.method, body: req.body });
    try {
      if (await handle(req, res)) return;
      assert.equal(req.method, 'GET', `Unexpected fixture write ${req.method} ${req.path}`);
      res.json({ success: true, rows: [], checked: false });
    } catch (error) { errors.push(error.message); res.status(500).json({ success: false, error: error.message }); }
  });
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://localhost:${server.address().port}`, root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumon-controls-fixture-'));
  let desktop, browser, page;
  if (embedded) {
    desktop = await createApplicationDesktop({ origin, profileDirectory: root, downloadDirectory: path.join(root, 'saved-downloads'), startPath: `/${pageName}.html`, configureContext: context => context.route('https://**/*', route => route.abort()) });
    page = desktop.main;
  } else {
    browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.route('https://**/*', route => route.abort());
    await page.goto(`${origin}/${pageName}.html`);
  }
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(5000);
  await page.evaluate(() => { window.confirm = () => { throw Error('Native confirmation forbidden'); }; window.prompt = () => { throw Error('Native prompt forbidden'); }; });
  return { page, origin, requests, errors, desktop,
    downloadsIdle: () => desktop?.downloadsIdle(), downloadDirectory: path.join(root, 'saved-downloads'),
    writes: () => requests.filter(request => !['GET', 'HEAD'].includes(request.method)),
    choose: async accepted => { await page.locator(accepted ? '#appDialogConfirm' : '#appDialogCancel').click(); },
    close: async () => {
      await desktop?.application.close(); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
      if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.rm(root, { recursive: true, force: true });
    }
  };
}
