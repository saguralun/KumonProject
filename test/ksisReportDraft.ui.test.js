import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";
import express from "express";
import { once } from "node:events";
import { readKsisDraftDocument, planKsisReportDraft, installKsisDraftGuard, fillKsisReportRows, summarizeKsisDraft, fillAndSaveKsisWsBatches, saveKsisWsPage, selectConfirmedKsisDraftRows } from "../services/ksisReportDraft.js";

function fixture(autoSave = false, { wrongAt = false, clampTime = false, kendoNumbers = false, zunReadPost = false, wsBatchSave = false } = {}) {
    const number = (value, id, change = "") => kendoNumbers
        ? `<span class="k-numeric-wrap"><input class="k-formatted-value" value="${value}" onfocus="activateNumber(this)"><input ${id ? `id="${id}"` : ""} data-role="numerictextbox" role="spinbutton" style="display:none" value="${value}" onchange="${change}" onblur="commitNumber(this)"></span>`
        : `<input ${id ? `id="${id}"` : ""} value="${value}" onchange="${change}">`;
    return `<meta charset="utf-8"><style>table{border-collapse:collapse}td{border:1px solid #ccc;padding:6px}.modal{position:fixed;inset:50px;background:white;border:1px solid #aaa;padding:20px}select,input{width:100px}</style>
    <div class="container-header"><span>ชื่อศูนย์ TEST</span><span> ประจำเดือน Oct - 2026</span></div>
    <button id="btnToolbarSave" onclick="${wsBatchSave ? "saveWs()" : "fetch('/save',{method:'POST',body:'save'})"}">บันทึกหลัก</button>
    <button id="btnToolbarLevelZ" onclick="openZ()">Z</button><button id="btnToolbarATest" onclick="openAT()">AT</button>
    <table><tr><td><table class="vk-grid-content-student"><tr><td></td><td>ตัวอย่าง ทดสอบ</td><td>7642650000001</td><td>PK3</td><td>01/01/2020</td><td></td></tr></table>
    <table class="vk-grid-content-subject"><tr data-clrowid="student-me"><td><span data-ng-show="subject.isDirty" style="display:none">dirty</span></td><td>Math</td><td>C80</td><td>C</td><td></td>
    <td><select onchange="dirty()"><option>C</option><option>D</option></select></td>
    <td><select onchange="dirty()"><option>80</option><option>90</option><option>100</option></select></td>
    <td>${number("0", "", `dirty();${autoSave ? "fetch('/auto-save?token=do-not-log',{method:'POST',body:'private-test-body'}).catch(()=>{})" : ""}`)}</td><td>0</td>
    <td><select onchange="dirty()"><option>C</option><option>A</option><option>R</option><option>OT</option></select></td><td></td><td></td></tr></table></td></tr></table>
    <ul class="pagination"><li class="active">1</li></ul><div id="zEntries"></div><div id="atEntries"></div>
    <div class="modal" id="zModal" style="display:none"><h3>Zun Zun</h3><p>ตัวอย่าง ทดสอบ 7642650000001</p>
    <select id="zLevel"><option>ไม่มี</option><option>ZI</option><option>ZII</option></select>
    <select id="zWorksheet"><option>10</option><option>30</option><option>50</option></select>${number("0", "zUsed")}
    <button data-ng-click="vmPopup.ok()" onclick="saveZ()">บันทึก</button></div>
    <div class="modal" id="atModal" style="display:none"><h3 class="modal-title">${wrongAt ? "คนอื่น ทดสอบ" : "ตัวอย่าง ทดสอบ"}</h3><h1 class="panel-title">Math</h1><h2>AT</h2>
    <label>วันที่<input id="testDate" placeholder="DD/MM/YYYY"></label><label>แบบทดสอบ<select id="testCd"><option></option><option>C</option><option>D</option><option>E</option></select></label>
    <label>เวลา (นาที)${kendoNumbers ? number("", "testTime", clampTime ? "this.value=Math.min(99,Number(this.value))" : "") : `<span class="k-numeric-wrap"><input onchange="${clampTime ? "this.value=Math.min(99,Number(this.value))" : ""}"><input id="testTime" hidden></span>`}</label>
    <label>คะแนน${kendoNumbers ? number("", "testScore") : '<span class="k-numeric-wrap"><input><input id="testScore" hidden></span>'}</label>
    <label>กลุ่ม<select id="atGroup"><option></option>${[1, 2, 3, 4, 5].map((group) => `<option>G${group}</option>`).join("")}</select></label>
    <label><input type="checkbox" id="testResultFlg">ผ่าน</label><input id="testNotes">
    <button ng-click="vm.ok()" onclick="saveAT()">ตกลง</button><button ng-click="vm.cancel()" onclick="document.getElementById('atModal').style.display='none'">ยกเลิก</button></div>
    <script>let z=[];function dirty(){document.querySelector('[data-ng-show]').style.display='inline'}
    async function saveWs(){const response=await fetch('/kth/api/reportb/SaveReportBDetailEntryEditItemBatch',{method:'POST',body:'test-save'});const result=await response.json();if(response.ok&&result.success!==false){document.querySelectorAll('[data-ng-show]').forEach(e=>e.style.display='none')}}
    function activateNumber(display){const raw=display.nextElementSibling;display.style.display='none';raw.style.display='inline-block';raw.focus()}
    function commitNumber(raw){const display=raw.previousElementSibling;display.value=raw.value;raw.style.display='none';display.style.display='inline-block'}
    function openZ(){${zunReadPost ? "fetch('/kth/api/levelz/GetLevelZListByStudent',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({studentId:'student-me'})}).then(response=>{if(!response.ok)throw new Error('read failed');return response.json()}).then(showZ).catch(()=>{document.body.dataset.zReadFailed='yes'})" : "showZ()"}}
    function showZ(){document.getElementById('zModal').style.display='block';document.body.dataset.zOpens=Number(document.body.dataset.zOpens||0)+1}
    function saveZ(){z.push([document.getElementById('zLevel').value,document.getElementById('zWorksheet').value,document.getElementById('zUsed').value].join(':'));document.getElementById('zEntries').textContent=z.join('|');document.getElementById('zModal').style.display='none';dirty()}
    let at=[];function openAT(){const m=document.getElementById('atModal');m.querySelectorAll('input').forEach(e=>{e.value='';e.checked=false});m.querySelectorAll('select').forEach(e=>e.selectedIndex=0);m.style.display='block';document.body.dataset.at='clicked'}
    function saveAT(){const m=document.getElementById('atModal');at.push([m.querySelector('#testDate').value,m.querySelector('#testCd').value,m.querySelector('#testTime').parentElement.querySelector('${kendoNumbers ? "[data-role=numerictextbox]" : "input"}').value,m.querySelector('#testScore').parentElement.querySelector('${kendoNumbers ? "[data-role=numerictextbox]" : "input"}').value,m.querySelector('#atGroup').value,m.querySelector('#testResultFlg').checked].join(':'));document.getElementById('atEntries').textContent=at.join('|');m.style.display='none';dirty()}
    </script>`;
}

