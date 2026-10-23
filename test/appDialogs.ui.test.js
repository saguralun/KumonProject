import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { createApplicationDesktop } from '../services/ksisDesktop.js';

for (const embedded of [false, true]) test(`Shared confirmations require an explicit choice, escape text, reject duplicate requests and restore focus (${embedded ? 'desktop' : 'browser'})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
  const app = express(); app.use(express.static('public'));
  app.get('/fixture', (_req, res) => res.send('<script src="/js/appDialogs.js"></script><button id="action" onclick="confirmAction(\'fixture &lt;script&gt; markup\').then(ok=>window.accepted=ok)">Action</button>'));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = `http://localhost:${server.address().port}`, root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumon-dialog-fixture-'));
  let browser, desktop;
  try {
    let page;
    if (embedded) { desktop = await createApplicationDesktop({ origin, profileDirectory: root, startPath: '/fixture' }); page = desktop.main; }
    else { browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true }); page = await browser.newPage({ viewport: { width: 390, height: 844 } }); await page.goto(`${origin}/fixture`); }
    await page.evaluate(() => { window.confirm = () => { throw Error('Native confirm forbidden'); }; });
    await page.locator('#action').click();
    assert.equal(await page.locator('#appDialogCancel').evaluate(e => e === document.activeElement), true);
    assert.equal(await page.locator('#appDialogMessage').innerText(), 'fixture <script> markup');
    assert.equal(await page.locator('#appActionDialog script').count(), 0);
    assert.equal(await page.evaluate(() => confirmAction('duplicate')), false);
    await page.keyboard.press('Escape'); assert.equal(await page.evaluate(() => window.accepted), false);
    assert.equal(await page.locator('#action').evaluate(e => e === document.activeElement), true);
    await page.locator('#action').click(); await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.accepted), false);
    await page.locator('#action').click();
    const bounds = await page.locator('#appActionDialog').boundingBox();
    const width = await page.evaluate(() => innerWidth); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width);
    await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-shared-confirm-${embedded}.png`) });
    await page.locator('#appDialogConfirm').click(); assert.equal(await page.evaluate(() => window.accepted), true);
    await page.evaluate(() => { void showAppMessage('Fixture failure'); });
    assert.equal(await page.locator('#appDialogCancel').count(), 0);
    await page.locator('#appDialogConfirm').click(); assert.equal(await page.locator('#appActionDialog').count(), 0);
  } finally {
    await desktop?.application.close(); await browser?.close(); await new Promise(resolve => server.close(resolve));
    const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.rm(root, { recursive: true, force: true });
  }
});

test('Every application page loads shared dialogs and no production action uses native confirm, prompt or alert', async () => {
  const pages = (await fs.readdir('public')).filter(name => name.endsWith('.html'));
  for (const file of [...pages.map(name => `public/${name}`), 'migration/migrationCenter.html']) {
    const source = await fs.readFile(file, 'utf8');
    assert.ok(source.includes('/js/appDialogs.js?'), `${file}: shared confirmations available`);
    assert.doesNotMatch(source, /\b(?:window\.)?(?:confirm|prompt|alert)\s*\(/, file);
  }
  const inspect = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await inspect(file);
      else if (entry.name.endsWith('.js')) assert.doesNotMatch(await fs.readFile(file, 'utf8'), /\bwindow\.(?:confirm|prompt|alert)\s*\(/, file);
    }
  };
  await inspect('public/js');
});
