import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { studentStatusFixture } from './support/studentStatusFixture.js';
import { controlFixture } from './support/controlFixture.js';
const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000 };

for (const embedded of [false, true]) test(`PC/tablet status Preview and offline feedback preserve visible primary controls (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
  const surface = embedded ? 'desktop' : 'browser';
  const bounds = async (page, selectors, width, height) => {
    for (const selector of selectors) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, selector);
    }
  };
  const status = await studentStatusFixture(embedded, 'C');
  try {
    await status.load(); const { page } = status;
    await page.locator('#enrollmentAbsentButton').click();
    await page.waitForFunction(() => !document.getElementById('enrollmentResumeSave').disabled);
    for (const [width, height] of [[1366, 768], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      await bounds(page, ['#enrollmentResumeDialog', '#enrollmentStatusPreview', '#enrollmentResumeSave', '#enrollmentResumeCancel'], width, height);
      await page.screenshot({ path: path.resolve(`logs/round8-status-${surface}-${width}.png`) });
    }
    assert.equal(status.writes().length, 0); assert.deepEqual(status.errors, []);
  } finally { await status.close(); }
  const login = await controlFixture('login', (req, res) => {
    if (req.path !== '/system/update-check') return false;
    res.status(503).json({ checked: false }); return true;
  }, { embedded });
  try {
    const { page } = login;
    await page.locator('#updateCheckStatus[data-stale="true"]').waitFor();
    for (const [width, height] of [[1366, 768], [1024, 768]]) {
      await page.setViewportSize({ width, height });
      await bounds(page, ['#updateCheckStatus', '#updateCheckRetry', '#adminSubmit'], width, height);
      await page.screenshot({ path: path.resolve(`logs/round8-offline-${surface}-${width}.png`) });
    }
    assert.equal(login.writes().length, 0); assert.deepEqual(login.errors, []);
  } finally { await login.close(); }
});