test('Visible fixed R/IT/N/EO statuses override hidden selects and allow only confirmed WS fills, retaining recognized old warnings', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route('**/*', (route) => {
            if (route.request().method() === 'POST') { writes++; return route.fulfill({ body: '{}' }); }
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture() });
        });
        for (const Status1 of ['R', 'IT', 'N', 'EO']) {
            await page.goto('https://kao.ksis.kumon.com/kth/#/reportbeditgrid');
            if (Status1 !== 'R') await page.reload();
            await page.evaluate((status) => {
                document.querySelector('table.vk-grid-content-student').rows[0].cells[2].textContent = '';
                const row = document.querySelector('[data-clrowid="student-me"]');
                row.cells[9].innerHTML = `<select style="display:none" onchange="document.body.dataset.hiddenStatusChanged='yes'"><option>C</option><option>A</option></select><span>${status}</span>`;
                row.cells[11].innerHTML = '<span class="reportb-grid-col-error">(เตือน) กรุณาใส่จำนวนวนแบบฝึกหัดที่ใช้</span>';
            }, Status1);
            const doc = await page.evaluate(readKsisDraftDocument);
            assert.deepEqual(doc.rows[0].status, { value: Status1, writable: false, options: null });
            const rows = planKsisReportDraft([{ ID: 1, StudentId: 100, Subject: 'ME', 'รหัสคุมอง': '', 'ชื่อจริง': 'ตัวอย่าง', 'นามสกุล': 'ทดสอบ',
                'วันเกิด': '01/01/2020', CurrentLevel: 'C90', WksUsed: 8, Status1 }], doc, { month: 10, year: 2026 }, 'ME', { includeZun: false });
            assert.equal(rows[0].ready, true);
            const guard = await installKsisDraftGuard(page);
            const confirmed = selectConfirmedKsisDraftRows(rows, [{ enrollmentId: 1, key: 'student-me' }]);
            const result = await fillKsisReportRows(page, confirmed, guard);
            assert.deepEqual(result.completedKeys, ['student-me']); assert.equal(result.notices.length, 1);
            const actual = (await page.evaluate(readKsisDraftDocument)).rows[0];
            assert.equal(actual.status.value, Status1); assert.equal(actual.used.value, '8'); assert.equal(actual.worksheet.value, '90');
            assert.equal(await page.locator('body').getAttribute('data-hidden-status-changed'), null);
            assert.equal(writes, 0); assert.equal(guard.blocked(), 0);
            if (Status1 === 'EO') {
                await page.locator('[data-clrowid="student-me"] td').nth(7).locator('input').evaluate((input) => {
                    input.value = '0';
                    input.addEventListener('change', () => { input.value = '0'; });
                });
                await assert.rejects(fillKsisReportRows(page, confirmed, guard), /WS used ต้องการ 8 แต่ KSIS แสดง 0/);
                assert.equal(writes, 0);
            }
            await guard.release();
        }
    } finally { await browser.close(); }
});

