import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { chromium } from 'playwright-core';

const fontUrl = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sarabun:wght@400;500;600;700&display=swap';
const fixtureCss = ['Inter', 'Sarabun'].map(family => `
  @font-face {
    font-family: '${family}'; font-style: normal; font-weight: 400 700;
    font-display: swap; src: url('https://fonts.gstatic.com/login-fixture.ttf') format('truetype');
    unicode-range: ${family === 'Inter' ? 'U+0000-00FF' : 'U+0E00-0E7F'};
  }
`).join('\n');

async function fixtureFont() {
  // Serve installed font bytes under the existing family names, entirely offline.
  const candidates = process.platform === 'win32'
    ? [path.join(process.env.WINDIR || 'C:/Windows', 'Fonts', 'tahoma.ttf')]
    : ['/System/Library/Fonts/Supplemental/Tahoma.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'];
  for (const candidate of candidates) {
    try { return await readFile(candidate); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  throw new Error('Login font fixture needs an installed Tahoma or DejaVu Sans font');
}

async function loginFixture(outcome, { javaScriptEnabled = true } = {}) {
  const app = express(), requests = [], errors = [], external = [], fontRequests = [];
  app.use(express.json());
  app.use('/api', (req, res) => {
    requests.push({ path: req.path, method: req.method, body: req.body });
    if (req.method === 'GET' && req.path === '/server-info') return res.json({ lanAddresses: [] });
    if (req.method === 'GET' && req.path === '/system/update-check') return res.json({ checked: true, upToDate: false, remoteMessage: 'Synthetic update' });
    if (req.method === 'GET' && req.path === '/system/runtime') return res.json({ instanceId: 'font-fixture', serverName: 'Synthetic server' });
    if (req.method === 'POST' && ['/auth/login/admin', '/auth/login/guest'].includes(req.path)) {
      if (req.body.username === 'synthetic-success') return res.json({ user: { role: 'admin' } });
      return res.status(401).json({ success: false, error: `Synthetic ${req.path.endsWith('admin') ? 'admin' : 'guest'} rejection` });
    }
    errors.push(`Unexpected API request: ${req.method} ${req.path}`);
    return res.status(500).json({ success: false, error: 'Unexpected fixture request' });
  });
  // A successful synthetic auth never loads the real workspace or its scripts.
  app.get('/worksheet.html', (_req, res) => res.send('<p>Synthetic login destination</p>'));
  app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser, releaseFonts, settled = false;
  const gate = new Promise(resolve => { releaseFonts = resolve; });
  const close = async () => {
    releaseFonts();
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  };
  try {
    const font = await fixtureFont();
    browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    const context = await browser.newContext({ javaScriptEnabled, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = route.request().url();
      if (new URL(url).origin === origin) return route.continue();
      if (url === fontUrl) {
        fontRequests.push(url);
        await gate;
        if (outcome === 'failed') await route.abort('failed');
        else await route.fulfill({ contentType: 'text/css', body: fixtureCss });
        settled = true;
        return;
      }
      if (url === 'https://fonts.gstatic.com/login-fixture.ttf') {
        return route.fulfill({ contentType: 'font/ttf', headers: { 'Access-Control-Allow-Origin': '*' }, body: font });
      }
      external.push(url);
      return route.abort();
    });
    return { page, origin, requests, errors, external, fontRequests, releaseFonts, settled: () => settled, close };
  } catch (error) { await close(); throw error; }
}

async function assertFontsApplied(page) {
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('link')].some(link =>
      link.href.startsWith('https://fonts.googleapis.com/css2') && link.sheet && link.media !== 'print');
  });
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('700 24px Inter', 'KumonDB')), true);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.login-title' });
    const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
    assert.ok(fonts.some(font => font.isCustomFont && font.glyphCount > 0), 'The title must render with the delivered font, not just declare its family');
  } finally { await session.detach(); }
}

