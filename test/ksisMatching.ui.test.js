import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import express from "express";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { readKsisRosterPages } from "../services/ksisRosterService.js";

test("KSIS roster reader visits all pages without editing form values or saving", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage();
        await page.route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<span>ชื่อศูนย์ TEST ประจำเดือน Oct - 2026</span>
            <input id="untouched" value="original"><button onclick="document.body.dataset.saved='yes'">Save</button>
            <div id="students"></div><ul class="pagination"><li><a href="#" onclick="turn(1);return false">«</a></li><li><a>‹</a></li>
            <li class="active">2</li><li><a href="#" onclick="turn(2);return false">›</a></li></ul>
            <script>
            function render(n){document.getElementById('students').innerHTML='<table class="vk-grid-content-student"><tr><td></td><td>ตัวอย่าง ทดสอบ'+n+'</td><td>764265000000'+n+'</td><td>PK3</td><td>01/01/2563</td><td></td></tr></table>';}
            function turn(n){const lis=document.querySelectorAll('.pagination li');lis[2].textContent=n;lis[0].classList.toggle('disabled',n===1);lis[1].classList.toggle('disabled',n===1);lis[3].classList.toggle('disabled',n===2);setTimeout(()=>render(n),30);}
            render(2);document.querySelectorAll('.pagination li')[3].classList.add('disabled');
            </script>` }));
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        const result = await readKsisRosterPages(page);
        assert.equal(result.pagesRead, 2);
        assert.equal(result.rows.length, 2);
        assert.equal(result.rows[0].birthDate, "2020-01-01");
        assert.equal(await page.locator("#untouched").inputValue(), "original");
        assert.equal(await page.locator("body").getAttribute("data-saved"), null);
    } finally { await browser.close(); }
});

test("Matching view requires review and explicit confirmation before any save request", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 30000
}, async () => {
    const app = express(); app.use(express.static("public"));
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    let saves = 0;
    try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
        const errors = []; page.on("pageerror", (error) => errors.push(error.message));
        const makeRow = (id, status) => ({ kumonId: `764265000000${id}`, fullName: `ตัวอย่าง ทดสอบ${id}`, birthDate: "2020-01-01", status,
            candidates: status === "unmatched" ? [] : [{ studentId: id, name: `ตัวอย่าง ทดสอบ${id}`, birthDate: status === "review" ? "2021-01-01" : "2020-01-01",
                conflict: status === "conflict", enrollments: [{ id: id * 10, subject: "ME", kumonId: "" }] }] });
        await page.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            let data = { success: true, rows: [] };
            if (url.pathname === "/api/auth/me") data = { user: { role: "admin", displayName: "UI Test" }, permissions: ["*"] };
            if (url.pathname.endsWith("/matching/preview")) data = { success: true, previewId: "preview-token", pagesRead: 2, context: "ศูนย์ทดสอบ • Oct 2026",
                rows: [makeRow(1, "exact"), makeRow(2, "review"), makeRow(3, "conflict"), makeRow(4, "unmatched")] };
            if (url.pathname.endsWith("/matching/confirm")) {
                saves++;
                assert.deepEqual(route.request().postDataJSON(), { previewId: "preview-token", selections: [{ kumonId: "7642650000001", studentId: 1 }] });
                data = { success: true, studentsUpdated: 1, enrollmentsUpdated: 1 };
            }
            await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/ksis.html`);
        await page.locator("#ksisMatchingButton").click();
        assert.equal(await page.locator("#ksisDraft").isVisible(), false);
        assert.equal(await page.locator("#ksisAudit").isVisible(), false);
        await page.locator("#ksisReadRoster").click();
        await page.locator(".matching-table").waitFor();
        assert.equal(saves, 0);
        assert.equal(await page.locator("#ksisConfirmMatches").isDisabled(), true);
        await page.locator("#ksisSelectExact").click();
        assert.equal(await page.locator('[data-match-check]:checked').count(), 1);
        await page.locator("#ksisConfirmMatches").click();
        assert.equal(saves, 0);
        assert.equal(await page.locator("#ksisMatchConfirmDialog").isVisible(), true);
        await page.locator("#ksisCancelConfirm").click();
        assert.equal(saves, 0);
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-matching.png"), fullPage: true });
        await page.locator("#ksisConfirmMatches").click();
        await page.locator("#ksisSaveConfirm").click();
        await page.waitForFunction(() => document.getElementById("ksisMatchingSource").textContent.includes("บันทึกรหัสแล้ว"));
        assert.equal(saves, 1);
        assert.equal(await page.locator("#ksisConfirmMatches").isDisabled(), true);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-matching-mobile.png"), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});
