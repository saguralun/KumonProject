import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApplicationDesktop } from '../services/ksisDesktop.js';

for (const embedded of [false, true]) test(`Resume and Absent work without native dialogs, cancel safely, retry visible errors and submit once (${embedded ? 'desktop app' : 'browser'})`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000
}, async () => {
    const app = express(); app.use(express.json());
    const requests = [], errors = [];
    let status = 'A', fail = true, releaseSave, holdSave = false;
    const student = { studentId: 999, displayName: 'เด็ก ทดสอบ', firstName: 'เด็ก', lastName: 'ทดสอบ', prefixId: 1, genderId: 1, schoolGradeId: 1 };
    const profile = () => ({ student, enrollments: [{ enrollmentId: 202, subjectId: 1, subjectCode: 'ME', currentLevelMasterId: 1, currentLevelCode: 'A',
        startingWorksheetMasterId: 1, enStartDate: '2026-01-01', currentStatusGroup1Id: { C: 1, A: 2, R: 3 }[status], statusGroup1Code: status }] });
    const masters = { prefixes: [{ id: 1, name: 'ด.ช.' }], genders: [{ id: 1, name: 'ชาย' }], grades: [{ id: 1, label: 'PK3' }], subjects: [{ id: 1, code: 'ME', name: 'Math' }],
        statuses: [{ id: 1, group: 1, code: 'C', name: 'Continue' }, { id: 2, group: 1, code: 'A', name: 'Absent' }, { id: 3, group: 1, code: 'R', name: 'Resumed' }],
        levels: [{ id: 1, subjectId: 1, code: 'A', type: 1 }], worksheets: [{ id: 1, levelMasterId: 1, worksheetNo: 1 }], schedules: [], dtMasters: [], studentHints: {}, addressRows: [] };
    app.get('/api/auth/me', (_req, res) => res.json({ user: { role: 'admin', displayName: 'Fixture' }, permissions: ['*'] }));
    app.get('/api/students/masters', (_req, res) => res.json({ success: true, masters }));
    app.get('/api/students/search', (_req, res) => res.json({ success: true, rows: [student] }));
    app.get('/api/students/999', (_req, res) => res.json({ success: true, ...profile() }));
    app.post('/api/students/999/enrollments/202/status-action', async (req, res) => {
        requests.push(req.body);
        if (fail) return res.status(503).json({ success: false, error: 'Fixture resume unavailable' });
        if (holdSave) await new Promise((resolve) => { releaseSave = resolve; });
        status = req.body.action === 'resume' ? 'R' : 'A';
        res.json({ success: true, profile: profile(), enrollmentId: 202, message: req.body.action === 'resume' ? 'Resume แล้ว: status R' : 'Absent แล้ว' });
    });
    app.use('/api', (req, res) => {
        assert.equal(req.method, 'GET', `Unexpected write ${req.method} ${req.path}`);
        res.json({ success: true, rows: [], checked: false });
    });
    app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const origin = `http://localhost:${server.address().port}`, root = await fs.mkdtemp(path.join(os.tmpdir(), 'kumon-resume-fixture-'));
    let browser, desktop;
    try {
        let page;
        if (embedded) {
            desktop = await createApplicationDesktop({ origin, profileDirectory: root, startPath: '/student-manager.html?studentId=999&enrollmentId=202' });
            page = desktop.main;
            const nativePrompt = await page.evaluate(() => { try { window.prompt('fixture only'); return ''; } catch (error) { return error.message; } });
            assert.match(nativePrompt, /not.*support|support.*not/i);
        } else {
            browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
            page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
            await page.goto(`${origin}/student-manager.html?studentId=999&enrollmentId=202`);
        }
        page.on('pageerror', (error) => errors.push(error.message));
        await page.evaluate(() => { window.prompt = () => { throw new Error('Native prompt must never be used'); }; window.confirm = () => false; });
        await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '202');
        await page.locator('#enrollmentActionBar').evaluate((bar) => { bar.closest('details').open = true; });
        await page.locator('#enrollmentResumeButton').waitFor();
        const dialog = page.locator('#enrollmentResumeDialog'), date = page.locator('#enrollmentResumeDate');
        await page.locator('#enrollmentResumeButton').click(); await dialog.waitFor();
        assert.match(await page.locator('#enrollmentResumeStudent').innerText(), /ME #202/);
        assert.match(await date.inputValue(), /^\d{4}-\d{2}-\d{2}$/);
        await page.locator('#enrollmentResumeCancel').click(); assert.equal(requests.length, 0);
        await page.locator('#enrollmentResumeButton').click(); await page.keyboard.press('Escape'); assert.equal(requests.length, 0);
        await page.locator('#enrollmentResumeButton').click(); await date.fill('');
        await page.locator('#enrollmentResumeSave').click(); assert.equal(requests.length, 0);
        await date.fill('2026-10-23'); await page.locator('#enrollmentResumeSave').click();
        await page.waitForFunction(() => document.getElementById('enrollmentResumeError').textContent.includes('unavailable'));
        assert.equal(await dialog.isVisible(), true); assert.equal(await date.inputValue(), '2026-10-23');
        assert.equal(await page.locator('#enrollmentResumeSave').isEnabled(), true);
        if (!embedded) {
            await page.setViewportSize({ width: 390, height: 844 });
            const rect = await dialog.boundingBox(); assert.ok(rect.x >= 0 && rect.x + rect.width <= 390);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        }
        await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-resume-dialog-${embedded ? 'desktop' : 'mobile'}.png`) });
        fail = false; holdSave = true;
        await page.locator('#enrollmentResumeSave').click();
        await page.waitForFunction(() => document.getElementById('enrollmentResumeSave').disabled);
        await page.locator('#enrollmentResumeForm').evaluate((form) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
        assert.equal(await page.locator('#enrollmentResumeCancel').isDisabled(), true);
        assert.equal(requests.length, 2);
        releaseSave();
        await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Resume แล้ว'));
        assert.equal(await dialog.isVisible(), false); assert.equal(await page.locator('#enrollmentResumeButton').isVisible(), false);
        assert.deepEqual(requests, [{ action: 'resume', resumeDate: '2026-10-23' }, { action: 'resume', resumeDate: '2026-10-23' }]);
        holdSave = false; fail = true; status = 'C';
        await page.reload();
        await page.evaluate(() => { window.confirm = () => false; });
        await page.waitForFunction(() => document.querySelector('#enrollmentForm [name=enrollmentId]').value === '202');
        await page.locator('#enrollmentActionBar').evaluate((bar) => { bar.closest('details').open = true; });
        await page.locator('#enrollmentAbsentButton').click(); await dialog.waitFor();
        assert.equal(await page.locator('#enrollmentResumeTitle').innerText(), 'ยืนยัน Absent');
        assert.equal(await date.isVisible(), false);
        await page.locator('#enrollmentResumeCancel').click(); assert.equal(requests.length, 2);
        await page.locator('#enrollmentAbsentButton').click(); await page.locator('#enrollmentResumeSave').click();
        await page.waitForFunction(() => document.getElementById('enrollmentResumeError').textContent.includes('unavailable'));
        assert.equal(await dialog.isVisible(), true);
        fail = false; await page.locator('#enrollmentResumeSave').click();
        await page.waitForFunction(() => document.getElementById('statusLine').textContent.includes('Absent แล้ว'));
        assert.equal(await dialog.isVisible(), false); assert.equal(await page.locator('#enrollmentAbsentButton').isVisible(), false);
        assert.deepEqual(requests.slice(2), [{ action: 'absent' }, { action: 'absent' }]);
        assert.deepEqual(errors, []);
    } finally {
        releaseSave?.(); await desktop?.application.close(); await browser?.close(); await new Promise((resolve) => server.close(resolve));
        const relative = path.relative(path.resolve(os.tmpdir()), path.resolve(root));
        if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) await fs.rm(root, { recursive: true, force: true });
    }
});
