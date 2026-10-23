import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import express from "express";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { readSavedKsisWsPages } from "../services/ksisWsAudit.js";

const url = "https://kao.ksis.kumon.com/kth/#/reportbeditgrid";
function fixture(initial, dirty = false, autoSave = false) {
    return `<meta charset="utf-8"><div class="container-header">ชื่อศูนย์ TEST ประจำเดือน Oct - 2026</div>
    <button id="buttonReportBAction" onclick="document.getElementById('refreshMenu').style.display='block'">RB</button>
    <div id="refreshMenu" style="display:none"><a data-ng-click="buttonClicked({message:'btnPopupReportBActionRefresh'})" onclick="refreshSaved()">Refresh</a></div>
    <div id="students"></div><input id="untouched" value="original"><button id="save" onclick="fetch('/save',{method:'POST'})">Save</button>
    <ul class="pagination"><li><a onclick="render(1)">«</a></li><li><a>‹</a></li><li class="active">1</li><li><a onclick="setTimeout(()=>render(2),25)">›</a></li></ul>
    <script>window.loginMemory='session-alive';async function refreshSaved(){
      document.getElementById('refreshMenu').style.display='none';document.getElementById('buttonReportBAction').disabled=true;
      ${autoSave ? "fetch('/unexpected-save',{method:'POST'}).catch(()=>{})" : ""}
      await fetch('/kth/api/reportb/GetReportBDetailEntryListPageByCriteria',{method:'POST',body:'read-only'}).then(r=>r.json());
      render(1);document.getElementById('buttonReportBAction').disabled=false;
    }function render(n){
      document.getElementById('students').innerHTML='<table><tr><td><table class="vk-grid-content-student"><tr><td></td><td>นักเรียน '+n+'</td><td>764265000000'+n+'</td><td>PK3</td><td>01/01/2020</td></tr></table><table class="vk-grid-content-subject"><tr data-clrowid="p'+n+'"><td><span data-ng-show="subject.isDirty" style="display:${dirty ? "inline" : "none"}">dirty</span></td><td>Math</td><td></td><td></td><td></td><td><select><option>C</option></select></td><td><select><option>90</option></select></td><td><input value="8"></td><td></td><td><select><option>C</option></select></td><td></td><td></td></tr></table></td></tr></table>';
      const links=document.querySelectorAll('.pagination li'); links[2].textContent=n; links[0].classList.toggle('disabled',n===1); links[1].classList.toggle('disabled',n===1); links[3].classList.toggle('disabled',n===2);
    }render(${initial});</script>`;
}

test("Audit uses native Refresh, preserves login and document, returns to the selected page and traverses read-only", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage(); let loads = 0, writes = 0, reads = 0;
        await page.route("**/*", (route) => {
            if (route.request().url().endsWith('/GetReportBDetailEntryListPageByCriteria')) { reads++; return route.fulfill({ contentType: 'application/json', body: '{}' }); }
            if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
            return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture(++loads === 1 ? 2 : 1) });
        });
        await page.goto(url);
        // A clean-looking in-memory value is not accepted as proof of persistence.
        await page.locator('td input').fill("99");
        const current = await readSavedKsisWsPages(page, { month: 10, year: 2026, scope: "current" });
        assert.equal(loads, 1); assert.equal(reads, 1); assert.equal(current.documents[0].page, 2);
        assert.equal(current.documents[0].rows[0].used.value, "8");
        const all = await readSavedKsisWsPages(page, { month: 10, year: 2026, scope: "all" });
        assert.equal(all.pagesRead, 2); assert.deepEqual(all.documents.map((doc) => doc.page), [1, 2]);
        assert.equal(await page.locator("#untouched").inputValue(), "original"); assert.equal(writes, 0);
        assert.equal(reads, 2); assert.equal(loads, 1); assert.equal(await page.evaluate(() => window.loginMemory), 'session-alive');
    } finally { await browser.close(); }
});

test("Audit refuses dirty data and a wrong period without navigating, and blocks writes during native Refresh", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        for (const mode of ["dirty", "period", "autosave"]) {
            const page = await browser.newPage(); let loads = 0, writes = 0;
            await page.route("**/*", (route) => {
                if (route.request().url().endsWith('/GetReportBDetailEntryListPageByCriteria')) return route.fulfill({ contentType: 'application/json', body: '{}' });
                if (route.request().method() === "POST") { writes++; return route.fulfill({ body: "{}" }); }
                loads++; return route.fulfill({ contentType: "text/html; charset=utf-8", body: fixture(1, mode === "dirty", mode === "autosave") });
            });
            await page.goto(url);
            await assert.rejects(readSavedKsisWsPages(page, { month: mode === "period" ? 9 : 10, year: 2026 }), { statusCode: 409 });
            assert.equal(loads, 1); assert.equal(writes, 0); await page.close();
        }
    } finally { await browser.close(); }
});

