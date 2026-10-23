import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import express from 'express';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { readSavedKsisAtPages } from '../services/ksisAtAudit.js';
import { KSIS_AT_URL } from '../services/ksisAtEntry.js';

function fixture({ dirty = false, autosave = false, initial = 2 } = {}) {
    return `<meta charset="utf-8"><div class="container-header">ชื่อศูนย์ TEST ประจำเดือน Oct - 2026</div>
    <div class="filter-label-container"><span class="filter-label-item">[English EFL]</span></div>
    <button id="btnToolbarSave">Save</button><button id="btnToolbarFilterSort" onclick="document.querySelector('.modal').style.display='block'">Filter</button>
    <div class="modal" style="display:none"><select id="filterSubject"><option>English EFL</option></select><button ng-click="vm.ok()" onclick="read(1)">OK</button></div>
    <div id="students"></div><ul class="pagination"><li class="active">1</li><li><a onclick="read(2)">›</a></li></ul>
    <script>window.memory='login-preserved';async function read(n){
      document.getElementById('btnToolbarFilterSort').disabled=true;
      ${autosave ? "fetch('/unexpected-save',{method:'POST'}).catch(()=>{});" : ''}
      await fetch('/kth/api/reportb/GetReportBTestResultEntryListPageByCriteria',{method:'POST',body:JSON.stringify({page:n})}).then(r=>r.json());
      render(n);document.querySelector('.modal').style.display='none';document.getElementById('btnToolbarFilterSort').disabled=false;
    }function render(n){
      document.getElementById('students').innerHTML='<table><tr><td><table class="vk-grid-content-student"><tr data-studentguid="s'+n+'"><td></td><td>เด็ก ทดสอบ'+n+'</td><td>764265000000'+n+'</td><td>PK3</td><td>01/01/2020</td></tr></table><table class="vk-grid-content-subject"><tr data-clrowid="s'+n+'-class-0"><td><span data-ng-show="test.isDirty" style="display:${dirty ? 'inline' : 'none'}">dirty</span></td><td>English EFL</td><td><input value="15/10/2026"></td><td><select><option>7A</option></select></td><td><input value="4"></td><td></td><td><input value="96"></td><td></td><td><select><option value="string:1">G1</option></select></td><td><input type="checkbox" checked></td><td></td><td></td></tr></table></td></tr></table>';
      document.querySelector('.pagination li.active').textContent=n;document.querySelector('.pagination li:last-child').classList.toggle('disabled',n===2);
    }render(${initial});</script>`;
}

test('AT audit reads saved pages through the native unchanged filter, preserves login and returns to current page without writes', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let loads = 0, writes = 0, reads = 0;
        await page.route('**/*', (route) => {
            if (route.request().url().endsWith('/GetReportBTestResultEntryListPageByCriteria')) { reads++; return route.fulfill({ contentType: 'application/json', body: '{}' }); }
            if (route.request().method() === 'POST') { writes++; return route.fulfill({ body: '{}' }); }
            loads++; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() });
        });
        await page.goto(KSIS_AT_URL);
        await page.locator('tr[data-clrowid] td').nth(4).locator('input').fill('99');
        const options = { month: 10, year: 2026, subject: 'EFL' };
        const current = await readSavedKsisAtPages(page, options);
        assert.equal(current.originalPage, 2); assert.equal(current.documents[0].page, 2);
        assert.equal(current.documents[0].students[0].tests[0].time.value, '4'); assert.equal(current.readOnly, true);
        const all = await readSavedKsisAtPages(page, { ...options, scope: 'all' });
        assert.deepEqual(all.documents.map((doc) => doc.page), [1, 2]); assert.equal(all.pagesRead, 2);
        assert.equal(loads, 1); assert.equal(reads, 4); assert.equal(writes, 0); assert.equal(await page.evaluate(() => window.memory), 'login-preserved');
    } finally { await browser.close(); }
});

