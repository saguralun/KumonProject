import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const role of ['admin', 'instructor', 'staff', 'guest']) test(`Student billing action visibility and confirmation for ${role}`, {
  skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
  const cancelled = [], student = { studentId: 1, displayName: 'Fixture Student', firstName: 'Fixture', lastName: 'Student' };
  const f = await controlFixture('student-manager', async (req, res) => {
    if (req.path === '/students/masters') res.json({ masters: { prefixes: [], genders: [], grades: [], subjects: [], statuses: [], levels: [], worksheets: [], schedules: [], dtMasters: [], studentHints: {}, addressRows: [] } });
    else if (req.path === '/students/search') res.json({ rows: [student] });
    else if (req.path === '/students/1') res.json({ student, enrollments: [] });
    else if (req.path === '/students/1/history') res.json({ type: req.query.type, columns: ['name'], rows: [{ name: 'Fixture bill', billingId: 77, enrollmentStatusId: 88 }] });
    else if (req.path === '/students/1/history/billing/77/cancel') { cancelled.push(req.path); res.json({ success: true, billingId: 77 }); }
    else return false;
    return true;
  });
  try {
    const { page } = f;
    await page.route('**/api/auth/me', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { role }, permissions: [] }) }));
    await page.reload();
    await page.waitForFunction(role => document.documentElement.dataset.role === role, role);
    await page.waitForFunction(() => document.getElementById('pageTitle').textContent.includes('Fixture Student'));
    await page.locator('[data-history=billing]').click();
    const button = page.locator('[data-cancel-billing-id="77"]'); await button.waitFor({ state: 'attached' });
    if (['admin', 'instructor'].includes(role)) {
      await button.waitFor({ state: 'visible' });
      await button.click(); await f.choose(false); assert.equal(cancelled.length, 0);
      await button.click(); await f.choose(true);
      await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('ยกเลิกบิลแล้ว'));
      assert.deepEqual(cancelled, ['/students/1/history/billing/77/cancel']);
    } else assert.equal(await button.isHidden(), true);
    await page.locator('[data-history=status]').click();
    const deleteStatus = page.locator('[data-delete-status-id="88"]'); await deleteStatus.waitFor({ state: 'attached' });
    assert.equal(await deleteStatus.isVisible(), role === 'admin');
    assert.ok(f.writes().every(request => request.path === '/students/1/history/billing/77/cancel'));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
