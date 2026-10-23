import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import express from 'express';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { KSIS_AT_URL, readKsisAtDocument, planKsisAt, fillAndSaveKsisAt, installKsisAtGuard, selectKsisAtSubject, readKsisAtInspection } from '../services/ksisAtEntry.js';

const period = { month: 10, year: 2026 };
const record = { ID: 100, StudentId: 10, 'รหัสคุมอง': '7642650000001', 'ชื่อจริง': 'เด็ก', 'นามสกุล': 'ทดสอบ', 'วันเกิด': '01/01/2020', Subject: 'ME', Status1: 'C',
    TestType: 'AT', DateTest: '10/10/2026', LevelTest: 'C', Time: 70, Score: 0, Group: 2,
    TestType1: 'AT', DateTest1: '15/10/2026', LevelTest1: 'D', Time1: 10, Score1: 88, Group1: 1,
    TestType2: 'AT', DateTest2: '20/10/2026', LevelTest2: 'E', Time2: 15, Score2: 99, Group2: 2 };

function fixture() {
    return `<meta charset="utf-8"><style>td{padding:6px}input{width:90px}</style>
    <div class="container-header">ชื่อศูนย์ TEST ประจำเดือน Oct - 2026</div>
    <div class="filter-label-container"><span class="filter-label-item">[Math]</span></div>
    <button id="btnToolbarSave" onclick="save()">Save</button><button id="btnToolbarATest" onclick="add()">+ AT</button><div id="students"></div>
    <ul class="pagination"><li class="active">1</li><li><a>›</a></li></ul>
    <script>
    const data=[{date:'10/10/2026',level:'C',time:'70',score:'0',group:'2',passed:true,notes:'old notes',guid:'existing',dirty:false}]; let selected=0;
    function opts(values,value){return values.map(v=>'<option value="string:'+v+'" '+(v===value?'selected':'')+'>'+v+'</option>').join('')}
    function render(){ document.getElementById('students').innerHTML='<table><tr><td><table class="vk-grid-content-student"><tr data-studentguid="guid"><td></td><td>เด็ก ทดสอบ</td><td>7642650000001</td><td>PK3</td><td>01/01/2020</td></tr></table><table class="vk-grid-content-subject">'+data.map((t,i)=>'<tr data-index="'+i+'" data-clrowid="guid-class-'+i+'"><td><span data-ng-show="test.isDirty" style="display:'+(t.dirty?'inline':'none')+'">dirty</span></td><td>Math</td><td><input data-field="date" value="'+t.date+'"></td><td><select data-field="level">'+opts(['','C','D','E'],t.level)+'</select></td><td><input data-field="time" value="'+t.time+'"></td><td>/30</td><td><input data-field="score" value="'+t.score+'"></td><td>/100</td><td><select data-field="group">'+opts(['0','1','2'],t.group)+'</select></td><td><input data-field="passed" type="checkbox" '+(t.passed?'checked':'')+'></td><td><input value="'+t.notes+'"></td><td></td></tr>').join('')+'</table></td></tr></table>'; }
    document.getElementById('students').addEventListener('click',e=>{const row=e.target.closest('[data-index]');if(row)selected=Number(row.dataset.index)});
    document.getElementById('students').addEventListener('change',e=>{const field=e.target.dataset.field;if(field)change(Number(e.target.closest('[data-index]').dataset.index),field,e.target.type==='checkbox'?e.target.checked:e.target.value.replace('string:',''))});
    function change(i,key,value){data[i][key]=value;data[i].dirty=true;document.querySelectorAll('[data-ng-show]')[i].style.display='inline'}
    function add(){data.push({date:'',level:'',time:'',score:'',group:'0',passed:false,notes:'',guid:'',dirty:false});selected=data.length-1;render()}
    async function save(auto=false){const payload=data.flatMap((t,i)=>!t.dirty||auto&&i===selected?[]:[{studentGuid:'guid',classId:'class',testRowId:i,testGuid:t.guid,testTypeCd:'AT',testDate:t.date,testCd:t.level,testTime:Number(t.time),testScore1:Number(t.score),atGroupCd:t.group,testResultFlg:t.passed,notes:t.notes}]);
      if(!payload.length)return;try{const rows=await fetch('/kth/api/reportb/SaveReportBTestResultEntryEditItemBatch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).then(r=>r.json());for(const row of rows){if(row.saveResult<0)continue;data[row.testRowId].dirty=false;data[row.testRowId].guid=row.testGuid}render()}catch{}}
    render();setInterval(()=>save(true),40);
    </script>`;
}

