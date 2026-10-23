import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { once } from 'node:events';
import { chromium } from 'playwright-core';

const enrollments = [1, 2, 3].map((enrollmentId) => ({ enrollmentId, subjectCode: ['ME', 'EFL', 'TRP'][enrollmentId - 1], studentName: `Student ${enrollmentId}`,
    currentLevelMasterId: enrollmentId, currentLevelCode: 'C', statusName: 'Continue' }));
const summary = { billingMonth: 10, billingYear: 2026, usedDays: 1, cpwsRecords: 1 };
const context = (id) => ({ enrollment: enrollments[id - 1], studentEnrollments: enrollments,
    defaults: { patternCode: 'daily10', receiveDate: '2026-10-20', mainWorksheetNo: 101 },
    patterns: [{ code: 'daily10', shortLabel: '10/day', suffixes: [1], dayOffsets: [0] }],
    worksheetOptions: { main: [{ worksheetNo: 101 }], zun: [] }, history: [], worksheetMonthSummary: summary });

test('WS locks student selection during a save and cannot mix its result into a different enrollment', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 }, async () => {
    const app = express(); app.use(express.static('public')); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    let releaseSave, releaseSummary, summaryStarted = false;
    try {
        const page = await browser.newPage(); const requests = [], errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/**', async (route) => {
            const pathname = new URL(route.request().url()).pathname; let data = { success: true, rows: [] };
            if (pathname === '/api/auth/me') data = { user: { role: 'admin', displayName: 'Test' }, permissions: ['*'] };
            if (pathname.endsWith('/worksheet-summary')) {
                if (pathname.includes('/enrollments/2/')) { summaryStarted = true; await new Promise((resolve) => { releaseSummary = resolve; }); }
                data.worksheetMonthSummary = summary;
            }
            const match = pathname.match(/enrollments\/(\d+)\/context/);
            if (match) { requests.push(Number(match[1])); data = context(Number(match[1])); }
            if (pathname === '/api/worksheet/entries') {
                assert.equal(route.request().postDataJSON().enrollmentId, 1);
                await new Promise((resolve) => { releaseSave = resolve; });
                data = { success: true, records: [{ worksheetUsedId: 777, enrollmentId: 1, worksheetType: 'WS', worksheetDate: '2026-10-20', levelMasterId: 1,
                    levelCode: 'C', worksheetLabel: 'C101', packetWorksheetNo: 101, cpws: true, isStockProcessed: false }], nextReceiveDate: '2026-10-21' };
            }
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/worksheet.html`);
        const load = (id) => page.evaluate(async (id) => { const src = [...document.scripts].find((script) => script.type === 'module' && script.src.includes('/worksheet.js')).src; await (await import(src)).loadEnrollmentContext(id); }, id);
        await load(1); await page.locator('#saveButton').click();
        assert.equal(await page.locator('#studentSearch').isDisabled(), true); assert.equal(await page.locator('#studentSubjectSelect').isDisabled(), true);
        await load(2); assert.deepEqual(requests, [1]);
        releaseSave(); await page.waitForFunction(() => !document.getElementById('studentSubjectSelect').disabled);
        assert.match(await page.locator('#historyTableWrap').innerText(), /C101/);
        await page.locator('#studentSubjectSelect').selectOption('2'); await page.waitForFunction(() => document.getElementById('studentSearch').value.startsWith('#2 '));
        while (!summaryStarted) await new Promise((resolve) => setTimeout(resolve, 10));
        assert.doesNotMatch(await page.locator('#historyTableWrap').innerText(), /C101/); assert.deepEqual(errors, []);
        releaseSummary();
    } finally { releaseSave?.(); releaseSummary?.(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});

test('Out-of-order enrollment responses cannot replace the latest student, and saving waits for context loading', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 }, async () => {
    const app = express(); app.use(express.static('public')); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    let releaseContext;
    try {
        const page = await browser.newPage(); let slowStarted = false;
        await page.route('**/api/**', async (route) => {
            const pathname = new URL(route.request().url()).pathname; let data = { success: true, rows: [] };
            assert.equal(route.request().method(), 'GET');
            if (pathname === '/api/auth/me') data = { user: { role: 'admin', displayName: 'Test' }, permissions: ['*'] };
            if (pathname.endsWith('/worksheet-summary')) data.worksheetMonthSummary = summary;
            const match = pathname.match(/enrollments\/(\d+)\/context/);
            if (match) {
                if (match[1] === '2') { slowStarted = true; await new Promise((resolve) => { releaseContext = resolve; }); }
                data = context(Number(match[1]));
            }
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/worksheet.html`);
        await page.evaluate(async () => { const src = [...document.scripts].find((script) => script.type === 'module' && script.src.includes('/worksheet.js')).src; await (await import(src)).loadEnrollmentContext(1); });
        await page.locator('#studentSubjectSelect').selectOption('2');
        assert.equal(await page.locator('#saveButton').isDisabled(), true);
        while (!slowStarted) await new Promise((resolve) => setTimeout(resolve, 10));
        await page.locator('#studentSubjectSelect').selectOption('3');
        await page.waitForFunction(() => document.getElementById('studentSearch').value.startsWith('#3 '));
        const staleResponse = page.waitForResponse((response) => /enrollments\/2\/context/.test(response.url()));
        releaseContext();
        await (await staleResponse).finished();
        await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 100)));
        await page.waitForFunction(() => document.getElementById('studentSubjectSelect').value === '3');
        const state = await page.evaluate(async () => (await import('/js/worksheet/worksheetState.js')).state.context.enrollment.enrollmentId);
        assert.equal(state, 3);
    } finally { releaseContext?.(); await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});

test('A rejected WS save keeps the error visible, unlocks selection and does not add history', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000 }, async () => {
    const app = express(); app.use(express.static('public')); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let saves = 0;
        await page.route('**/api/**', async (route) => {
            const pathname = new URL(route.request().url()).pathname; let data = { success: true, rows: [] };
            if (pathname === '/api/auth/me') data = { user: { role: 'admin', displayName: 'Test' }, permissions: ['*'] };
            if (pathname.endsWith('/worksheet-summary')) data.worksheetMonthSummary = summary;
            if (/enrollments\/1\/context/.test(pathname)) data = context(1);
            if (pathname === '/api/worksheet/entries') {
                saves++;
                await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Synthetic save failure' }) });
                return;
            }
            await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/worksheet.html`);
        await page.evaluate(async () => { const src = [...document.scripts].find((script) => script.type === 'module' && script.src.includes('/worksheet.js')).src; await (await import(src)).loadEnrollmentContext(1); });
        await page.locator('#saveButton').click();
        await page.waitForFunction(() => document.getElementById('statusLine').textContent === 'Synthetic save failure');
        assert.equal(await page.locator('#studentSearch').isDisabled(), false);
        assert.equal(await page.locator('#studentSubjectSelect').isDisabled(), false);
        assert.equal(await page.locator('#statusLine').evaluate((element) => element.classList.contains('is-error')), true);
        assert.equal(await page.evaluate(async () => (await import('/js/worksheet/worksheetState.js')).state.history.length), 0);
        assert.equal(saves, 1);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