test('Confirmed ID-less students fill the exact subject row, while unconfirmed rows never change or save', {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 20000
}, async () => {
    const browser = await chromium.launch({ channel: 'chrome', headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let saves = 0;
        await page.route('**/*', (route) => {
            if (route.request().method() === 'POST') { saves++; return route.fulfill({ contentType: 'application/json', body: '{"success":true}' }); }
            return route.fulfill({ contentType: 'text/html; charset=utf-8', body: fixture(false, { wsBatchSave: true }) });
        });
        await page.goto('https://kao.ksis.kumon.com/kth/#/reportbeditgrid');
        await page.evaluate(() => {
            document.querySelector('table.vk-grid-content-student').rows[0].cells[2].textContent = '';
            const status = document.querySelector('table.vk-grid-content-subject').rows[0].cells[9].querySelector('select');
            status.add(new Option('N', 'N')); status.add(new Option('EO', 'EO'));
        });
        const rows = planKsisReportDraft([{ ID: 1, StudentId: 100, Subject: 'ME', 'รหัสคุมอง': '', 'ชื่อจริง': 'ตัวอย่าง', 'นามสกุล': 'ทดสอบ',
            'วันเกิด': '01/01/2020', CurrentLevel: 'C90', WksUsed: 8, Status1: 'N' }], await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, 'ME', { includeZun: false });
        assert.equal(rows[0].ready, true);
        const guard = await installKsisDraftGuard(page, { allowBatchSave: true });
        await assert.rejects(fillKsisReportRows(page, rows, guard), /ยังไม่ได้ยืนยันคู่/);
        assert.equal((await page.evaluate(readKsisDraftDocument)).rows[0].used.value, '0');
        assert.equal(saves, 0);
        const confirmed = selectConfirmedKsisDraftRows(rows, [{ enrollmentId: 1, key: 'student-me' }]);
        await page.locator('table.vk-grid-content-student').evaluate((table) => { table.rows[0].cells[1].textContent = 'เด็กคนอื่น ทดสอบ'; });
        await assert.rejects(fillKsisReportRows(page, confirmed, guard), /เปลี่ยนหลังยืนยันคู่/);
        assert.equal(saves, 0);
        await page.locator('table.vk-grid-content-student').evaluate((table) => { table.rows[0].cells[1].textContent = 'ตัวอย่าง ทดสอบ'; });
        const result = await fillAndSaveKsisWsBatches(page, confirmed, guard);
        assert.deepEqual(result.savedKeys, ['student-me']); assert.equal(saves, 1);
        const actual = (await page.evaluate(readKsisDraftDocument)).rows[0];
        assert.equal(actual.kumonId, ''); assert.equal(actual.status.value, 'N'); assert.equal(actual.used.value, '8');
        assert.equal(actual.worksheet.value, '90');
        await guard.release();
    } finally { await browser.close(); }
});

test("WS batches save every ten students including all subjects, and retain saved progress on a later failure", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 90000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        for (const failSecondSave of [false, true]) {
            const page = await browser.newPage(); const saves = [];
            await page.route("**/*", async (route) => {
                if (route.request().method() === "POST") {
                    assert.match(route.request().url(), /\/SaveReportBDetailEntryEditItemBatch$/);
                    saves.push((await page.evaluate(readKsisDraftDocument)).rows.filter((row) => row.used.value === "8").length);
                    return route.fulfill({ status: failSecondSave && saves.length === 2 ? 500 : 200, contentType: "application/json", body: JSON.stringify({ success: !(failSecondSave && saves.length === 2) }) });
                }
                return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture(false, { wsBatchSave: true }) });
            });
            await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
            await page.evaluate(() => {
                const template = document.querySelector("table.vk-grid-content-student").closest("td");
                const parent = template.parentElement;
                const original = template.cloneNode(true);
                for (let index = 0; index < 23; index++) {
                    const student = index === 0 ? template : original.cloneNode(true);
                    student.querySelector("table.vk-grid-content-student").rows[0].cells[2].textContent = String(7642650000001 + index);
                    const table = student.querySelector("table.vk-grid-content-subject");
                    const row = table.rows[0]; row.dataset.clrowid = `${index}-ME`;
                    const efl = row.cloneNode(true); efl.dataset.clrowid = `${index}-EFL`; efl.cells[1].textContent = "English EFL";
                    table.tBodies[0].append(efl);
                    if (index > 0) parent.append(student);
                }
                document.getElementById("btnToolbarLevelZ").remove(); document.getElementById("btnToolbarATest").remove();
            });
            const records = ["ME", "EFL"].flatMap((Subject) => Array.from({ length: 23 }, (_, index) => ({
                ID: `${index}-${Subject}`, Subject, "รหัสคุมอง": String(7642650000001 + index), "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ",
                CurrentLevel: "C90", WksUsed: 8, Status1: "C"
            })));
            const rows = planKsisReportDraft(records, await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, "ALL", { includeZun: false });
            assert.equal(rows.filter((row) => row.ready).length, 46);
            const guard = await installKsisDraftGuard(page, { allowBatchSave: true });
            // The toolbar is not available to save a half-filled batch.
            await page.locator("#btnToolbarSave").click(); assert.equal(saves.length, 0);
            if (failSecondSave) {
                await assert.rejects(fillAndSaveKsisWsBatches(page, rows, guard), (error) => {
                    assert.equal(error.draftProgress.savedKeys.length, 20);
                    assert.equal(error.draftProgress.completedKeys.length, 40);
                    assert.equal(error.draftProgress.batchesSaved, 1);
                    assert.match(error.message, /บันทึก WS ไม่สำเร็จ/); return true;
                });
                assert.deepEqual(saves, [20, 40]);
            } else {
                const progress = await fillAndSaveKsisWsBatches(page, rows, guard);
                assert.equal(progress.savedKeys.length, 46); assert.equal(progress.batchesSaved, 3);
                assert.deepEqual(saves, [20, 40, 46]);
            }
            assert.equal(guard.blocked(), 0);
            assert.equal(await page.locator("html").getAttribute("data-kumon-manual-save"), null);
            assert.equal(await page.locator("html").getAttribute("data-kumon-allow-main-save"), null);
            assert.equal(await page.locator("body").getAttribute("data-z-opens"), null);
            assert.equal(await page.locator("body").getAttribute("data-at"), null);
            await guard.release(); await page.close();
        }
    } finally { await browser.close(); }
});