test('AT fills multiple inline results, saves one verified new result at a time, preserves existing results, then detects duplicates', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); const writes = [], errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.route('**/*', (route) => {
            if (route.request().method() === 'POST') {
                const payload = route.request().postDataJSON(); writes.push(payload);
                return route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload.map((row) => ({ ...row, testGuid: `saved-${row.testRowId}`, saveResult: 0, lockVersion: 1, error: '', errorCodeType: 0 }))) });
            }
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() });
        });
        await page.goto(KSIS_AT_URL);
        assert.deepEqual(errors, []);
        const initial = await page.evaluate(readKsisAtDocument);
        const rows = planKsisAt([record], initial, period, 'ME');
        assert.deepEqual(rows.map((row) => row.outcome), ['existing', 'ready', 'ready'], JSON.stringify({ initial, rows }));
        const guard = await installKsisAtGuard(page);
        const result = await fillAndSaveKsisAt(page, rows.filter((row) => row.outcome === 'ready'), guard, initial);
        assert.equal(result.pendingDraft, false, result.message); assert.equal(result.saved.length, 2); assert.equal(writes.length, 2);
        assert.equal(guard.blocked(), 0); assert.equal(writes.every((batch) => batch.length === 1 && batch[0].testGuid === '' && batch[0].testResultFlg), true);
        await guard.release();
        const after = await page.evaluate(readKsisAtDocument);
        assert.equal(after.students[0].tests.length, 3); assert.equal(after.students[0].tests[0].notes, 'old notes');
        assert.deepEqual(planKsisAt([record], after, period, 'ME').map((row) => row.outcome), ['existing', 'existing', 'existing']);
    } finally { await browser.close(); }
});

test('AT guard blocks unintended writes and partial autosaves; conflicts stop without retrying later results', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 35000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route('**/*', (route) => {
            if (route.request().url().endsWith('/GetReportBTestResultEntryListPageByCriteria')) return route.fulfill({ contentType: 'application/json', body: '{}' });
            if (route.request().method() === 'POST') { writes++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ studentGuid: 'guid', classId: 'class', testRowId: 1, testGuid: '', saveResult: -1, lockVersion: 0, error: 'conflict', errorCodeType: 1 }]) }); }
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() });
        });
        await page.goto(KSIS_AT_URL);
        const guard = await installKsisAtGuard(page);
        assert.equal(await page.evaluate(() => fetch('/unexpected-save', { method: 'POST' }).then(() => true).catch(() => false)), false);
        assert.equal(await page.evaluate(() => fetch('/kth/api/reportb/SaveReportBTestResultEntryEditItemBatch', { method: 'POST', body: '[]' }).then(() => true).catch(() => false)), false);
        assert.equal(writes, 0); assert.equal(guard.blocked(), 2); await guard.release();
        const initial = await page.evaluate(readKsisAtDocument);
        const nextGuard = await installKsisAtGuard(page);
        const result = await fillAndSaveKsisAt(page, planKsisAt([record], initial, period, 'ME').filter((row) => row.outcome === 'ready'), nextGuard, initial);
        assert.equal(result.pendingDraft, true); assert.deepEqual(result.saved, []); assert.equal(writes, 1); assert.equal(result.failedId, '100:1');
        assert.match(result.message, /ปฏิเสธ/);
        assert.equal(nextGuard.diagnostic().status, 200); assert.equal(nextGuard.diagnostic().confirmed, false);
        assert.equal(nextGuard.diagnostic().rows[0].error, 'conflict');
        await nextGuard.handoff();
        assert.equal(await page.evaluate(() => fetch('/kth/api/reportb/GetReportBTestResultEntryListPageByCriteria', { method: 'POST' }).then(r => r.ok).catch(() => false)), true);
        await page.reload();
        assert.equal((await page.evaluate(readKsisAtDocument)).students[0].tests.some((test) => test.dirty), false);
        await nextGuard.release(); await page.close();
    } finally { await browser.close(); }
});