for (const outcome of ['delayed', 'failed']) {
  test(`Login paints and remains interactive before ${outcome} Google Fonts CSS settles`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000
  }, async () => {
    const fixture = await loginFixture(outcome);
    try {
      const { page } = fixture;
      const fontRequested = page.waitForRequest(fontUrl);
      // Waiting for load here would conceal the render/script blocking regression.
      await page.goto(`${fixture.origin}/login.html`, { waitUntil: 'commit' });
      await fontRequested;
      await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0);
      await page.locator('#adminForm [name=username]').fill('synthetic-admin');
      await page.locator('#adminForm [name=password]').fill('fixture-password');
      await page.locator('#adminSubmit').click();
      await page.waitForFunction(() => document.getElementById('loginMessage').textContent === 'Synthetic admin rejection');
      assert.equal(await page.locator('#adminSubmit').isEnabled(), true);
      await page.locator('[data-tab=guest]').click();
      await page.locator('#guestForm [name=displayName]').fill('Synthetic guest');
      await page.locator('#guestForm [name=pin]').fill('0000');
      await page.locator('#guestSubmit').click();
      await page.waitForFunction(() => document.getElementById('loginMessage').textContent === 'Synthetic guest rejection');
      assert.equal(await page.locator('#guestSubmit').isEnabled(), true);
      await page.locator('#loginUpdateButton').click();
      await page.locator('#appActionDialog').waitFor();
      await page.locator('#appDialogCancel').click();
      await page.waitForFunction(() => !document.getElementById('appActionDialog'));
      assert.equal(fixture.settled(), false, 'All interactions must finish while font CSS is still held');
      assert.equal(await page.evaluate(() => document.fonts.size), 0);
      const stack = await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily);
      assert.match(stack, /Inter.*Sarabun.*Segoe UI.*Arial.*sans-serif/);
      assert.deepEqual(fixture.requests.filter(req => req.method === 'POST'), [
        { path: '/auth/login/admin', method: 'POST', body: { username: 'synthetic-admin', password: 'fixture-password' } },
        { path: '/auth/login/guest', method: 'POST', body: { displayName: 'Synthetic guest', pin: '0000' } }
      ]);

      const fontFinished = outcome === 'failed'
        ? page.waitForEvent('requestfailed', request => request.url() === fontUrl)
        : page.waitForResponse(fontUrl);
      fixture.releaseFonts();
      await fontFinished;
      await page.waitForLoadState('load');
      if (outcome === 'delayed') await assertFontsApplied(page);
      else assert.equal(await page.evaluate(() => document.fonts.size), 0);
      assert.equal(await page.locator('body').evaluate(element => getComputedStyle(element).fontFamily), stack);
      assert.equal(await page.locator('#guestForm [name=displayName]').inputValue(), 'Synthetic guest');
      assert.equal(await page.locator('#adminForm [name=username]').inputValue(), 'synthetic-admin');
      await page.locator('[data-tab=admin]').click();
      await page.locator('#adminForm [name=username]').fill('synthetic-success');
      await page.locator('#adminSubmit').click();
      await page.waitForURL(`${fixture.origin}/worksheet.html`);
      assert.equal(await page.locator('p').textContent(), 'Synthetic login destination');
      assert.deepEqual(fixture.fontRequests, [fontUrl]);
      assert.deepEqual(fixture.external, []);
      assert.deepEqual(fixture.errors, []);
    } finally { await fixture.close(); }
  });
}

test('Login retains its Google Fonts stylesheet with JavaScript disabled', {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 15000
}, async () => {
  const fixture = await loginFixture('delayed', { javaScriptEnabled: false });
  try {
    fixture.releaseFonts();
    await fixture.page.goto(`${fixture.origin}/login.html`);
    await assertFontsApplied(fixture.page);
    assert.equal(await fixture.page.locator('#adminSubmit').isVisible(), true);
    assert.deepEqual(fixture.external, []);
    assert.deepEqual(fixture.errors, []);
  } finally { await fixture.close(); }
});