test("A rejected WS save response is not reported as saved even with HTTP 200", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 15000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage();
        await page.route("**/*", (route) => route.request().method() === "POST"
            ? route.fulfill({ contentType: "application/json", body: '{"success":false}' })
            : route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture(false, { wsBatchSave: true }) }));
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        const guard = await installKsisDraftGuard(page, { allowBatchSave: true });
        await page.locator('td input').first().fill("8"); await page.locator('td input').first().press("Tab");
        await assert.rejects(saveKsisWsPage(page, guard), /บันทึก WS ไม่สำเร็จ/);
        assert.equal(guard.saveResults()[0].ok, false);
        await guard.release();
    } finally { await browser.close(); }
});

test("Basic fill only changes main fields even if old rows contain Zun and AT, without opening their toolbars", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture(false, { kendoNumbers: true }) });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        await page.locator("#btnToolbarLevelZ").evaluate((button) => button.remove());
        await page.locator("#btnToolbarATest").evaluate((button) => button.remove());
        const rows = planKsisReportDraft([{ ID: 1, Subject: "ME", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ",
            CurrentLevel: "D90", WksUsed: 8, Status1: "C", UsedZI: 2, ZIWorksheetNo: 190, TestType: "AT", DateTest: "bad-date"
        }], await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, "ME", { includeAt: false, includeZun: false });
        assert.equal(rows[0].ready, true);
        rows[0].desired.zun = [{ level: "ZI", worksheet: 30, used: 2 }];
        rows[0].desired.at = [{ date: "2026-10-01", level: "C", time: 15, score: 80, group: 1 }];
        const guard = await installKsisDraftGuard(page);
        const progress = await fillKsisReportRows(page, rows, guard);
        assert.deepEqual(progress.completedKeys, ["student-me"]);
        const actual = (await page.evaluate(readKsisDraftDocument)).rows[0];
        assert.deepEqual([actual.level.value, actual.worksheet.value, actual.used.value, actual.status.value], ["D", "90", "8", "C"]);
        assert.equal(await page.locator("body").getAttribute("data-z-opens"), null);
        assert.equal(await page.locator("body").getAttribute("data-at"), null);
        assert.equal(writes, 0); assert.equal(guard.blocked(), 0);
        await guard.handoff(); await guard.release();
    } finally { await browser.close(); }
});

test("Zun opens through its observed read-only POST, while main save and Zun write requests stay blocked", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let reads = 0, writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") {
                if (route.request().url() === "https://kao.ksis.kumon.com/kth/api/levelz/GetLevelZListByStudent") {
                    reads++; return route.fulfill({ contentType: "application/json", body: "[]" });
                }
                writes++; return route.fulfill({ contentType: "application/json", body: "{}" });
            }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture(false, { zunReadPost: true, kendoNumbers: true }) });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        const rows = planKsisReportDraft([{ ID: 1, Subject: "ME", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ",
            CurrentLevel: "C90", WksUsed: 8, Status1: "C", UsedZI: 2, ZIWorksheetNo: 30, UsedZII: 3, ZIIWorksheetNo: 50,
            TestType: "AT", DateTest: "01/10/2026", LevelTest: "C", Time: 15, Score: 80, Group: 1
        }], await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, "ME");
        const guard = await installKsisDraftGuard(page);
        const progress = await fillKsisReportRows(page, rows, guard, { includeSupplementary: true });
        assert.deepEqual(progress.completedKeys, ["student-me"]);
        assert.equal(reads, 2); assert.equal(guard.blocked(), 0);
        assert.equal(await page.locator("#zEntries").innerText(), "ZI:30:2|ZII:50:3");
        assert.equal(await page.locator("body").getAttribute("data-at"), null);
        assert.equal(await page.locator("#atEntries").innerText(), "");
        await page.locator("#btnToolbarSave").click();
        assert.equal(writes, 0);
        const denied = await page.evaluate(async () => {
            try { await fetch("/kth/api/levelz/SaveLevelZ", { method: "POST", body: "do-not-save" }); return false; }
            catch { return true; }
        });
        assert.equal(denied, true); assert.equal(guard.blocked(), 1); assert.equal(writes, 0);
        assert.equal(guard.blockedRequests()[0].url, "https://kao.ksis.kumon.com/kth/api/levelz/SaveLevelZ");
        await guard.handoff(); await guard.release();
    } finally { await browser.close(); }
});

