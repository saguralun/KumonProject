import assert from 'node:assert/strict';
import { test } from 'node:test';
import pool from '../config/db.js';
import { controlFixture } from './support/controlFixture.js';

const ui = { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 45000 };
const roles = [{ role_code: 'admin', role_name: 'Admin', is_system: true }, { role_code: 'staff', role_name: 'Staff', is_system: true }];
const catalog = ['page:stock', 'page:report'].map(permission_key => ({ permission_key, permission_label: permission_key, nav_group: 'management' }));

test('Two independent admin pages cannot overwrite a revoked grant; latest values require deliberate review', ui, async t => {
    let grants = ['page:stock'];
    const roleService = await import('../services/roleService.js?two-admin-pages');
    t.mock.method(pool, 'query', async sql => {
        if (sql.includes('role_master')) return { rows: [{ role_code: 'staff' }] };
        if (sql.includes('role_permission')) return { rows: grants.map(permission_key => ({ role_code: 'staff', permission_key })) };
        assert.fail(sql);
    });
    t.mock.method(pool, 'connect', async () => {
        let working = null;
        return { release() {}, async query(sql, values = []) {
            if (['BEGIN', 'ROLLBACK'].includes(sql)) { working = null; return { rows: [] }; }
            if (sql === 'COMMIT') { if (working) grants = working; return { rows: [] }; }
            if (sql.includes('DELETE FROM role_permission')) { working = []; return { rows: [] }; }
            if (sql.includes('INSERT INTO role_permission')) { working = values.slice(1); return { rows: [] }; }
            if (sql.includes('role_master')) return { rows: [{ role_code: 'staff' }] };
            if (sql.includes('role_permission')) return { rows: (working || grants).map(permission_key => ({ permission_key })) };
            assert.fail(sql);
        } };
    });
    const f = await controlFixture('users', async (req, res) => {
        if (req.path === '/users') { res.json({ users: [] }); return true; }
        if (req.path === '/roles') { res.json({ roles, permissions: catalog, grants: grants.map(permission_key => ({ role_code: 'staff', permission_key })) }); return true; }
        if (req.path === '/roles/staff/permissions') {
            try { res.json({ permissions: await roleService.setRolePermissions('staff', req.body.permissionKeys, req.body.expectedPermissionKeys) }); }
            catch (error) { res.status(error.statusCode || 500).json({ error: error.message }); }
            return true;
        }
        return false;
    });
    const other = await f.page.context().browser().newContext();
    try {
        await other.route('https://**/*', route => route.abort());
        const b = await other.newPage(); await b.goto(f.origin + '/users.html');
        const checkbox = (page, key) => page.locator(`[data-role-code="staff"][data-permission-key="${key}"]`);
        await checkbox(f.page, 'page:stock').waitFor(); await checkbox(b, 'page:stock').waitFor();
        await checkbox(f.page, 'page:stock').uncheck();
        await f.page.waitForFunction(() => !document.querySelector('[data-role-code=staff]').disabled);
        await checkbox(b, 'page:report').click();
        await b.waitForFunction(() => !document.querySelector('[data-role-code=staff]').disabled);
        assert.deepEqual(grants, [], 'Stale machine B must not restore stock access');
        assert.equal(await checkbox(b, 'page:stock').isChecked(), false);
        assert.equal(await checkbox(b, 'page:report').isChecked(), false);
        assert.match(await b.locator('#statusLine').innerText(), /ล่าสุด|อีกเครื่อง|เปลี่ยนแล้ว/);
        await checkbox(b, 'page:report').check();
        await b.waitForFunction(() => !document.querySelector('[data-role-code=staff]').disabled);
        assert.deepEqual(grants, ['page:report']);
        await f.page.reload(); await checkbox(f.page, 'page:report').waitFor();
        assert.equal(await checkbox(f.page, 'page:report').isChecked(), true);
        assert.equal(await checkbox(f.page, 'page:stock').isChecked(), false);
        assert.deepEqual(f.errors, []);
    } finally { await other.close(); await f.close(); }
});

