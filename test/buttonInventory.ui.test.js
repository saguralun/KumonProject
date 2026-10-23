import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright-core';
import { controlFixture } from './support/controlFixture.js';

test('All page button declarations have a code reference or an explicit form/inline action; shared scripts resolve locally', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000 }, async () => {
  const app = express(); app.get('/migration.html', (_req, res) => res.sendFile(path.resolve('migration/migrationCenter.html'))); app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
  try {
    const files = (await fs.readdir('public')).filter(name => name.endsWith('.html'));
    const code = [];
    const readScripts = async directory => { for (const item of await fs.readdir(directory, { withFileTypes: true })) { const name = path.join(directory, item.name); if (item.isDirectory()) await readScripts(name); else if (name.endsWith('.js')) code.push(await fs.readFile(name, 'utf8')); } };
    await readScripts('public/js'); code.push(await fs.readFile('migration/migrationCenter.html', 'utf8'));
    const source = code.join('\n'), inventory = [];
    const page = await browser.newPage({ javaScriptEnabled: false }); await page.route('https://**/*', route => route.abort());
    for (const name of [...files, 'migration.html']) {
      await page.goto(`http://127.0.0.1:${server.address().port}/${name}`);
      const ids = await page.locator('[id]').evaluateAll(items => items.map(item => item.id).filter(Boolean));
      assert.equal(new Set(ids).size, ids.length, `${name}: duplicate DOM identifiers can bind controls to the wrong element`);
      const controls = await page.locator('button,input[type=button],input[type=submit]').evaluateAll(items => items.map(element => ({ id: element.id, label: (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || element.value).trim(), inline: Boolean(element.getAttribute('onclick')), form: element.form?.id, dialogForm: element.form?.method === 'dialog', submit: element.type === 'submit' })));
      const pageSource = name === 'migration.html' ? '' : await fs.readFile(`public/${name}`, 'utf8');
      for (const button of controls) {
        assert.ok(button.label || button.id, `${name}: unnamed button`);
        assert.ok(button.inline || (button.submit && (button.form || button.dialogForm)) || !button.id || source.includes(button.id) || pageSource.includes(`getElementById("${button.id}")`), `${name}: unreferenced button ${button.id}`);
      }
      for (const script of await page.locator('script[src]').evaluateAll(items => items.map(item => item.getAttribute('src')).filter(src => src.startsWith('/js/')))) await fs.access(path.join('public', script.split('?')[0]));
      inventory.push({ page: name, count: controls.length, controls });
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