test("Draft commits focus-swapping Kendo numeric inputs for WS, Zun and AT before proceeding", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture(false, { kendoNumbers: true }) });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        await page.evaluate(() => {
            const row = document.querySelector('[data-clrowid="student-me"]');
            row.cells[11].innerHTML = '<span class="reportb-grid-col-error">กรุณาใส่หน้าแบบฝึกหัด</span>';
            row.cells[7].querySelector('[data-role="numerictextbox"]').addEventListener("change", () => {
                row.cells[11].querySelector("span").style.display = "none";
            });
        });
        const rows = planKsisReportDraft([{ ID: 1, Subject: "ME", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ",
            CurrentLevel: "D90", WksUsed: 8, Status1: "C", UsedZI: 2, UsedZII: 3, ZIWorksheetNo: 30, ZIIWorksheetNo: 50,
            TestType: "AT", DateTest: "01/10/2026", LevelTest: "C", Time: 150, Score: 0, Group: 1,
            TestType1: "AT", DateTest1: "05/10/2026", LevelTest1: "D", Time1: 30, Score1: 90, Group1: 4
        }], await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, "ME", { includeAt: true });
        assert.equal(rows[0].ready, true);
        const guard = await installKsisDraftGuard(page);
        const completed = await fillKsisReportRows(page, rows, guard, { includeSupplementary: true });
        assert.deepEqual(completed, { completedKeys: ["student-me"], notices: [] });
        const actual = (await page.evaluate(readKsisDraftDocument)).rows[0];
        assert.deepEqual([actual.level.value, actual.worksheet.value, actual.used.value], ["D", "90", "8"]);
        assert.equal(actual.validationError, "");
        assert.equal(await page.locator('[data-clrowid="student-me"] input[data-role="numerictextbox"]').inputValue(), "8");
        assert.equal(await page.locator("#zEntries").innerText(), "ZI:30:2|ZII:50:3");
        assert.equal(await page.locator("#atEntries").innerText(), "01/10/2026:C:150:0:G1:true|05/10/2026:D:30:90:G4:true");
        assert.equal(writes, 0); assert.equal(guard.blocked(), 0);
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-kendo-draft-test.png"), fullPage: true });
        await guard.handoff(); await guard.release();
    } finally { await browser.close(); }
});

test("Draft stops on a new KSIS validation error before adding Zun or AT", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture() });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        await page.evaluate(() => {
            const row = document.querySelector('[data-clrowid="student-me"]');
            row.cells[11].innerHTML =
                '<span class="reportb-grid-col-error" style="display:none">hidden error</span><span class="reportb-grid-col-error">กรุณาใส่หน้าแบบฝึกหัด</span>';
            row.cells[7].querySelector("input").addEventListener("change", () => {
                row.cells[11].lastElementChild.textContent = "จำนวนแบบฝึกหัดไม่ถูกต้อง";
            });
        });
        const doc = await page.evaluate(readKsisDraftDocument);
        assert.equal(doc.rows[0].validationError, "กรุณาใส่หน้าแบบฝึกหัด");
        const rows = planKsisReportDraft([{ ID: 1, Subject: "ME", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ",
            CurrentLevel: "C90", WksUsed: 8, Status1: "C", UsedZI: 2, ZIWorksheetNo: 30,
            TestType: "AT", DateTest: "01/10/2026", LevelTest: "C", Time: 15, Score: 80, Group: 1
        }], doc, { month: 10, year: 2026 }, "ME");
        assert.equal(rows[0].ready, true);
        const guard = await installKsisDraftGuard(page);
        await assert.rejects(fillKsisReportRows(page, rows, guard, { includeSupplementary: true }), (error) => {
            assert.match(error.message, /ตัวอย่าง ทดสอบ.*ME.*KSIS แจ้ง: จำนวนแบบฝึกหัดไม่ถูกต้อง/);
            assert.deepEqual(error.draftProgress, { completedKeys: [], failedKey: "student-me", notices: [] });
            return true;
        });
        assert.equal(await page.locator("body").getAttribute("data-z-opens"), null);
        assert.equal(await page.locator("body").getAttribute("data-at"), null);
        assert.equal(writes, 0); assert.equal(guard.blocked(), 0);
        await guard.handoff(); await guard.release();
    } finally { await browser.close(); }
});

test("Draft identifies the Z toolbar step when the button cannot be reached instead of hiding the timeout", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture() });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        await page.locator("#btnToolbarLevelZ").evaluate((button) => { button.disabled = true; });
        const rows = planKsisReportDraft([{ ID: 1, Subject: "ME", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ",
            CurrentLevel: "C90", WksUsed: 8, Status1: "C", UsedZI: 2, ZIWorksheetNo: 30
        }], await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, "ME");
        const guard = await installKsisDraftGuard(page);
        await assert.rejects(fillKsisReportRows(page, rows, guard, { includeSupplementary: true }), (error) => {
            assert.equal(error.statusCode, 409);
            assert.match(error.message, /ตัวอย่าง ทดสอบ.*ME.*กดปุ่ม Z เพื่อเปิด Zun Zun.*ไม่สำเร็จภายในเวลาที่กำหนด/);
            assert.deepEqual(error.draftProgress.completedKeys, []);
            assert.equal(error.draftProgress.failedKey, "student-me");
            return true;
        });
        assert.equal((await page.evaluate(readKsisDraftDocument)).rows[0].used.value, "8");
        assert.equal(await page.locator("#zEntries").innerText(), "");
        assert.equal(writes, 0); assert.equal(guard.blocked(), 0);
        await guard.handoff(); await guard.release();
    } finally { await browser.close(); }
});

test("Draft fills main fields plus two Z dialogs, never saves main or touches AT/DT, and permits later human save", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        let writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") { writes++; return route.fulfill({ contentType: "application/json", body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture() });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        const doc = await page.evaluate(readKsisDraftDocument);
        const rows = planKsisReportDraft([{ ID: 1, Subject: "ME", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ", "วันเกิด": "01/01/2020",
            CurrentLevel: "D90", WksUsed: 8, Status1: "R", UsedZI: 2, UsedZII: 3, ZIWorksheetNo: 30, ZIIWorksheetNo: 50 }], doc, { month: 10, year: 2026 }, "ME");
        assert.equal(rows[0].ready, true);
        const guard = await installKsisDraftGuard(page);
        await fillKsisReportRows(page, rows, guard, { includeSupplementary: true });
        assert.equal(writes, 0); assert.equal(guard.blocked(), 0);
        assert.equal(await page.locator("#zEntries").textContent(), "ZI:30:2|ZII:50:3");
        assert.equal(await page.locator("body").getAttribute("data-z-opens"), "2");
        assert.equal(await page.locator("body").getAttribute("data-at"), null);
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-filled-draft-test.png"), fullPage: true });
        await guard.handoff();
        await page.locator("#btnToolbarSave").click();
        await page.waitForResponse((response) => response.url().endsWith("/save"));
        assert.equal(writes, 1);
        await guard.release();
    } finally { await browser.close(); }
});