test('AT audit refuses dirty, modal, wrong period/subject and blocks a timer save during its refresh', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        for (const mode of ['dirty', 'modal', 'period', 'subject', 'autosave']) {
            const page = await browser.newPage(); let writes = 0, reads = 0;
            await page.route('**/*', (route) => {
                if (route.request().url().endsWith('/GetReportBTestResultEntryListPageByCriteria')) { reads++; return route.fulfill({ contentType: 'application/json', body: '{}' }); }
                if (route.request().method() === 'POST') { writes++; return route.fulfill({ body: '{}' }); }
                return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture({ dirty: mode === 'dirty', autosave: mode === 'autosave' }) });
            });
            await page.goto(KSIS_AT_URL);
            if (mode === 'modal') await page.locator('#btnToolbarFilterSort').click();
            await assert.rejects(readSavedKsisAtPages(page, { month: mode === 'period' ? 9 : 10, year: 2026, subject: mode === 'subject' ? 'ME' : 'EFL' }), { statusCode: 409 });
            assert.equal(writes, 0); assert.equal(reads, mode === 'autosave' ? 1 : 0); await page.close();
        }
    } finally { await browser.close(); }
});

test('AT audit tab filters results, highlights differing values, invalidates periods and fits desktop, embedded and mobile', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000 }, async () => {
    const app = express(); app.use(express.static('public')); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), actions = [], errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/api/**', (route) => {
            const pathname = new URL(route.request().url()).pathname;
            let data = { success: true };
            if (pathname === '/api/auth/me') data = { user: { role: 'admin', displayName: 'UI Test' }, permissions: ['*'] };
            if (route.request().method() === 'POST') {
                actions.push(pathname); assert.equal(pathname, '/api/ksis/at-audit');
                const request = route.request().postDataJSON(); assert.equal(request.subject, 'EFL'); assert.equal(request.month, 10);
                data = { success: true, readOnly: true, context: 'TEST Oct - 2026', subject: 'EFL', scope: request.scope, pagesRead: 1, originalPage: 1,
                    verifiedAt: '2026-10-23T12:00:00Z', period: { month: 10, year: 2026 }, counts: { matched: 1, mismatch: 1, missing_ksis: 1 },
                    rows: ['matched', 'mismatch', 'missing_ksis'].map((outcome, index) => ({ name: `เด็กทดสอบ ${index}`, kumonId: `764265000000${index}`, subject: 'EFL', page: 1, outcome,
                        expected: { date: '2026-09-25', level: '7A', time: 4, score: 96, group: 1, passed: true },
                        actual: outcome === 'missing_ksis' ? null : { date: '2026-09-25', level: '7A', time: 4, score: index === 1 ? 80 : 96, group: 1, passed: true },
                        differences: index === 1 ? [{ field: 'score' }] : [], reason: index === 1 ? 'คะแนน' : '' })) };
            }
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html?month=10&year=2026`);
        await page.locator('#ksisAtAuditButton').click(); await page.locator('#ksisAtAuditSubject').selectOption('EFL');
        await page.locator('#ksisAtAuditCurrent').click(); await page.locator('.at-audit-table').waitFor();
        assert.equal(await page.locator('#ksisAtAuditRows tbody tr').count(), 3); assert.equal(await page.locator('#ksisAtAuditRows .audit-difference').count(), 1);
        assert.match(await page.locator('#statusLine').innerText(), /ตรง 1.*ต้องตรวจ 2 ผลสอบ/);
        await page.locator('#ksisAtAuditFilter').selectOption('issues'); assert.equal(await page.locator('#ksisAtAuditRows tbody tr').count(), 2);
        await page.locator('#ksisAtAuditSearch').fill('เด็กทดสอบ 1'); assert.equal(await page.locator('#ksisAtAuditRows tbody tr').count(), 1);
        await page.locator('#ksisAtAuditSearch').fill(''); await page.locator('#ksisAtAuditFilter').selectOption('all');
        for (const [width, height, embedded] of [[1600, 900, false], [1366, 768, true], [390, 844, false]]) {
            await page.setViewportSize({ width, height });
            await page.locator('.ksis-page').evaluate((element, active) => element.classList.toggle('ksis-embedded', active), embedded);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            assert.equal(await page.locator('#ksisAtAuditRows').evaluate((element) => element.clientHeight > 100), true);
            await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-ksis-at-audit-${width}.png`), fullPage: true });
        }
        await page.locator('#ksisAtAuditAll').click(); await page.waitForFunction(() => document.getElementById('ksisAtAuditSource').textContent.includes('ทุกหน้า'));
        await page.locator('#ksisAtAuditSubject').selectOption('ME'); assert.equal(await page.locator('.at-audit-table').count(), 0);
        assert.deepEqual(actions, ['/api/ksis/at-audit', '/api/ksis/at-audit']); assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
