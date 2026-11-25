import assert from 'node:assert/strict';
import { test } from 'node:test';
import { studentStatusFixture } from './support/studentStatusFixture.js';
const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 40000 };

for (const embedded of [false, true]) {
  const surface = embedded ? 'desktop' : 'browser';
  test(`Absent displays actual billing period, retained start date and status before any write (${surface})`, ui, async () => {
    const f = await studentStatusFixture(embedded, 'C');
    try {
      await f.load(); const { page } = f;
      await page.locator('#enrollmentAbsentButton').click();
      await page.waitForFunction(() => !document.getElementById('enrollmentResumeSave').disabled);
      const text = await page.locator('#enrollmentStatusPreview').innerText();
      assert.match(text, /C → A/); assert.match(text, /8\/2026/); assert.match(text, /คงเดิม/); assert.match(text, /7\/2026/);
      assert.equal(f.writes().length, 0);
      await page.locator('#enrollmentResumeCancel').click(); assert.equal(f.writes().length, 0); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`Resume ignores an older date Preview and submits only the latest reviewed snapshot (${surface})`, ui, async () => {
    const f = await studentStatusFixture(embedded); let release;
    try {
      await f.load(); const { page } = f;
      await page.locator('#enrollmentResumeButton').click();
      f.config.holdDate = '2026-11-20'; f.config.hold = new Promise(resolve => { release = resolve; });
      const held = page.waitForRequest(req => req.url().includes('resumeDate=2026-11-20'));
      await page.locator('#enrollmentResumeDate').fill('2026-11-20'); await held;
      assert.equal(await page.locator('#enrollmentResumeSave').isDisabled(), true);
      await page.locator('#enrollmentResumeDate').fill('2026-11-21');
      await page.waitForFunction(() => !document.getElementById('enrollmentResumeSave').disabled);
      assert.match(await page.locator('#enrollmentStatusPreview').innerText(), /A → N/);
      assert.match(await page.locator('#enrollmentStatusPreview').innerText(), /12\/2026/);
      const response = page.waitForResponse(res => res.url().includes('resumeDate=2026-11-20'));
      release(); await (await response).finished();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.match(await page.locator('#enrollmentStatusPreview').innerText(), /A → N/);
      await page.locator('#enrollmentResumeSave').click();
      await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture status saved'));
      assert.deepEqual(f.writes().map(r => r.body), [{ action: 'resume', resumeDate: '2026-11-21', expectedPlan: 'preview-1-resume-2026-11-21' }]);
      assert.deepEqual(f.errors, []);
    } finally { release?.(); await f.close(); }
  });

  test(`Preview failure retries without saving and a changed snapshot requires another deliberate confirmation (${surface})`, ui, async () => {
    const f = await studentStatusFixture(embedded, 'C');
    try {
      await f.load(); const { page } = f; f.config.failRead = true;
      await page.locator('#enrollmentAbsentButton').click(); await page.locator('#enrollmentStatusPreviewRetry').waitFor();
      assert.match(await page.locator('#enrollmentStatusPreview').innerText(), /unavailable/);
      assert.equal(await page.locator('#enrollmentResumeSave').isDisabled(), true); assert.equal(f.writes().length, 0);
      f.config.failRead = false; await page.locator('#enrollmentStatusPreviewRetry').click();
      await page.waitForFunction(() => !document.getElementById('enrollmentResumeSave').disabled);
      f.config.staleOnce = true; await page.locator('#enrollmentResumeSave').click();
      await page.waitForFunction(() => !document.getElementById('enrollmentResumeSave').disabled && document.getElementById('enrollmentResumeError').textContent.includes('เปลี่ยนแล้ว'));
      assert.equal(f.writes().length, 1); assert.equal(await page.locator('#enrollmentResumeDialog').isVisible(), true);
      await page.locator('#enrollmentResumeSave').click();
      await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture status saved'));
      assert.deepEqual(f.writes().map(r => r.body.expectedPlan), ['preview-1-absent-null', 'preview-2-absent-null']); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });
}
