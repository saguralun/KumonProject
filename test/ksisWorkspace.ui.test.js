import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';
import { readKsisWorkspace, runKsisWorkspace, confirmKsisWorkspace } from '../services/ksisWorkspaceState.js';

test('WS recovery remains usable after manual fixes or logout, keeps prior save counts and synchronizes connection-only changes', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 }, async () => {
    const userId = 920003, actions = [];
    const row = { key: 'test-ws', name: 'เด็ก ทดสอบ', subject: 'ME', kumonId: '7642650000001',
        before: { level: { value: 'C' }, worksheet: { value: '10' }, used: { value: '0' }, status: { value: 'C' } },
        desired: { level: 'C', worksheet: 20, used: 2, status: 'C' }, outcome: 'failed' };
    await runKsisWorkspace(userId, 'draft', 'fill', {}, async () => ({ pendingDraft: true, stopped: true, savedCount: 10, page: 1, error: 'WS used ไม่สำเร็จ', rows: [row] }));
    let mode = 'login', connection = { pendingDraft: true, pendingWork: 'WS' };
    const app = express(); app.use(express.json());
    app.get('/api/auth/me', (_req, res) => res.json({ user: { role: 'admin', displayName: 'Fixture' }, permissions: ['*'] }));
    app.get('/api/ksis/workspace', (req, res) => res.json({ success: true, ...readKsisWorkspace(userId, req.query.after), connection }));
    app.post('/api/ksis/draft/inspect', async (req, res) => {
        actions.push('inspect');
        const data = await runKsisWorkspace(userId, 'draft', 'inspect', req.body, async () => {
            const recovered = mode === 'clean';
            if (recovered) connection = { pendingDraft: false, pendingWork: null };
            return { readOnly: true, refreshed: false, pendingDraft: !recovered, recovered, requiresLogin: mode === 'login',
                message: mode === 'login' ? 'KSIS ออกจากระบบแล้ว กรุณาเข้าสู่ระบบ' : mode === 'dirty' ? 'ยังมีข้อมูลแก้ค้าง' : 'ไม่พบข้อมูลแก้ค้าง ปลดล็อกแล้ว' };
        });
        res.json({ success: true, ...data });
    });
    app.use('/api', (_req, res) => res.json({ success: true })); app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html`);
        await page.locator('#ksisDraftInspect').waitFor();
        assert.equal(await page.locator('#ksisDraftPreview').isDisabled(), true);
        await page.locator('#ksisDraftInspect').click();
        await page.waitForFunction(() => document.getElementById('ksisDraftSource').textContent.includes('ออกจากระบบ'));
        assert.equal(await page.locator('#ksisDraftInspect').isEnabled(), true);
        assert.equal(await page.locator('#ksisDraftFill').isDisabled(), true);
        mode = 'dirty'; await page.locator('#ksisDraftInspect').click();
        await page.waitForFunction(() => document.getElementById('ksisDraftSource').textContent.includes('ยังมีข้อมูลแก้ค้าง'));
        assert.equal(await page.locator('#ksisDraftPreview').isDisabled(), true);
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-ws-recovery-pending.png'), fullPage: true });
        mode = 'clean'; await page.locator('#ksisDraftInspect').click();
        await page.waitForFunction(() => !document.getElementById('ksisDraftPreview').disabled);
        assert.match(await page.locator('#ksisDraftSource').innerText(), /ปลดล็อกแล้ว/);
        assert.equal(await page.locator('#ksisDraftFill').isDisabled(), true);
        assert.equal(await page.locator('#reportMonth').isEnabled(), true);
        assert.equal(await page.locator('#ksisDraftRows tbody tr').count(), 1);
        assert.equal(readKsisWorkspace(userId).tools.draft.result.savedCount, 10);
        connection = { pendingDraft: true, pendingWork: 'WS' };
        await page.waitForFunction(() => document.getElementById('ksisDraftPreview').disabled);
        connection = { pendingDraft: false, pendingWork: null };
        await page.waitForFunction(() => !document.getElementById('ksisDraftPreview').disabled);
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-ws-recovery-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-ws-recovery-mobile.png'), fullPage: true });
        assert.deepEqual(errors, []); assert.deepEqual(actions, ['inspect', 'inspect', 'inspect']);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});

test('Two isolated browser windows share AT preview, identity checks, busy locks and pending results; reads never fill or save', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000 }, async () => {
    const app = express(); app.use(express.json()); const userId = 920001;
    app.get('/api/auth/me', (_req, res) => res.json({ user: { role: 'admin', displayName: 'Test' }, permissions: ['*'] }));
    app.get('/api/ksis/workspace', (_req, res) => res.json({ success: true, ...readKsisWorkspace(userId), connection: { pendingDraft: false } }));
    app.post('/api/ksis/workspace/confirm', (req, res) => res.json({ success: true, ...confirmKsisWorkspace(userId, req.body) }));
    let fills = 0, release, serial = 0;
    app.post('/api/ksis/draft/preview', async (req, res) => {
        const data = await runKsisWorkspace(userId, 'draft', 'preview', req.body, async () => ({ previewId: 'shared-ws', context: 'TEST Oct - 2026', period: { month: 10, year: 2026 }, subject: 'ALL', page: 1,
            rows: [{ enrollmentId: 5, key: 'target-ws', name: 'เด็ก ทดสอบ', birthDate: '01/01/2020', subject: 'ME', ready: true, requiresIdentityConfirmation: true,
                before: { fullName: 'เด็ก ทดสอบ', birthDate: '01/01/2020', level: { value: 'C' }, worksheet: { value: '10' }, used: { value: '0' }, status: { value: 'C' } }, desired: { level: 'C', worksheet: 20, used: 2, status: 'C' } }] }));
        res.json({ success: true, ...data });
    });
    const rows = [{ id: '1:0', key: 'guid-class-0', name: 'เด็ก ทดสอบ', kumonId: '', subject: 'EFL', requiresIdentityConfirmation: true, birthDate: '01/01/2020', targetBirthDate: '01/01/2020', targetName: 'เด็ก ทดสอบ', outcome: 'ready', desired: { date: '2026-10-10', level: 'A', time: 5, score: 96, group: 1, passed: true } }];
    app.post('/api/ksis/at/:action', async (req, res) => {
        try {
            const data = await runKsisWorkspace(userId, 'at', req.params.action, req.body, async () => {
                if (req.params.action === 'preview') return { previewId: `p${++serial}`, context: 'TEST Oct - 2026', subject: 'EFL', period: { month: 10, year: 2026 }, page: 1, rows };
                if (req.params.action === 'fill') {
                    fills++; await new Promise((resolve) => { release = resolve; });
                    return { saved: [], pendingDraft: true, failedId: rows[0].id, message: 'หยุดตรวจผลบันทึก', rows: [{ ...rows[0], outcome: 'review' }] };
                }
                assert.fail('Unexpected mutation');
            });
            res.json({ success: true, ...data });
        } catch (error) { res.status(error.statusCode || 500).json({ success: false, error: error.message }); }
    });
    app.use('/api', (_req, res) => res.json({ success: true })); app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const one = await browser.newContext(), two = await browser.newContext();
        const first = await one.newPage(), second = await two.newPage(); const errors = [];
        for (const page of [first, second]) page.on('pageerror', (error) => errors.push(error.message));
        const url = `http://127.0.0.1:${server.address().port}/ksis.html?month=10&year=2026`;
        await first.goto(url); await second.goto(url);
        await first.locator('#ksisDraftPreview').click();
        await second.waitForFunction(() => document.querySelector('#ksisDraftRows [data-confirm-identity]') !== null);
        await first.locator('#ksisDraftRows [data-confirm-identity]').check();
        await second.waitForFunction(() => document.querySelector('#ksisDraftRows [data-confirm-identity]')?.checked === true);
        assert.equal(await second.locator('#ksisDraftFill').isDisabled(), false); assert.equal(fills, 0);
        await first.locator('#ksisAtButton').click(); await first.locator('#ksisAtSubject').selectOption('EFL'); await first.locator('#ksisAtPreview').click();
        await second.waitForFunction(() => document.getElementById('ksisAtSource').textContent.includes('EFL'));
        assert.equal(await second.locator('#ksisAtButton').getAttribute('aria-selected'), 'true');
        assert.equal(await second.locator('#ksisAtSubject').inputValue(), 'EFL'); assert.equal(fills, 0);
        await first.locator('[data-at-identity]').check();
        await second.waitForFunction(() => document.querySelector('[data-at-identity]')?.checked === true);
        await first.locator('#ksisAtFill').click(); await first.locator('#ksisAtConfirm').click();
        await second.waitForFunction(() => document.getElementById('ksisAtPreview').disabled === true);
        assert.equal(await second.locator('#ksisAtFill').isDisabled(), true); assert.equal(await second.locator('#reportMonth').isDisabled(), true);
        release();
        await second.waitForFunction(() => document.getElementById('ksisAtSource').textContent.includes('หยุดตรวจผลบันทึก'));
        assert.equal(fills, 1); assert.equal(await second.locator('#ksisAtAcknowledge').isVisible(), true);
        await second.reload();
        await second.waitForFunction(() => document.getElementById('ksisAtSource').textContent.includes('หยุดตรวจผลบันทึก'));
        assert.equal(await second.locator('#ksisAtFill').isDisabled(), true);
        await second.screenshot({ path: path.join(os.tmpdir(), 'kumondb-ksis-shared-pending-desktop.png'), fullPage: true });
        await second.setViewportSize({ width: 390, height: 844 });
        assert.equal(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await second.screenshot({ path: path.join(os.tmpdir(), 'kumondb-ksis-shared-pending-mobile.png'), fullPage: true });
        assert.deepEqual(errors, []); assert.equal(fills, 1);
        await one.close(); await two.close();
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});