test('Read-only AT inspection refreshes clean page 1 through the unchanged filter and proves persisted values without a save', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let reads = 0, writes = 0, loads = 0;
        const html = fixture() + `<button id="btnToolbarFilterSort">Filter</button><div class="modal" style="display:none"><select id="filterSubject"><option>Math</option></select><button ng-click="vm.ok()">OK</button></div>
        <script>document.getElementById('btnToolbarFilterSort').onclick=()=>document.querySelector('.modal').style.display='block';document.querySelector('.modal button').onclick=async()=>{
          const saved=await fetch('/kth/api/reportb/GetReportBTestResultEntryListPageByCriteria',{method:'POST',body:'read'}).then(r=>r.json());data[0].time=saved.time;render();document.querySelector('.modal').style.display='none';};</script>`;
        await page.route('**/*', (route) => {
            if (route.request().url().endsWith('/GetReportBTestResultEntryListPageByCriteria')) { reads++; return route.fulfill({ contentType: 'application/json', body: '{"time":"70"}' }); }
            if (route.request().method() === 'POST') { writes++; return route.fulfill({ body: '{}' }); }
            loads++; return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
        });
        await page.goto(KSIS_AT_URL);
        await page.evaluate(() => { data[0].time = '99'; render(); });
        const result = await readKsisAtInspection(page, [{ ...record, TestType1: '', TestType2: '' }], { period, subject: 'ME', kumonId: record['รหัสคุมอง'] });
        assert.equal(result.refreshed, true); assert.equal(result.readOnly, true); assert.equal(result.page, 1);
        assert.equal(result.comparisons[0].matches, true); assert.equal(result.comparisons[0].persisted, true);
        assert.equal(result.tests[0].time.value, '70'); assert.equal(reads, 1); assert.equal(writes, 0); assert.equal(loads, 1);
        assert.equal(page.url(), KSIS_AT_URL);
    } finally { await browser.close(); }
});

test('Read-only inspection never discards dirty AT input or removes a pending guard', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let posts = 0;
        await page.route('**/*', (route) => {
            if (route.request().method() === 'POST') { posts++; return route.fulfill({ body: '{}' }); }
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() + '<button id="btnToolbarFilterSort">Filter</button>' });
        });
        await page.goto(KSIS_AT_URL); const guard = await installKsisAtGuard(page); await guard.handoff();
        const time = page.locator('tr[data-clrowid] td').nth(4).locator('input'); await time.fill('88'); await time.press('Tab');
        const result = await readKsisAtInspection(page, [{ ...record, TestType1: '', TestType2: '' }], { period, subject: 'ME', kumonId: record['รหัสคุมอง'] });
        assert.equal(result.refreshed, false); assert.equal(result.dirty, true); assert.equal(result.comparisons[0].persisted, false);
        assert.equal(await time.inputValue(), '88'); assert.equal(posts, 0);
        assert.equal(await page.evaluate(() => fetch('/unexpected-save', { method: 'POST' }).then(() => true).catch(() => false)), false);
        assert.equal(guard.blocked(), 1); assert.equal(posts, 0); await guard.release();
    } finally { await browser.close(); }
});

test('AT subject selection uses the native filter and read endpoint only, and refuses existing unsaved edits', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000 }, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let reads = 0, writes = 0;
        const html = fixture() + `<button id="btnToolbarFilterSort">Filter</button><div class="modal" style="display:none"><select id="filterSubject"><option>Math</option><option>English EFL</option><option>Thai Reading</option></select><button ng-click="vm.ok()">OK</button></div>
        <script>document.getElementById('btnToolbarFilterSort').onclick=()=>document.querySelector('.modal').style.display='block';document.querySelector('.modal button').onclick=async()=>{
          await fetch('/kth/api/reportb/GetReportBTestResultEntryListPageByCriteria',{method:'POST',body:'read'}).then(r=>r.json());
          const subject=document.getElementById('filterSubject').value;document.querySelector('.filter-label-item').textContent='['+subject+']';
          document.querySelectorAll('tr[data-clrowid]').forEach(row=>row.cells[1].textContent=subject);document.querySelector('.modal').style.display='none';};</script>`;
        await page.route('**/*', (route) => {
            if (route.request().url().endsWith('/GetReportBTestResultEntryListPageByCriteria')) { reads++; return route.fulfill({ contentType: 'application/json', body: '{}' }); }
            if (route.request().method() === 'POST') { writes++; return route.fulfill({ body: '{}' }); }
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
        });
        await page.goto(KSIS_AT_URL);
        const document = await selectKsisAtSubject(page, 'EFL', period);
        assert.equal(document.subjectLabel, 'English EFL'); assert.equal(document.students[0].tests[0].subject, 'EFL');
        assert.equal(reads, 1); assert.equal(writes, 0);
        await page.locator('tr[data-clrowid] td').nth(4).locator('input').fill('40'); await page.locator('tr[data-clrowid] td').nth(4).locator('input').press('Tab');
        await assert.rejects(selectKsisAtSubject(page, 'TRP', period), { statusCode: 409 });
        assert.equal(reads, 1); assert.equal(writes, 0);
    } finally { await browser.close(); }
});