test("All-subject fill continues past intentional unfilled-row filter errors without crossing data or saving main", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture() });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        await page.evaluate(() => {
            const row = document.querySelector('tr[data-clrowid="student-me"]');
            row.cells[11].innerHTML = '<span class="reportb-grid-col-error">กรุณาใส่หน้าแบบฝึกหัด</span>';
            for (const [code, name] of [["EFL", "English EFL"], ["TRP", "Thai Reading"]]) {
                const clone = row.cloneNode(true);
                clone.setAttribute("data-clrowid", `student-${code.toLowerCase()}`);
                clone.cells[1].textContent = name;
                if (code === "TRP") clone.cells[5].querySelector("select").innerHTML = "<option>CI</option><option>CII</option>";
                row.parentElement.append(clone);
            }
        });
        const records = [["ME", "C90", 8], ["EFL", "D100", 4], ["TRP", "CII90", 6]].map(([Subject, CurrentLevel, WksUsed], index) => ({
            ID: index + 1, Subject, CurrentLevel, WksUsed, IsKc: Subject === "ME", Status1: "C", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ"
        }));
        const rows = planKsisReportDraft(records, await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, "ALL");
        assert.equal(rows.length, 3); assert.ok(rows.every((row) => row.ready));
        const guard = await installKsisDraftGuard(page);
        const completed = await fillKsisReportRows(page, rows, guard);
        const summary = summarizeKsisDraft(rows, completed.completedKeys, null, "", completed.notices);
        assert.equal(summary.filled, 3); assert.equal(summary.studentsFilled, 1);
        assert.equal(summary.filterNotices, 3); assert.equal(summary.stopped, false);
        assert.ok(summary.rows.every((row) => row.outcome === "filled"));
        assert.ok(summary.rows.every((row) => row.resultReason.includes("ข้อความตัวกรองเดิม")));
        const actual = (await page.evaluate(readKsisDraftDocument)).rows;
        assert.deepEqual(actual.map((row) => [row.subject, row.level.value, row.worksheet.value, row.used.value]), [
            ["ME", "C", "90", "1"], ["EFL", "D", "100", "4"], ["TRP", "CII", "90", "6"]
        ]);
        assert.ok(actual.every((row) => row.validationError === "กรุณาใส่หน้าแบบฝึกหัด"));
        assert.equal(writes, 0); assert.equal(guard.blocked(), 0);
        await guard.handoff(); await guard.release();
    } finally { await browser.close(); }
});

test("A rows are never edited and mismatch reports preserve verified rows and identify the failing field", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture() });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        await page.evaluate(() => {
            const base = document.querySelector('tr[data-clrowid="student-me"]');
            base.cells[11].innerHTML = '<span class="reportb-grid-col-error">กรุณาใส่หน้าแบบฝึกหัด</span>';
            for (const [subject, name] of [["efl", "English EFL"], ["trp", "Thai Reading"]]) {
                const clone = base.cloneNode(true); clone.dataset.clrowid = `student-${subject}`; clone.cells[1].textContent = name;
                if (subject === "efl") clone.cells[7].querySelector("input").onchange = (event) => { event.target.value = "0"; };
                else clone.cells[9].querySelector("select").value = "A";
                base.parentElement.append(clone);
            }
        });
        const records = ["ME", "EFL", "TRP"].map((Subject, index) => ({ ID: index + 1, Subject, CurrentLevel: "C90", WksUsed: 5, Status1: "C",
            "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ" }));
        const rows = planKsisReportDraft(records, await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, "ALL");
        assert.equal(rows[2].skipped, true);
        const guard = await installKsisDraftGuard(page);
        // Even a direct fill call cannot change an A row.
        await fillKsisReportRows(page, [rows[2]], guard);
        assert.equal(await page.locator('[data-clrowid="student-trp"] td').nth(9).locator("select").inputValue(), "A");
        await assert.rejects(fillKsisReportRows(page, rows.filter((row) => row.ready), guard), (error) => {
            assert.match(error.message, /ตัวอย่าง ทดสอบ.*EFL.*WS used ต้องการ 5 แต่ KSIS แสดง 0/);
            const summary = summarizeKsisDraft(rows, error.draftProgress.completedKeys, error.draftProgress.failedKey, error.message, error.draftProgress.notices);
            assert.equal(summary.filled, 1); assert.equal(summary.skipped, 1);
            assert.equal(summary.filterNotices, 1);
            assert.deepEqual(summary.rows.map((row) => row.outcome), ["filled", "failed", "skipped"]);
            return true;
        });
        assert.equal(writes, 0);
        await guard.handoff(); await guard.release();
    } finally { await browser.close(); }
});