for (const embedded of [false, true]) test(`Password reset is a separate target-bound action and retains account role/activation (${embedded ? 'desktop' : 'browser'})`, ui, async () => {
    let release, started;
    const arrived = new Promise(resolve => { started = resolve; });
    const accounts = [{ user_id: 11, username: 'admin-only', display_name: 'Admin only', role: 'admin', is_active: true },
        { user_id: 22, username: 'inactive-staff', display_name: 'Keep original', role: 'staff', is_active: false }];
    const f = await controlFixture('users', async (req, res) => {
        if (req.path === '/users') { res.json({ users: accounts }); return true; }
        if (req.path === '/roles') { res.json({ roles, permissions: catalog, grants: [] }); return true; }
        if (req.path === '/users/22/password') { started(); await new Promise(resolve => { release = resolve; }); res.json({ success: true }); return true; }
        return false;
    }, { embedded });
    try {
        const { page } = f;
        await page.locator('tr[data-user-id="22"]').waitFor();
        assert.equal(await page.locator('[data-action="reset-password"]').count(), 2);
        assert.doesNotMatch(await page.locator('.create-panel').innerText(), /สร้าง\s*\/\s*รีเซ็ต/);
        await page.locator('tr[data-user-id="22"] [data-action="reset-password"]').click();
        assert.equal(await page.locator('#resetPasswordUsername').inputValue(), 'inactive-staff');
        assert.equal(await page.locator('#resetPasswordForm [name=role]').count(), 0);
        await page.locator('#resetPasswordValue').fill('only-fixture-password');
        await page.locator('#resetPasswordCancel').click(); assert.equal(f.writes().length, 0);
        assert.equal(await page.locator('#resetPasswordValue').inputValue(), '');
        await page.locator('tr[data-user-id="22"] [data-action="reset-password"]').click();
        await page.locator('#resetPasswordValue').fill('short');
        await page.locator('#resetPasswordForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(f.writes().length, 0);
        assert.match(await page.locator('#resetPasswordMessage').innerText(), /6/);
        await page.locator('#resetPasswordValue').fill('only-fixture-password');
        await page.locator('#resetPasswordSubmit').click(); await arrived;
        assert.equal(await page.locator('#resetPasswordCancel').isDisabled(), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#resetPasswordDialog').evaluate(dialog => dialog.open), true);
        await page.locator('#resetPasswordForm').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(f.writes().length, 1);
        release(); await page.waitForFunction(() => !document.getElementById('resetPasswordDialog').open);
        assert.deepEqual(f.writes(), [{ path: '/users/22/password', method: 'POST', body: { password: 'only-fixture-password' } }]);
        assert.equal(await page.locator('#resetPasswordValue').inputValue(), '');
        assert.match(await page.locator('tr[data-user-id="22"]').innerText(), /Inactive/);
        assert.equal(await page.locator('tr[data-user-id="22"] select').inputValue(), 'staff');
        assert.deepEqual(f.errors, []);
    } finally { release?.(); await f.close(); }
});

test('Password reset errors keep the target for retry; Escape clears the secret and never changes permissions', ui, async () => {
    let fail = true;
    const f = await controlFixture('users', async (req, res) => {
        if (req.path === '/users') { res.json({ users: [{ user_id: 22, username: 'target-only', display_name: 'Target', role: 'staff', is_active: true }] }); return true; }
        if (req.path === '/roles') { res.json({ roles, permissions: catalog, grants: [] }); return true; }
        if (req.path === '/users/22/password') { res.status(fail ? 503 : 200).json(fail ? { error: 'Synthetic reset failure' } : { success: true }); return true; }
        return false;
    });
    try {
        const { page } = f;
        await page.locator('[data-action="reset-password"]').click();
        await page.locator('#resetPasswordValue').fill('synthetic-retry');
        await page.locator('#resetPasswordSubmit').click();
        await page.locator('#resetPasswordMessage').waitFor({ state: 'visible' });
        assert.match(await page.locator('#resetPasswordMessage').innerText(), /Synthetic reset failure/);
        assert.equal(await page.locator('#resetPasswordSubmit').isEnabled(), true);
        assert.equal(await page.locator('#resetPasswordValue').inputValue(), 'synthetic-retry');
        fail = false;
        await page.locator('#resetPasswordSubmit').click();
        await page.waitForFunction(() => !document.getElementById('resetPasswordDialog').open);
        assert.equal(await page.locator('#resetPasswordValue').inputValue(), '');
        assert.equal(f.writes().length, 2);
        assert.equal(f.writes().every(write => write.path === '/users/22/password'), true);
        await page.locator('[data-action="reset-password"]').click();
        await page.locator('#resetPasswordValue').fill('cancel-secret');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.getElementById('resetPasswordDialog').open);
        assert.equal(await page.locator('#resetPasswordValue').inputValue(), '');
        assert.equal(f.writes().length, 2); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

test('Creating an account, changing its role and toggling activation use separate actions on the Users page', ui, async () => {
    const accounts = [{ user_id: 11, username: 'admin-only', display_name: 'Admin', role: 'admin', is_active: true }];
    const f = await controlFixture('users', async (req, res) => {
        if (req.path === '/roles') { res.json({ roles, permissions: catalog, grants: [] }); return true; }
        if (req.path === '/users') {
            if (req.method === 'POST') {
                if (accounts.some(account => account.username === req.body.username)) { res.status(409).json({ error: 'Synthetic duplicate username' }); return true; }
                accounts.push({ user_id: 22, username: req.body.username, display_name: req.body.displayName, role: req.body.role, is_active: true });
            }
            res.json({ users: accounts }); return true;
        }
        if (req.path === '/users/22/role') { accounts[1].role = req.body.role; res.json({ success: true }); return true; }
        if (req.path === '/users/22/active') { accounts[1].is_active = req.body.isActive; res.json({ success: true }); return true; }
        return false;
    });
    try {
        const { page } = f;
        await page.locator('tr[data-user-id="11"]').waitFor();
        const fill = async username => {
            await page.locator('#createForm [name=username]').fill(username);
            await page.locator('#createForm [name=password]').fill('synthetic-create');
            await page.locator('#createForm [name=displayName]').fill('New user');
            await page.locator('#createRoleSelect').selectOption('staff');
        };
        await fill('admin-only'); await page.locator('#createSubmit').click();
        await page.locator('#createMessage').waitFor({ state: 'visible' });
        assert.match(await page.locator('#createMessage').innerText(), /Synthetic duplicate/);
        assert.equal(accounts.length, 1);
        await fill('new-user'); await page.locator('#createSubmit').click();
        const row = page.locator('tr[data-user-id="22"]'); await row.waitFor();
        assert.equal(await page.locator('#createForm [name=password]').inputValue(), '');
        await row.locator('select').selectOption('admin');
        await page.waitForFunction(() => document.querySelector('tr[data-user-id="22"] .role-badge')?.textContent === 'Admin');
        await row.locator('[data-action="toggle-active"]').click();
        await page.waitForFunction(() => document.querySelector('tr[data-user-id="22"]')?.classList.contains('is-inactive'));
        await row.locator('[data-action="toggle-active"]').click();
        await page.waitForFunction(() => {
            const current = document.querySelector('tr[data-user-id="22"]');
            return current && !current.classList.contains('is-inactive');
        });
        assert.deepEqual(f.writes().map(write => write.path), ['/users', '/users', '/users/22/role', '/users/22/active', '/users/22/active']);
        assert.deepEqual(f.writes()[2].body, { role: 'admin' });
        assert.deepEqual(f.writes()[3].body, { isActive: false });
        assert.equal(await page.locator('#resetPasswordDialog').evaluate(dialog => dialog.open), false);
        assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});
