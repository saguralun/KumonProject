import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "playwright-core";
import express from "express";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { readKsisRosterPages } from "../services/ksisRosterService.js";
import { proposeKsisMatches } from '../services/ksisMatchingService.js';
import { controlFixture } from './support/controlFixture.js';

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
            function render(n){document.getElementById('students').innerHTML='<div><table class="vk-grid-content-student"><tr><td></td><td>ตัวอย่าง ทดสอบ'+n+'</td><td>764265000000'+n+'</td><td>PK3</td><td>01/01/2563</td><td></td></tr></table><table class="vk-grid-content-subject"><tr><td></td><td>Math</td><td></td><td>T</td><td></td><td></td><td></td><td></td><td></td><td>'+(n===1?'T':'<select><option selected>C</option><option>T</option></select>')+'</td></tr><tr><td></td><td>English EFL</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td><select style="display:none"><option>T</option></select></td></tr></table></div>';}
            function turn(n){const lis=document.querySelectorAll('.pagination li');lis[2].textContent=n;lis[0].classList.toggle('disabled',n===1);lis[1].classList.toggle('disabled',n===1);lis[3].classList.toggle('disabled',n===2);setTimeout(()=>render(n),30);}
            render(2);document.querySelectorAll('.pagination li')[3].classList.add('disabled');
            </script>` }));
        await page.goto("https://kao.ksis.kumon.com/kth/#/reportbeditgrid");
        const result = await readKsisRosterPages(page);
        assert.equal(result.pagesRead, 2);
        assert.equal(result.rows.length, 2);
        assert.equal(result.rows[0].birthDate, "2020-01-01");
        assert.deepEqual(result.rows.map(row => row.subjects), [[{ subject: 'ME', status: 'T' }], [{ subject: 'ME', status: 'C' }]]);
        const matched = proposeKsisMatches(result.rows, [{ studentId: 2, firstName: 'ตัวอย่าง', lastName: 'ทดสอบ2', birthDate: '2020-01-01',
            enrollments: [{ id: 20, subject: 'ME', kumonId: '' }] }]);
        assert.equal(matched.length, 1); assert.equal(matched[0].fullName, 'ตัวอย่าง ทดสอบ2');
        assert.equal(matched[0].status, 'exact');
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

for (const embedded of [false, true]) test(`ID-less matching previews every new child, uses name+DOB, and never submits their empty IDs (${embedded ? 'desktop' : 'browser'})`, {
    skip: process.env.TEST_BROWSER_UI !== '1', timeout: 30000
}, async () => {
    const students = [11, 12, 13, 14].map(id => ({ studentId: id, firstName: `เด็กใหม่${id}`, lastName: 'ทดสอบ', birthDate: `2023-07-${id}`,
        enrollments: [{ id: id * 10, subject: 'EFL', kumonId: null }] }));
    const roster = students.map(s => ({ fullName: `${s.firstName} ${s.lastName}`, birthDate: s.birthDate, kumonId: s.studentId === 14 ? '7642650000014' : '' }));
    roster.push({ ...roster[0] });
    roster.push({ fullName: 'ทดลองเรียนกรอกผิด', birthDate: '', kumonId: '7642650000014', subjects: [{ subject: 'EFL', status: 'T' }] });
    let confirms = 0;
    const f = await controlFixture('ksis', async (req, res) => {
        if (req.path === '/ksis/desktop/open') { res.json({ success: true }); return true; }
        if (req.path === '/students/ksis/matching/preview') {
            res.json({ success: true, previewId: 'id-less-fixture', context: 'ศูนย์ทดสอบ Nov 2026', pagesRead: 2, rows: proposeKsisMatches(roster, students) }); return true;
        }
        if (req.path === '/students/ksis/matching/confirm') { confirms++; res.status(500).json({ success: false, error: 'Unexpected confirm' }); return true; }
        return false;
    }, { embedded });
    try {
        const { page } = f;
        await page.locator('#ksisMatchingButton').click(); await page.locator('#ksisReadRoster').click();
        await page.locator('#ksisMatchRows tbody tr').first().waitFor();
        assert.match(await page.locator('#ksisMatchCount').innerText(), /4 \/ 4 คน.*เลือก 0 คน/);
        await page.locator('#ksisMatchFilter').selectOption('missing_id');
        const rows = page.locator('#ksisMatchRows tbody tr');
        assert.equal(await rows.count(), 3);
        for (let index = 0; index < 3; index++) {
            const row = rows.nth(index), s = students[index];
            assert.match(await row.locator('td').nth(3).innerText(), new RegExp(`#${s.studentId} .*${s.birthDate}`));
            assert.equal(await row.locator('.match-state').innerText(), 'ยังไม่มีรหัสคุมอง');
            assert.equal(await row.locator('input[type=checkbox]').count(), 0);
            assert.equal(await row.locator('.match-info').count(), 1);
            assert.equal(await row.locator('.match-state').evaluate(el => getComputedStyle(el).backgroundColor), 'rgb(238, 244, 248)');
            assert.match(await row.innerText(), /ใช้จับคู่เพื่อกรอกข้อมูลได้/);
            assert.equal(await row.locator('[data-match-choice]').count(), 0);
        }
        assert.equal(await page.locator('#ksisConfirmMatches').isDisabled(), true);
        await page.locator('#ksisSelectExact').click();
        await page.locator('#ksisMatchFilter').selectOption('all');
        assert.equal(await page.locator('[data-match-check]:checked').count(), 1);
        assert.match(await page.locator('tr:has([data-match-check]:checked)').innerText(), /เด็กใหม่14/);
        await page.locator('#ksisConfirmMatches').click();
        assert.equal(confirms, 0); await page.locator('#ksisCancelConfirm').click();
        await page.locator('#ksisMatchFilter').selectOption('missing_id');
        if (!embedded) await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-matching-missing-id-${embedded ? 'desktop' : 'browser'}.png`), fullPage: true });
        assert.equal(confirms, 0);
        assert.equal(f.writes().every(req => ['/students/ksis/matching/preview', '/ksis/desktop/open'].includes(req.path)), true);
        assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});
