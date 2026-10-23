import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import express from 'express';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { planKsisReportDraft, selectConfirmedKsisDraftRows } from '../services/ksisReportDraft.js';

test('ID-less preview shows both identities, requires unchecked per-subject confirmation, sends only selected matches and resets on new preview', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000
}, async () => {
    const field = (value, options = null) => ({ value, options, writable: true });
    const records = ['ME', 'EFL'].map((Subject, index) => ({ ID: index + 1, StudentId: 100, Subject, 'รหัสคุมอง': '',
        'ชื่อจริง': 'นักเรียนตัวอย่าง', 'นามสกุล': 'ทดสอบ', 'วันเกิด': '01/01/2563', CurrentLevel: 'C90', WksUsed: 8, Status1: 'N' }));
    records.push({ ...records[0], ID: 3, StudentId: 200, 'ชื่อจริง': 'เด็กวันเกิดไม่ครบ', 'วันเกิด': '', Status1: 'EO' });
    const document = { context: 'ชื่อศูนย์ TEST ประจำเดือน Oct - 2026', page: 1, modalOpen: false,
        rows: ['ME', 'EFL'].map((subject) => ({ key: `new-${subject}`, studentKey: 'header:0', kumonId: '', fullName: 'นักเรียนตัวอย่าง ทดสอบ',
            birthDate: '01/01/2020', subject, level: field('C', ['C', 'D']), worksheet: field('80', ['80', '90']),
            used: field('0'), status: field('C', ['C', 'N', 'EO']), dirty: false })) };
    const rows = planKsisReportDraft(records, document, { month: 10, year: 2026 }, 'ALL', { includeZun: false });
    const app = express(); app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = []; const fillRequests = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/**', async (route) => {
            const url = new URL(route.request().url());
            let data = { success: true };
            if (url.pathname === '/api/auth/me') data = { user: { role: 'admin', displayName: 'Test' }, permissions: ['*'] };
            if (url.pathname.endsWith('/draft/preview')) data = { success: true, rows, previewId: 'identity-test', context: document.context, page: 1, subject: 'ALL', period: { month: 10, year: 2026 } };
            if (url.pathname.endsWith('/draft/fill')) {
                const body = route.request().postDataJSON(); fillRequests.push(body);
                const selected = selectConfirmedKsisDraftRows(rows, body.confirmedIdentityMatches);
                data = { success: true, saved: true, pendingDraft: false, page: 1, studentsFilled: 1, studentsSaved: 1, filled: 1, savedCount: 1, batchesSaved: 1,
                    rows: selected.map((row) => ({ ...row, outcome: row.ready ? 'saved' : 'blocked', resultReason: row.reason })) };
            }
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html`);
        await page.locator('#ksisDraftPreview').click(); await page.locator('[data-confirm-identity]').first().waitFor();
        assert.equal(await page.locator('[data-confirm-identity]').count(), 2);
        assert.equal(await page.locator('[data-confirm-identity]:checked').count(), 0);
        assert.equal(await page.locator('#ksisDraftFill').isDisabled(), true);
        assert.match(await page.locator('#ksisDraftRows').innerText(), /Report: นักเรียนตัวอย่าง ทดสอบ • 01\/01\/2563/);
        assert.match(await page.locator('#ksisDraftRows').innerText(), /KSIS: นักเรียนตัวอย่าง ทดสอบ • 01\/01\/2020/);
        assert.match(await page.locator('#ksisDraftRows').innerText(), /เด็กวันเกิดไม่ครบ/);
        assert.equal(fillRequests.length, 0);
        await page.getByRole('checkbox', { name: 'ยืนยันคู่ นักเรียนตัวอย่าง ทดสอบ ME', exact: true }).check();
        assert.equal(await page.locator('#ksisDraftFill').isEnabled(), true);
        assert.match(await page.locator('#ksisDraftSource').innerText(), /พร้อม 1 รายวิชา • รอยืนยันชื่อ 1 รายวิชา/);
        await page.getByRole('checkbox', { name: 'ยืนยันคู่ นักเรียนตัวอย่าง ทดสอบ ME', exact: true }).uncheck();
        assert.equal(await page.locator('#ksisDraftFill').isDisabled(), true);
        await page.getByRole('checkbox', { name: 'ยืนยันคู่ นักเรียนตัวอย่าง ทดสอบ ME', exact: true }).check();
        for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
            await page.setViewportSize(viewport);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        }
        await page.setViewportSize({ width: 1200, height: 900 });
        // Exercise the narrow tool panel without connecting to a real KSIS account.
        await page.locator('.report-page').evaluate((element) => element.classList.add('ksis-embedded'));
        await page.locator('.ksis-browser-pane').evaluate((element) => element.classList.remove('hidden'));
        assert.equal(await page.locator('#ksisDraftRows').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-ksis-identity-preview-test.png'), fullPage: true });
        await page.locator('#ksisDraftFill').click(); await page.locator('#ksisDraftDialog[open]').waitFor();
        assert.match(await page.locator('#ksisDraftConfirmText').innerText(), /1 รายวิชา • ยืนยันคู่ชื่อแล้ว 1 รายวิชา/);
        assert.equal(fillRequests.length, 0);
        await page.locator('#ksisDraftConfirm').click();
        await page.waitForFunction(() => document.querySelector('#ksisDraftRows')?.textContent.includes('กรอกและบันทึกแล้ว'));
        assert.equal(fillRequests.length, 1);
        assert.deepEqual(fillRequests[0].confirmedIdentityMatches, [{ enrollmentId: 1, key: 'new-ME' }]);
        assert.match(await page.locator('#ksisDraftRows').innerText(), /ยังไม่ได้ยืนยันคู่ชื่อและวันเกิด/);
        await page.locator('#ksisDraftPreview').click(); await page.locator('[data-confirm-identity]').first().waitFor();
        assert.equal(await page.locator('[data-confirm-identity]:checked').count(), 0);
        assert.equal(await page.locator('#ksisDraftFill').isDisabled(), true);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
