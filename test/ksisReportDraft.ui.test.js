import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";
import express from "express";
import { once } from "node:events";
import { readKsisDraftDocument, planKsisReportDraft, installKsisDraftGuard, fillKsisReportRows } from "../services/ksisReportDraft.js";

function fixture(autoSave = false, { wrongAt = false, clampTime = false } = {}) {
    return `<meta charset="utf-8"><style>table{border-collapse:collapse}td{border:1px solid #ccc;padding:6px}.modal{position:fixed;inset:50px;background:white;border:1px solid #aaa;padding:20px}select,input{width:100px}</style>
    <div class="container-header"><span>ชื่อศูนย์ TEST</span><span> ประจำเดือน Oct - 2026</span></div>
    <button id="btnToolbarSave" onclick="fetch('/save',{method:'POST',body:'save'})">บันทึกหลัก</button>
    <button id="btnToolbarLevelZ" onclick="openZ()">Z</button><button id="btnToolbarATest" onclick="openAT()">AT</button>
    <table><tr><td><table class="vk-grid-content-student"><tr><td></td><td>ตัวอย่าง ทดสอบ</td><td>7642650000001</td><td>PK3</td><td>01/01/2020</td><td></td></tr></table>
    <table class="vk-grid-content-subject"><tr data-clrowid="student-me"><td><span data-ng-show="subject.isDirty" style="display:none">dirty</span></td><td>Math</td><td>C80</td><td>C</td><td></td>
    <td><select onchange="dirty()"><option>C</option><option>D</option></select></td>
    <td><select onchange="dirty()"><option>80</option><option>90</option><option>100</option></select></td>
    <td><input value="0" onchange="dirty();${autoSave ? "fetch('/auto-save',{method:'POST'}).catch(()=>{})" : ""}"></td><td>0</td>
    <td><select onchange="dirty()"><option>C</option><option>A</option><option>R</option><option>OT</option></select></td><td></td><td></td></tr></table></td></tr></table>
    <ul class="pagination"><li class="active">1</li></ul><div id="zEntries"></div><div id="atEntries"></div>
    <div class="modal" id="zModal" style="display:none"><h3>Zun Zun</h3><p>ตัวอย่าง ทดสอบ 7642650000001</p>
    <select id="zLevel"><option>ไม่มี</option><option>ZI</option><option>ZII</option></select>
    <select id="zWorksheet"><option>10</option><option>30</option><option>50</option></select><input id="zUsed" value="0">
    <button data-ng-click="vmPopup.ok()" onclick="saveZ()">บันทึก</button></div>
    <div class="modal" id="atModal" style="display:none"><h3 class="modal-title">${wrongAt ? "คนอื่น ทดสอบ" : "ตัวอย่าง ทดสอบ"}</h3><h1 class="panel-title">Math</h1><h2>AT</h2>
    <label>วันที่<input id="testDate" placeholder="DD/MM/YYYY"></label><label>แบบทดสอบ<select id="testCd"><option></option><option>C</option><option>D</option><option>E</option></select></label>
    <label>เวลา (นาที)<span class="k-numeric-wrap"><input onchange="${clampTime ? "this.value=Math.min(99,Number(this.value))" : ""}"><input id="testTime" hidden></span></label>
    <label>คะแนน<span class="k-numeric-wrap"><input><input id="testScore" hidden></span></label>
    <label>กลุ่ม<select id="atGroup"><option></option>${[1, 2, 3, 4, 5].map((group) => `<option>G${group}</option>`).join("")}</select></label>
    <label><input type="checkbox" id="testResultFlg">ผ่าน</label><input id="testNotes">
    <button ng-click="vm.ok()" onclick="saveAT()">ตกลง</button><button ng-click="vm.cancel()" onclick="document.getElementById('atModal').style.display='none'">ยกเลิก</button></div>
    <script>let z=[];function dirty(){document.querySelector('[data-ng-show]').style.display='inline'}
    function openZ(){document.getElementById('zModal').style.display='block';document.body.dataset.zOpens=Number(document.body.dataset.zOpens||0)+1}
    function saveZ(){z.push([document.getElementById('zLevel').value,document.getElementById('zWorksheet').value,document.getElementById('zUsed').value].join(':'));document.getElementById('zEntries').textContent=z.join('|');document.getElementById('zModal').style.display='none';dirty()}
    let at=[];function openAT(){const m=document.getElementById('atModal');m.querySelectorAll('input').forEach(e=>{e.value='';e.checked=false});m.querySelectorAll('select').forEach(e=>e.selectedIndex=0);m.style.display='block';document.body.dataset.at='clicked'}
    function saveAT(){const m=document.getElementById('atModal');at.push([m.querySelector('#testDate').value,m.querySelector('#testCd').value,m.querySelector('#testTime').parentElement.querySelector('input').value,m.querySelector('#testScore').parentElement.querySelector('input').value,m.querySelector('#atGroup').value,m.querySelector('#testResultFlg').checked].join(':'));document.getElementById('atEntries').textContent=at.join('|');m.style.display='none';dirty()}
    </script>`;
}

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
        await fillKsisReportRows(page, rows, guard);
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
        const rows = planKsisReportDraft([row], await page.evaluate(readKsisDraftDocument), { month: 10, year: 2026 }, "ME");
        assert.equal(rows[0].ready, true);
        const guard = await installKsisDraftGuard(page);
        await fillKsisReportRows(page, rows, guard);
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
            await assert.rejects(fillKsisReportRows(page, rows, guard), options.wrongAt ? /นักเรียนหรือรายวิชา/ : /AT ไม่ตรง/);
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
        await assert.rejects(fillKsisReportRows(page, rows, guard), /ถูกกันไว้/);
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
        let fills = 0, acknowledgements = 0;
        const errors = []; page.on("pageerror", (error) => errors.push(error.message));
        await page.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            let data = { success: true, rows: [] };
            if (url.pathname === "/api/auth/me") data = { user: { role: "admin", displayName: "UI Test" }, permissions: ["*"] };
            if (url.pathname.endsWith("ksis-draft/preview")) data = { success: true, previewId: "draft-token", page: 1, context: "ชื่อศูนย์ TEST ประจำเดือน Oct - 2026", period: { month: 10, year: 2026 }, subject: "ME",
                rows: [{ name: "ตัวอย่าง ทดสอบ", kumonId: "7642650000001", subject: "ME", ready: true,
                    before: { level: { value: "C" }, worksheet: { value: "80" }, used: { value: "0" }, status: { value: "C" } },
                    desired: { level: "C", worksheet: 90, used: 8, status: "C", zun: [{ level: "ZI", worksheet: 30, used: 2 }, { level: "ZII", worksheet: 50, used: 3 }],
                        at: [{ date: "2026-10-01", level: "C", time: 150, score: 71, group: 4, passed: true }] } }] };
            if (url.pathname.endsWith("ksis-draft/fill")) { fills++; data = { success: true, filled: 1, page: 1 }; }
            if (url.pathname.endsWith("ksis-draft/acknowledge")) { acknowledgements++; data = { success: true, acknowledged: true }; }
            await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/report.html`);
        await page.locator("#ksisDraftButton").click();
        assert.equal(await page.locator("#reportTableWrap").isVisible(), false);
        await page.locator("#ksisDraftPreview").click();
        await page.locator("#ksisDraftRows table").waitFor();
        await page.waitForFunction(() => !document.getElementById("ksisDraftFill").disabled);
        assert.match(await page.locator("#ksisDraftRows").innerText(), /150 นาที.*71 คะแนน.*G4.*ผ่าน/);
        assert.equal(fills, 0);
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-draft-preview.png"), fullPage: true });
        await page.locator("#ksisDraftFill").click();
        assert.equal(await page.locator("#ksisDraftDialog").isVisible(), true);
        assert.equal(fills, 0);
        await page.locator("#ksisDraftConfirm").click();
        await page.waitForFunction(() => document.getElementById("ksisDraftSource").textContent.includes("กรอกแล้ว"));
        assert.equal(fills, 1);
        assert.equal(await page.locator("#ksisDraftPreview").isDisabled(), true);
        assert.equal(await page.locator("#ksisDraftAcknowledge").isVisible(), true);
        await page.locator("#ksisDraftAcknowledge").click();
        await page.waitForFunction(() => !document.getElementById("ksisDraftPreview").disabled);
        assert.equal(acknowledgements, 1);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-draft-mobile.png"), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