test("Draft adds three ATs with dates, levels, time, zero score, group and passed checked, without saving main", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture() });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        const row = { ID: 1, Subject: "ME", "รหัสคุมอง": "7642650000001", "ชื่อจริง": "ตัวอย่าง", "นามสกุล": "ทดสอบ",
            CurrentLevel: "C90", WksUsed: 8, Status1: "C", TestType: "AT", DateTest: "01/10/2569", LevelTest: "C", Time: 150, Score: 0, Group: 1,
            TestType1: "AT", DateTest1: "05/10/2026", LevelTest1: "D", Time1: 30, Score1: 90, Group1: 4,
            TestType2: "AT", DateTest2: "10/10/2026", LevelTest2: "E", Time2: 28, Score2: 100, Group2: 5 };
        const rows = planKsisReportDraft([row], await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, "ME", { includeAt: true });
        assert.equal(rows[0].ready, true);
        const guard = await installKsisDraftGuard(page);
        await fillKsisReportRows(page, rows, guard, { includeSupplementary: true });
        assert.equal(await page.locator("#atEntries").innerText(), "01/10/2026:C:150:0:G1:true|05/10/2026:D:30:90:G4:true|10/10/2026:E:28:100:G5:true");
        assert.equal(writes, 0); assert.equal(guard.blocked(), 0);
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-at-draft-test.png"), fullPage: true });
        await guard.handoff(); await guard.release();
    } finally { await browser.close(); }
});

test("Draft stops before AT confirmation for the wrong child or a clamped time", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        for (const options of [{ wrongAt: true }, { clampTime: true }]) {
            const page = await browser.newPage();
            await page.route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture(false, options) }));
            await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
            const rows = [{ key: "student-me", name: "ตัวอย่าง ทดสอบ", subject: "ME", desired: { level: "C", worksheet: 90, used: 8, status: "C", zun: [],
                at: [{ date: "2026-10-01", level: "C", time: 150, score: 71, group: 4, passed: true }] } }];
            const guard = await installKsisDraftGuard(page);
            await assert.rejects(fillKsisReportRows(page, rows, guard, { includeSupplementary: true }), options.wrongAt ? /นักเรียนหรือรายวิชา/ : /AT ไม่ตรง/);
            assert.equal(await page.locator("#atEntries").innerText(), "");
            await guard.handoff(); await guard.release(); await page.close();
        }
    } finally { await browser.close(); }
});

test("Draft guard blocks a field's unexpected automatic POST and never silently persists it", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let writes = 0;
        await page.route("**/*", (route) => {
            if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture(true) });
        });
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        const guard = await installKsisDraftGuard(page);
        const rows = [{ key: "student-me", kumonId: "7642650000001", desired: { level: "C", worksheet: 90, used: 8, status: "C", zun: [] } }];
        await assert.rejects(fillKsisReportRows(page, rows, guard), (error) => {
            assert.match(error.message, /POST https:\/\/kao.ksis.kumon.com\/auto-save ถูกกันไว้/);
            assert.doesNotMatch(error.message, /do-not-log|private-test-body/);
            return true;
        });
        assert.deepEqual(guard.blockedRequests(), [{ method: "POST", url: "https://kao.ksis.kumon.com/auto-save", resourceType: "fetch" }]);
        const snapshot = guard.blockedRequests(); snapshot[0].url = "changed";
        assert.equal(guard.blockedRequests()[0].url, "https://kao.ksis.kumon.com/auto-save");
        assert.equal(writes, 0);
        await guard.handoff(); await guard.release();
    } finally { await browser.close(); }
});

