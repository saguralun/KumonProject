import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { controlFixture } from './support/controlFixture.js';

const modules = ['student', 'enrollment', 'history', 'billing', 'at', 'dt', 'ws', 'worksheet-receive', 'cd', 'stock'];
function result(module, page = 1) {
  return { module, title: module, status: 'READY', serverPaginated: module === 'ws',
    summary: ['New', 'New Details', 'Updated'].map(label => ({ label, value: 1 })), validation: [{ label: 'Fixture', status: 'READY', errors: 0 }],
    columns: [{ key: 'name', label: 'Fixture row' }], rows: [{ name: `${module}-page-${page}`, import_action: 'INSERT' }],
    pagination: { page, pageSize: 50, totalRows: module === 'ws' ? 150 : 1, totalPages: module === 'ws' ? 3 : 1, pageSizeOptions: [20, 50, 100] } };
}

for (const embedded of [false, true]) test(`Migration uses one engine, previews every module, cancels imports and ignores obsolete pagination (${embedded ? 'desktop' : 'browser'})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000
}, async () => {
  const held = new Map(); let hold = false;
  async function waitHeld(number) {
    for (let attempt = 0; attempt < 200 && !held.has(number); attempt++) await delay(10);
    assert.ok(held.has(number), `Missing held page ${number}`);
  }
  const f = await controlFixture('migration', async (req, res) => {
    const match = req.path.match(/^\/migration\/([^/]+)\/preview$/);
    if (!match) return false;
    const module = match[1], page = Number(req.query.page) || 1;
    if (hold && module === 'ws') held.set(page, () => res.json(result(module, page)));
    else res.json(result(module, page));
    return true;
  }, { embedded });
  try {
    const { page } = f;
    await page.locator('#studentPreviewButton').waitFor();
    assert.equal(await page.locator('main.grid [data-migration-card]').count(), 10);
    assert.equal(await page.locator('#studentMigrationButton').count(), 0);
    assert.equal(await page.locator('script:not([src])').count(), 0);
    for (const module of modules) {
      await page.locator(`#${module}PreviewButton`).click();
      await page.waitForFunction(label => document.getElementById('previewContent').textContent.includes(label), `${module}-page-1`);
      const button = page.locator(`#${module}ImportButton`);
      if (await button.isEnabled()) { await button.click(); await f.choose(false); }
    }
    hold = true;
    await page.locator('#wsPreviewButton').click();
    await waitHeld(1);
    // The outstanding WS response must not switch back from the chosen Student tab.
    await page.locator('.preview-tab[data-module=student]').click();
    await page.waitForFunction(() => document.querySelector('.preview-tab.active')?.dataset.module === 'student');
    const firstResponse = page.waitForResponse(response => response.url().includes('/ws/preview'));
    held.get(1)(); held.delete(1); await firstResponse;
    assert.equal(await page.locator('.preview-tab.active').getAttribute('data-module'), 'student');
    await page.locator('.preview-tab[data-module=ws]').click();
    await page.locator('#previewContent').getByRole('button', { name: 'Next', exact: true }).click();
    await waitHeld(2);
    await page.evaluate(() => setPreviewPage('ws', 3));
    await waitHeld(3);
    held.get(3)(); held.delete(3);
    await page.waitForFunction(() => document.getElementById('previewContent').textContent.includes('ws-page-3'));
    const secondResponse = page.waitForResponse(response => response.url().includes('/ws/preview?page=2'));
    held.get(2)(); held.delete(2); await secondResponse;
    assert.match(await page.locator('#previewContent').innerText(), /ws-page-3/);
    assert.ok(f.writes().every(request => request.path.endsWith('/preview')));
    assert.deepEqual(f.errors, []);
  } finally { for (const release of held.values()) release(); await f.close(); }
});

for (const embedded of [false, true]) test(`Every Migration import button recovers a failed import, honors Student dependency and completes only its fixture (${embedded ? 'desktop' : 'browser'})`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000
}, async () => {
  let fail = true; const imports = [];
  const f = await controlFixture('migration', async (req, res) => {
    const preview = req.path.match(/^\/migration\/([^/]+)\/preview$/);
    if (preview) { res.json(result(preview[1])); return true; }
    const imported = req.path.match(/^\/migration\/([^/]+)\/import$/);
    if (!imported) return false;
    imports.push(imported[1]);
    if (fail) { fail = false; res.status(503).json({ message: 'Fixture import failed' }); }
    else res.json({ ...result(imported[1]), summary: [{ label: 'Inserted', value: 1 }] });
    return true;
  }, { embedded });
  try {
    const { page } = f;
    await page.locator('#enrollmentPreviewButton').click();
    await page.waitForFunction(() => document.getElementById('previewContent').textContent.includes('enrollment-page-1'));
    assert.equal(await page.locator('#enrollmentImportButton').isDisabled(), true);
    await page.locator('#studentPreviewButton').click();
    await page.locator('#studentImportButton:enabled').waitFor();
    await page.locator('#studentImportButton').click(); await f.choose(true);
    await page.waitForFunction(() => document.getElementById('previewContent').textContent.includes('Fixture import failed'));
    assert.equal(await page.locator('#studentPreviewButton').isEnabled(), true);
    for (const module of modules) {
      await page.locator(`#${module}PreviewButton`).click(); await page.locator(`#${module}ImportButton:enabled`).waitFor();
      await page.locator(`#${module}ImportButton`).click(); await f.choose(true);
      await page.waitForFunction(id => !document.getElementById(id).disabled, `${module}PreviewButton`);
      assert.equal(await page.locator(`#${module}ImportButton`).isDisabled(), true);
    }
    assert.deepEqual(imports, ['student', ...modules]);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
