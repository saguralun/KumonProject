import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

for (const view of ['draft', 'at']) test(`Shared ${view} identity changes invalidate the exact confirmation scope before any fill`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
  const period = { month: 10, year: 2026 }, fills = [], errors = [];
  const before = { level: { value: 'A' }, worksheet: { value: '10' }, used: { value: '0' }, status: { value: 'C' } };
  const rows = [1, 2].map(n => ({ id: `at-${n}`, key: `ws-${n}`, enrollmentId: n, name: `Fixture ${n}`, subject: 'ME',
    kumonId: n === 1 ? '7642650000001' : '', birthDate: '2019-01-01', targetBirthDate: '2019-01-01', targetName: `Fixture ${n}`,
    ready: true, outcome: 'ready', requiresIdentityConfirmation: n === 2, before,
    desired: view === 'draft' ? { level: 'A', worksheet: 20, used: 2, status: 'C' }
      : { date: '2026-10-10', level: 'A', time: 10, score: 90, group: 1 } }));
  const preview = { previewId: `fixture-${view}`, rows, period, page: 1, subject: 'ME', context: 'Fixture KSIS' };
  const tool = { preview, result: null, inspection: null, confirmed: [], pending: false, error: '', subject: 'ME', period };
  const snapshot = { instanceId: 'fixture-confirmation', revision: 1, activeView: view, busy: false, tools: { [view]: tool }, connection: { pendingDraft: false } };
  const app = express(); app.use(express.json());
  app.get('/api/auth/me', (_req, res) => res.json({ user: { role: 'admin' }, permissions: ['*'] }));
  app.get('/api/ksis/workspace', (_req, res) => res.json(snapshot));
  app.post(`/api/ksis/${view === 'draft' ? 'draft' : 'at'}/fill`, (req, res) => {
    fills.push(req.body); tool.preview = null; tool.result = { rows: [], pendingDraft: false, saved: true, message: 'Fixture saved', savedCount: 2, filled: 2, page: 1 };
    snapshot.revision++; res.json(tool.result);
  });
  app.use('/api', (_req, res) => res.json({ success: true, pendingDraft: false })); app.use(express.static('public'));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.route('https://**/*', route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html`);
    const prefix = view === 'draft' ? 'ksisDraft' : 'ksisAt';
    await page.locator(`#${prefix}Fill:enabled`).waitFor();
    await page.locator(`#${prefix}Fill`).click();
    await page.locator(`#${prefix}Dialog[open]`).waitFor();
    assert.match(await page.locator(`#${prefix}ConfirmText`).innerText(), /1 (รายวิชา|ผลสอบ)/);
    // Another window confirms a second identity under the SAME preview token.
    tool.confirmed = [view === 'draft' ? 'ws-2' : 'at-2']; snapshot.revision++;
    await page.waitForFunction(id => !document.getElementById(id).open, `${prefix}Dialog`);
    assert.equal(fills.length, 0);
    await page.locator(`#${prefix}Fill`).click();
    assert.match(await page.locator(`#${prefix}ConfirmText`).innerText(), /2 (รายวิชา|ผลสอบ)/);
    await page.locator(`#${prefix}Cancel`).click(); assert.equal(fills.length, 0);
    await page.locator(`#${prefix}Fill`).click(); await page.locator(`#${prefix}Confirm`).click();
    await page.waitForFunction(id => document.getElementById(id).disabled, `${prefix}Fill`);
    assert.equal(fills.length, 1);
    assert.equal(fills[0].previewId, preview.previewId);
    assert.deepEqual(fills[0].confirmedIdentityMatches, view === 'draft' ? [{ enrollmentId: 2, key: 'ws-2' }] : ['at-2']);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
