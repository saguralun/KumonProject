import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { controlFixture } from './support/controlFixture.js';

// Follow only scripts actually loaded by this page. Another page mentioning a
// button ID must not make an unwired control pass this inventory.
async function pageSources(page, origin) {
  const scripts = await page.locator('script').evaluateAll(items => items.map(item => ({ src: item.getAttribute('src'), text: item.textContent })));
  const visited = new Set(), sources = [], root = path.resolve('public');
  async function read(source, base) {
    sources.push(source);
    const imports = /\b(?:import|export)\s+(?:[^;'"`]*?\s+from\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(imports)) await visit(match[1] || match[2], base);
  }
  async function visit(href, base) {
    const url = new URL(href, base);
    if (url.origin !== origin || visited.has(url.pathname)) return;
    visited.add(url.pathname);
    const file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`), relative = path.relative(root, file);
    assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), `Script escapes public directory: ${href}`);
    await read(await fs.readFile(file, 'utf8'), url.href);
  }
  for (const script of scripts) {
    if (script.src) await visit(script.src, page.url());
    else await read(script.text, page.url());
  }
  for (const href of await page.locator('link[rel=stylesheet],link[rel=icon],img[src]').evaluateAll(items => items.map(item => item.getAttribute('href') || item.getAttribute('src')))) {
    const url = new URL(href, page.url());
    if (url.origin === origin) await fs.access(path.join(root, decodeURIComponent(url.pathname)));
  }
  return { source: sources.join('\n'), scripts: [...visited] };
}

test('All page button declarations have a code reference or an explicit form/inline action; shared scripts resolve locally', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000 }, async () => {
  const app = express(); app.get('/migration.html', (_req, res) => res.sendFile(path.resolve('migration/migrationCenter.html'))); app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
  try {
    const files = (await fs.readdir('public')).filter(name => name.endsWith('.html'));
    const inventory = [];
    const page = await browser.newPage({ javaScriptEnabled: false }); await page.route('https://**/*', route => route.abort());
    for (const name of [...files, 'migration.html']) {
      await page.goto(`http://127.0.0.1:${server.address().port}/${name}`);
      const ids = await page.locator('[id]').evaluateAll(items => items.map(item => item.id).filter(Boolean));
      assert.equal(new Set(ids).size, ids.length, `${name}: duplicate DOM identifiers can bind controls to the wrong element`);
      const controls = await page.locator('button,input[type=button],input[type=submit]').evaluateAll(items => items.map(element => ({ id: element.id, classes: [...element.classList], label: (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || element.value).trim(), inline: Boolean(element.getAttribute('onclick')), form: element.form?.id, dialogForm: element.form?.method === 'dialog', submit: element.type === 'submit' })));
      const { source, scripts } = await pageSources(page, `http://127.0.0.1:${server.address().port}`);
      for (const button of controls) {
        assert.ok(button.label || button.id, `${name}: unnamed button`);
        assert.ok(button.inline || (button.submit && (button.form || button.dialogForm)) || !button.id || source.includes(button.id) || button.classes.some(className => source.includes(`.${className}`)), `${name}: button ${button.id} is not referenced by this page's scripts`);
      }
      for (const script of await page.locator('script[src]').evaluateAll(items => items.map(item => item.getAttribute('src')).filter(src => src.startsWith('/js/')))) await fs.access(path.join('public', script.split('?')[0]));
      inventory.push({ page: name, count: controls.length, controls, scripts });
    }
    await fs.writeFile(path.join(os.tmpdir(), 'kumondb-button-inventory.json'), JSON.stringify({ note: 'Static button inventory; functional coverage is established by separate synthetic workflow tests.', pages: inventory }, null, 2));
    assert.equal(inventory.length, 17);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});

for (const embedded of [false, true]) test(`Migration setup cancellation and preview selection never run a destructive import (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 15000 }, async () => {
  const f = await controlFixture('migration', async () => false, { embedded });
  try {
    const { page } = f;
    await page.locator('#databaseSetupButton').click(); await page.locator('#appActionDialog').waitFor();
    assert.match(await page.locator('#appDialogMessage').innerText(), /ลบถาวร/);
    await f.choose(false); assert.equal(f.writes().length, 0);
    assert.equal(await page.locator('#databaseSetupButton').isEnabled(), true);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