test('AT workspace UI requires explicit save confirmation, confirms no-ID pupils, clears consumed previews and fits narrow panels', { skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000 }, async () => {
    const app = express(); app.use(express.static('public')); const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 } }); const errors = [], actions = [];
        page.on('pageerror', (error) => errors.push(error.message));
        const rows = [{ id: '100:0', name: 'เด็ก ทดสอบ', subject: 'ME', kumonId: '', requiresIdentityConfirmation: true, targetName: 'เด็ก ทดสอบ', birthDate: '01/01/2020', targetBirthDate: '01/01/2020', outcome: 'ready', desired: { date: '2026-10-10', level: 'C', time: 70, score: 0, group: 2 } }];
        await page.route('**/api/**', async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            let data = { success: true };
            if (pathname === '/api/auth/me') data = { user: { role: 'admin', displayName: 'UI Test' }, permissions: ['*'] };
            if (route.request().method() === 'POST') {
                actions.push(pathname);
                if (pathname.endsWith('/preview')) data = { success: true, previewId: 'test-preview', context: 'TEST Oct - 2026', page: 1, period, subject: 'ME', rows };
                else if (pathname.endsWith('/fill')) {
                    assert.deepEqual(route.request().postDataJSON(), { previewId: 'test-preview', confirmSave: true, confirmedIdentityMatches: ['100:0'] });
                    data = { success: true, rows: rows.map((row) => ({ ...row, outcome: 'saved' })), saved: ['100:0'], pendingDraft: false, message: 'บันทึก AT 1 ผลสอบแล้ว' };
                } else assert.fail(`Unexpected action ${pathname}`);
            }
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html?month=10&year=2026`);
        await page.locator('#ksisAtButton').click();
        assert.deepEqual(await page.locator('#ksisAtSubject option').allTextContents(), ['ME', 'EFL', 'TRP']);
        await page.locator('#ksisAtPreview').click(); await page.locator('[data-at-identity]').waitFor();
        assert.equal(await page.locator('#ksisAtFill').isDisabled(), true);
        await page.locator('[data-at-identity]').check(); assert.equal(await page.locator('#ksisAtFill').isDisabled(), false);
        await page.locator('#ksisAtFill').click(); await page.locator('#ksisAtCancel').click(); assert.equal(actions.length, 1);
        for (const [width, height, embedded] of [[1600, 900, false], [1366, 768, true], [390, 844, false]]) {
            await page.setViewportSize({ width, height });
            await page.locator('.ksis-page').evaluate((element, active) => element.classList.toggle('ksis-embedded', active), embedded);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            assert.equal(await page.locator('#ksisAtRows').evaluate((element) => element.clientHeight > 100), true);
            await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-ksis-at-${width}.png`), fullPage: true });
        }
        await page.locator('#ksisAtFill').click(); await page.locator('#ksisAtConfirm').click();
        await page.waitForFunction(() => document.getElementById('ksisAtSource').textContent.includes('บันทึก AT 1'));
        assert.equal(await page.locator('#ksisAtFill').isDisabled(), true); assert.equal(await page.locator('#reportMonth').isDisabled(), false);
        assert.match(await page.locator('#ksisAtRows').innerText(), /บันทึกแล้ว/); assert.doesNotMatch(await page.locator('#ksisAtRows').innerText(), /พร้อมกรอก/);
        assert.deepEqual(actions, ['/api/ksis/at/preview', '/api/ksis/at/fill']); assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