test("K-sis audit UI filters differences, invalidates periods, remains read-only, and fits desktop/mobile", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 30000
}, async () => {
    const app = express(); app.use(express.static("public")); const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    let browser;
    try {
        browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
        const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
        const errors = []; page.on("pageerror", (error) => errors.push(error.message)); const actions = [];
        let role = "admin", permissions = ["*"], releaseAudit;
        const auditReady = new Promise((resolve) => { releaseAudit = resolve; });
        await page.route("**/api/**", async (route) => {
            const pathname = new URL(route.request().url()).pathname;
            let data = { success: true };
            if (pathname === "/api/auth/me") data = { user: { role, displayName: "UI Test" }, permissions };
            if (route.request().method() === "POST") {
                actions.push(pathname); assert.equal(pathname, "/api/ksis/ws-audit");
                const request = route.request().postDataJSON(); assert.equal(request.month, 10);
                await auditReady;
                if (request.scope === "all") return route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, requiresLogin: true }) });
                data = { success: true, pagesRead: 1, originalPage: 1, period: { month: 10, year: 2026 }, subject: "ALL", context: "TEST Oct - 2026", verifiedAt: "2026-10-22T12:00:00Z", outsidePage: 20, ignoredBlankRows: 466, repeatedRows: 2,
                    counts: { matched: 1, mismatch: 1, skipped: 1 }, rows: ["matched", "mismatch", "skipped"].map((outcome, index) => ({
                        name: `เด็กทดสอบ ${index}`, kumonId: `764265000000${index}`, subject: "ME", page: 1, outcome,
                        expected: { level: "C", worksheet: 90, used: 8, status: index === 2 ? "OT" : "C" }, actual: { level: "C", worksheet: 90, used: index === 1 ? 3 : 8, status: index === 2 ? "OT" : "C" },
                        differences: index === 1 ? [{ field: "used" }] : [], reason: index === 1 ? "WS used" : ""
                    })) };
            }
            return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        await page.goto(`${base}/report.html`);
        assert.equal(await page.locator("#ksisDraftButton").count(), 0);
        assert.equal(await page.locator('a[href="/ksis.html"]').count(), 1);
        await page.goto(`${base}/ksis.html?month=10&year=2026`);
        await page.locator("#ksisAuditButton").click(); await page.locator("#ksisAuditCurrent").click();
        assert.equal(await page.locator("#ksisDraftButton").isDisabled(), true);
        assert.equal(await page.locator("#reportMonth").isDisabled(), true);
        releaseAudit();
        await page.locator(".audit-table").waitFor();
        assert.equal(await page.locator("#ksisAuditRows tbody tr").count(), 3);
        assert.equal(await page.locator(".audit-difference").count(), 1);
        assert.match(await page.locator('#ksisAuditSource').innerText(), /ไม่นับช่องวิชาว่าง 466 แถว.*รวมแถวเดิมที่แสดงซ้ำ 2 แถว/);
        assert.match(await page.locator('#ksisAuditCounts').innerText(), /ข้าม A\/OT/);
        assert.match(await page.locator('#statusLine').innerText(), /ต้องตรวจ 1 รายวิชา/);
        await page.locator("#ksisAuditFilter").selectOption("issues"); assert.equal(await page.locator("#ksisAuditRows tbody tr").count(), 1);
        await page.locator("#ksisAuditSearch").fill("missing"); assert.equal(await page.locator("#ksisAuditRows tbody tr").count(), 0);
        await page.locator("#ksisAuditSearch").fill(""); await page.locator("#ksisAuditFilter").selectOption("all");
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-workspace-audit-desktop.png"), fullPage: true });
        for (const [width, height] of [[1366, 768], [390, 844]]) {
            await page.setViewportSize({ width, height });
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
            assert.equal(await page.locator("#ksisAuditRows").evaluate((element) => element.clientHeight > 100), true);
        }
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-workspace-audit-mobile.png"), fullPage: true });
        await page.locator("#ksisAuditAll").click();
        await page.waitForFunction(() => document.getElementById("ksisAuditSource").textContent.includes("กรุณาเข้าสู่ระบบ"));
        assert.doesNotMatch(await page.locator("#statusLine").innerText(), /กำลังตรวจ/);
        assert.equal(await page.locator("#ksisAuditAll").isDisabled(), false);
        await page.locator("#reportMonth").selectOption("9");
        assert.equal(await page.locator(".audit-table").count(), 0);
        assert.deepEqual(actions, ["/api/ksis/ws-audit", "/api/ksis/ws-audit"]); assert.deepEqual(errors, []);
        for (const [nextRole, grants, visible] of [["instructor", ["page:report"], true], ["staff", ["page:report"], false], ["guest", ["*"], false], ["instructor", [], false]]) {
            role = nextRole; permissions = grants;
            await page.goto(`${base}/report.html`);
            await page.waitForFunction((expected) => document.documentElement.dataset.role === expected, role);
            assert.equal(await page.locator('[data-ksis-link]').evaluate((link) => getComputedStyle(link).display !== "none"), visible);
        }
    } finally { await browser?.close(); await new Promise((resolve) => server.close(resolve)); }
});