test("Draft UI previews before fill, requires confirmation, and locks reads until manual review acknowledgement", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 30000
}, async () => {
    const app = express(); app.use(express.static("public"));
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1720, height: 1000 } });
        page.on("dialog", (dialog) => dialog.accept());
        let fills = 0, acknowledgements = 0, plannedRows = [];
        const errors = []; page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            let data = { success: true, rows: [] };
            if (url.pathname === "/api/auth/me") data = { user: { role: "admin", displayName: "UI Test" }, permissions: ["*"] };
            if (url.pathname.endsWith("/ksis/draft/preview")) {
                assert.equal(route.request().postDataJSON().subject, "ALL");
                assert.equal(route.request().postDataJSON().includeAt, undefined);
                data = { success: true, previewId: "draft-token", page: 1, context: "ชื่อศูนย์ TEST ประจำเดือน Oct - 2026", period: { month: 10, year: 2026 }, subject: "ALL",
                rows: [{ name: "ตัวอย่าง ทดสอบ", kumonId: "7642650000001", subject: "ME", ready: true,
                    before: { level: { value: "C" }, worksheet: { value: "80" }, used: { value: "0" }, status: { value: "C" } },
                    desired: { level: "C", worksheet: 90, used: 8, status: "C", zun: [{ level: "ZI", worksheet: 30, used: 2 }, { level: "ZII", worksheet: 50, used: 3 }],
                        at: [{ date: "2026-10-01", level: "C", time: 150, score: 71, group: 4, passed: true }] } }] };
                data.rows.push(...["EFL", "TRP"].map((subject) => ({ ...data.rows[0], subject })));
                data.rows[0].isKc = true; data.rows[0].desired = { ...data.rows[0].desired, used: 1 };
                data.rows.push({ ...data.rows[0], name: "เด็กสถานะ A", skipped: true, ready: false, reason: "ข้ามสถานะ A" });
                plannedRows = data.rows;
                data.scope = "WS_ONLY";
            }
            if (url.pathname.endsWith("/ksis/draft/fill")) {
                assert.equal(route.request().postDataJSON().saveAfterFill, true);
                fills++;
                const stopped = fills > 1;
                data = { success: true, stopped, error: stopped ? "ตัวอย่าง ทดสอบ • EFL: WS used ต้องการ 8 แต่ KSIS แสดง 0 • มีข้อมูลค้างใน KSIS กรุณาตรวจเอง" : "",
                    filled: stopped ? 1 : 3, studentsFilled: 1, skipped: 1, page: 1, filterNotices: 1,
                    saved: !stopped, savedCount: stopped ? 0 : 3, studentsSaved: stopped ? 0 : 1, batchesSaved: stopped ? 0 : 1, pendingDraft: stopped,
                    rows: plannedRows.map((row, index) => ({ ...row,
                        outcome: row.skipped ? "skipped" : !stopped ? "saved" : index === 0 ? "filled" : index === 1 ? "failed" : "not_started",
                        resultReason: stopped && index === 1 ? "WS used ต้องการ 8 แต่ KSIS แสดง 0" : index === 0 ? "KSIS ยังแสดงข้อความตัวกรองเดิม • ค่าที่อ่านกลับตรงกับรายงาน" : "" })) };
            }
            if (url.pathname.endsWith("/ksis/draft/acknowledge")) { acknowledgements++; data = { success: true, acknowledged: true }; }
            await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html`);
        await page.locator("#ksisDraftButton").click();
        assert.equal(await page.locator("#ksisDraftSubject").inputValue(), "ALL");
        assert.equal(await page.locator("#ksisDraftIncludeAt").count(), 0);
        assert.equal(await page.locator("#ksisAudit").isVisible(), false);
        await page.locator("#ksisDraftPreview").click();
        await page.locator("#ksisDraftRows table").waitFor();
        await page.waitForFunction(() => !document.getElementById("ksisDraftFill").disabled);
        assert.doesNotMatch(await page.locator("#ksisDraftRows").innerText(), /150 นาที|Zun Zun/);
        assert.equal(await page.locator("#ksisDraftRows th").count(), 5);
        assert.equal(await page.locator("#ksisDraftRows tbody tr").count(), 3);
        assert.equal(await page.locator("#ksisDraftRows").innerText().then((value) => value.includes("เด็กสถานะ A")), false);
        assert.match(await page.locator("#ksisDraftRows tbody tr").first().innerText(), /KC/);
        assert.match(await page.locator("#ksisDraftSource").innerText(), /ข้าม A 1/);
        assert.match(await page.locator("#ksisDraftSource").innerText(), /ทุกวิชา.*พร้อม 3 รายวิชา/);
        assert.equal(fills, 0);
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-draft-preview.png"), fullPage: true });
        await page.locator("#ksisDraftFill").click();
        assert.equal(await page.locator("#ksisDraftDialog").isVisible(), true);
        assert.match(await page.locator("#ksisDraftConfirmText").innerText(), /3 รายวิชา.*ทุกวิชา/);
        assert.equal(fills, 0);
        await page.locator("#ksisDraftConfirm").click();
        await page.waitForFunction(() => document.getElementById("ksisDraftSource").textContent.includes("กรอกแล้ว"));
        assert.equal(fills, 1);
        assert.equal(await page.locator("#ksisDraftRows .match-state").allTextContents().then((labels) => labels.every((label) => label === "กรอกและบันทึกแล้ว")), true);
        assert.match(await page.locator("#ksisDraftSource").innerText(), /1 คน \/ 3 รายวิชา/);
        assert.match(await page.locator("#ksisDraftSource").innerText(), /ข้อความตัวกรองเดิม 1 รายวิชา/);
        assert.equal(await page.locator("#ksisDraftRows .draft-result-notice").count(), 1);
        assert.equal(await page.locator("#ksisDraftRows .draft-result-notice").evaluate((element) => getComputedStyle(element).color), "rgb(100, 116, 139)");
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-draft-summary.png"), fullPage: true });
        assert.equal(await page.locator("#ksisDraftPreview").isDisabled(), false);
        assert.equal(await page.locator("#ksisDraftAcknowledge").isVisible(), false);
        await page.waitForFunction(() => !document.getElementById("ksisDraftPreview").disabled);
        assert.equal(acknowledgements, 0);
        await page.locator("#ksisDraftPreview").click();
        await page.waitForFunction(() => !document.getElementById("ksisDraftFill").disabled);
        assert.match(await page.locator("#ksisDraftSource").innerText(), /WS เท่านั้น/);
        assert.doesNotMatch(await page.locator("#ksisDraftRows").innerText(), /150 นาที/);
        await page.locator("#ksisDraftFill").click();
        assert.match(await page.locator("#ksisDraftConfirmScope").innerText(), /ไม่กรอก Zun\/AT\/DT/);
        assert.match(await page.locator("#ksisDraftConfirmScope").innerText(), /บันทึกทุก 10 คน/);
        await page.locator("#ksisDraftConfirm").click();
        await page.waitForFunction(() => document.getElementById("ksisDraftSource").textContent.includes("WS used ต้องการ 8"));
        assert.deepEqual(await page.locator("#ksisDraftRows .match-state").allTextContents(), ["กรอกแล้ว (รอตรวจการบันทึก)", "ต้องตรวจ", "ยังไม่ได้กรอก"]);
        assert.match(await page.locator("#ksisDraftRows .draft-result-reason:not(.draft-result-notice)").innerText(), /ต้องการ 8 แต่ KSIS แสดง 0/);
        assert.equal(await page.locator("#ksisDraftPreview").isDisabled(), true);
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-draft-stopped-summary.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-draft-mobile.png"), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
