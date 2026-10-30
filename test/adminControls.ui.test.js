import assert from 'node:assert/strict';
import { test } from 'node:test';
import { controlFixture } from './support/controlFixture.js';

for (const embedded of [false, true]) {
  test(`Opening schedule create, toggle, refresh and delete recover errors and require confirmation (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    let fail = true, rows = [];
    const response = () => ({ success: true, weekdays: [{ id: 1, code: 'MON', name: 'Monday' }], summary: { weekdays: 1, slots: rows.length, activeSlots: rows.filter(row => row.isActive).length, inactiveSlots: rows.filter(row => !row.isActive).length }, schedulesByWeekday: [{ weekdayName: 'Monday', weekdayCode: 'MON', schedules: rows }] });
    const f = await controlFixture('opening-schedule', async (req, res) => {
      if (!req.path.startsWith('/system/opening-schedules')) return;
      if (req.method === 'POST' && req.path.endsWith('/active')) rows[0].isActive = req.body.isActive;
      else if (req.method === 'POST') {
        if (fail) { res.status(503).json({ success: false, error: 'Fixture schedule failed' }); return true; }
        assert.equal(req.body.startTime, '09:00'); rows = [{ id: 1, startTime: '09:00', endTime: req.body.endTime, usageCount: 0, isActive: true }];
      } else if (req.method === 'DELETE') rows = [];
      res.json(response()); return true;
    }, { embedded });
    try {
      const { page } = f;
      await page.locator('#weekdaySelect option[value="1"]').waitFor({ state: 'attached' });
      await page.locator('#durationSelect').selectOption('30');
      await page.locator('#startTime').fill('09:00'); await page.locator('#startTime').dispatchEvent('input');
      assert.match(await page.locator('#endTime').inputValue(), /^09:/);
      await page.locator('#addScheduleButton').click(); await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture schedule failed'));
      assert.equal(await page.locator('#addScheduleButton').isEnabled(), true);
      fail = false; await page.locator('#addScheduleButton').click(); await page.locator('[data-toggle-id="1"]').waitFor();
      await page.locator('label.switch').click(); await page.waitForFunction(() => document.getElementById('inactiveCount').textContent === '1');
      await page.locator('#refreshButton').click(); await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'พร้อมใช้งาน');
      const before = f.writes().length;
      await page.locator('[data-delete-id="1"]').click(); await f.choose(false); assert.equal(f.writes().length, before);
      await page.locator('[data-delete-id="1"]').click(); await f.choose(true); await page.locator('[data-delete-id="1"]').waitFor({ state: 'detached' });
      assert.equal(f.writes().at(-1).method, 'DELETE'); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
  });

  test(`Role permission controls serialize a role's changes and restore failed toggles (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    let release, fail = false, grants = [], hold = true;
    const roles = [{ role_code: 'admin', role_name: 'Admin', is_system: true, active_user_count: 1 }, { role_code: 'staff', role_name: 'Staff', is_system: true, active_user_count: 1 }, { role_code: 'custom', role_name: 'Custom', is_system: false, active_user_count: 0 }];
    const f = await controlFixture('users', async (req, res) => {
      if (req.path === '/users') { res.json({ success: true, users: [] }); return true; }
      if (req.path === '/roles') { res.json({ success: true, roles, grants, permissions: ['page:report', 'page:stock'].map(permission_key => ({ permission_key, permission_label: permission_key, nav_group: 'management' })) }); return true; }
      if (req.path === '/roles/staff/permissions') {
        if (hold) await new Promise(resolve => { release = resolve; });
        if (fail) res.status(503).json({ success: false, error: 'Fixture permission failed' });
        else { grants = req.body.permissionKeys.map(permission_key => ({ role_code: 'staff', permission_key })); res.json({ success: true }); }
        return true;
      }
      if (req.path === '/roles/custom' && req.method === 'DELETE') { roles.pop(); res.json({ success: true }); return true; }
    }, { embedded });
    try {
      const { page } = f, first = page.locator('input[data-role-code=staff][data-permission-key="page:report"]'), second = page.locator('input[data-role-code=staff][data-permission-key="page:stock"]');
      await first.waitFor(); await first.check();
      assert.equal(await second.isDisabled(), true);
      release(); await second.waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.querySelector('input[data-role-code=staff]').disabled);
      hold = false; await second.check(); await page.waitForFunction(() => !document.querySelector('input[data-role-code=staff]').disabled);
      assert.deepEqual(new Set(f.writes().at(-1).body.permissionKeys), new Set(['page:report', 'page:stock']));
      fail = true; await first.uncheck(); await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Fixture permission failed'));
      assert.equal(await first.isChecked(), true); assert.equal(await second.isChecked(), true);
      await page.locator('.matrix-delete-role[data-role-code=custom]').click(); await f.choose(false);
      const count = f.writes().length;
      await page.locator('.matrix-delete-role[data-role-code=custom]').click(); await f.choose(true);
      await page.locator('.matrix-delete-role[data-role-code=custom]').waitFor({ state: 'detached' });
      assert.equal(f.writes().length, count + 1); assert.deepEqual(f.errors, []);
    } finally { release?.(); await f.close(); }
  });

  test(`Backup and restore controls validate the database name, cancel safely, block duplicate restore and recover rejection (${embedded ? 'desktop' : 'browser'})`, { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    let fail = true, release, hold = false;
    const f = await controlFixture('backup', async (req, res) => {
      if (req.path === '/backup/list') { res.json({ success: true, dbName: 'fixture_only', backupDir: 'fixture', backups: [{ filename: 'fixture.backup', sizeBytes: 100, createdAt: '2026-10-23' }] }); return true; }
      if (req.path === '/backup/run') { res.json({ success: true, backup: { filename: 'fixture.backup' } }); return true; }
      if (req.path === '/backup/download/fixture.backup') { res.attachment('fixture.backup').send('synthetic data only'); return true; }
      if (req.path === '/backup/import') {
        assert.equal(req.query.confirmDbName, 'fixture_only');
        if (hold) await new Promise(resolve => { release = resolve; });
        if (fail) res.status(503).json({ success: false, error: 'Fixture restore failed' });
        else res.json({ success: true, preImportBackup: { filename: 'fixture-before.backup' } });
        return true;
      }
    }, { embedded });
    try {
      const { page } = f;
      await page.locator('#backupListWrap a').waitFor();
      const downloading = page.waitForEvent('download'); await page.locator('#backupListWrap a').click(); const download = await downloading;
      assert.equal(download.suggestedFilename(), 'fixture.backup'); await f.downloadsIdle(); await download.delete();
      await page.locator('#runBackupButton').click(); await page.waitForFunction(() => document.getElementById('exportMessage').textContent.includes('สำเร็จ'));
      await page.locator('#importFile').setInputFiles({ name: 'fixture.backup', mimeType: 'application/octet-stream', buffer: Buffer.from('synthetic fixture only') });
      await page.locator('#importConfirmText').fill('wrong'); assert.equal(await page.locator('#importSubmit').isDisabled(), true);
      await page.locator('#importConfirmText').fill('fixture_only'); await page.locator('#importSubmit').click(); await f.choose(false);
      assert.equal(f.writes().length, 1);
      await page.locator('#importSubmit').click(); await f.choose(true); await page.waitForFunction(() => document.getElementById('importMessage').textContent.includes('Fixture restore failed'));
      assert.equal(await page.locator('#importSubmit').isEnabled(), true);
      fail = false; hold = true; await page.locator('#importSubmit').click(); await f.choose(true);
      assert.equal(await page.locator('#importFile').isDisabled(), true); assert.equal(await page.locator('#runBackupButton').isDisabled(), true);
      await page.locator('#importForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(f.writes().length, 3); release();
      await page.waitForFunction(() => document.getElementById('importMessage').textContent.includes('Restore สำเร็จ'));
      assert.equal(await page.locator('#importSubmit').isDisabled(), true); assert.deepEqual(f.errors, []);
    } finally { release?.(); await f.close(); }
  });
}