test('Pending AT inspection is available without acknowledgement and displays saved evidence without enabling another fill', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    const userId = 920002, input = { month: 10, year: 2026, subject: 'EFL' };
    const desired = { date: '2026-10-15', level: '7A', time: 4, score: 96, group: 1, passed: true };
    const row = { id: '10:0', key: 'guid-class-0', kumonId: '7642650000001', name: 'เด็ก ทดสอบ', subject: 'EFL', outcome: 'ready', desired };
    await runKsisWorkspace(userId, 'at', 'preview', input, async () => ({ previewId: 'inspect-preview', context: 'TEST Oct - 2026', page: 1, period: { month: 10, year: 2026 }, subject: 'EFL', rows: [row] }));
    await runKsisWorkspace(userId, 'at', 'fill', { previewId: 'inspect-preview' }, async () => ({ message: 'ยังไม่ยืนยันผลบันทึก', pendingDraft: true, failedId: row.id, rows: [{ ...row, outcome: 'review' }] }));
    const app = express(); app.use(express.json()); const actions = [];
    app.get('/api/auth/me', (_req, res) => res.json({ user: { role: 'admin', displayName: 'Test' }, permissions: ['*'] }));
    app.get('/api/ksis/workspace', (_req, res) => res.json({ success: true, ...readKsisWorkspace(userId), connection: { pendingDraft: true, pendingWork: 'AT' } }));
    app.get('/api/ksis/desktop/status', (_req, res) => res.json({ success: true, pendingDraft: true, pendingWork: 'AT' }));
    app.post('/api/ksis/at/inspect', async (req, res) => {
        actions.push('inspect'); assert.deepEqual(req.body, { ...input, kumonId: row.kumonId });
        const data = await runKsisWorkspace(userId, 'at', 'inspect', req.body, async () => ({ readOnly: true, refreshed: true, dirty: false, page: 1, subject: 'EFL', name: row.name, kumonId: row.kumonId,
            comparisons: [{ desired, matches: true, persisted: true, actual: { date: { value: '15/10/2026' }, level: { value: '7A' }, time: { value: '4' }, score: { value: '96' }, group: { value: 'G1' }, passed: true } }], tests: [], lastSave: null }));
        res.json({ success: true, ...data });
    });
    app.use('/api', (_req, res) => res.json({ success: true })); app.use(express.static('public'));
    const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
        await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html?month=10&year=2026`);
        await page.locator('[data-at-inspect]').waitFor();
        assert.equal(await page.locator('#ksisAtFill').isDisabled(), true);
        await page.locator('[data-at-inspect]').click();
        await page.waitForFunction(() => document.getElementById('ksisAtInspection').textContent.includes('ตรงกับ Report'));
        assert.equal(await page.locator('#ksisAtFill').isDisabled(), true);
        assert.equal(readKsisWorkspace(userId).tools.at.pending, true); assert.deepEqual(actions, ['inspect']);
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-ksis-readonly-inspection-desktop.png'), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: path.join(os.tmpdir(), 'kumondb-ksis-readonly-inspection-mobile.png'), fullPage: true });
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
