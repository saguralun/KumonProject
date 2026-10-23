import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { chromium } from "playwright-core";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

async function fixture({ role = "admin", enrollmentStatus = "C" } = {}) {
    const app = express(); app.use(express.static("public"));
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const writes = [], profiles = [], errors = [];
    context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
    const subjects = [{ id: 1, code: "ME", name: "Math" }, { id: 2, code: "EFL", name: "English" }];
    const masters = { prefixes: [{ id: 1, name: "ด.ช." }], genders: [{ id: 1, name: "ชาย" }], grades: [{ id: 1, label: "PK3" }], subjects,
        statuses: [{ id: 1, group: 1, code: "C", name: "Continue" }, { id: 2, group: 1, code: "A", name: "Absent" }],
        levels: subjects.map((subject) => ({ id: subject.id, subjectId: subject.id, code: "A", type: 1 })),
        worksheets: subjects.map((subject) => ({ id: subject.id, levelMasterId: subject.id, worksheetNo: 1 })),
        schedules: [], dtMasters: [], studentHints: {}, addressRows: [] };
    const student = { studentId: 999, displayName: "เด็กยังไม่จ่าย ทดสอบ", firstName: "เด็กยังไม่จ่าย", lastName: "ทดสอบ", prefixId: 1, genderId: 1, schoolGradeId: 1 };
    const enrollments = subjects.map((subject, index) => ({ enrollmentId: [101, 202][index], subjectId: subject.id, subjectCode: subject.code,
        currentLevelMasterId: subject.id, currentLevelCode: "A", startingWorksheetMasterId: subject.id, enStartDate: "2026-01-01",
        currentStatusGroup1Id: index === 1 && enrollmentStatus === "A" ? 2 : 1, statusGroup1Code: index === 1 ? enrollmentStatus : "C", statusGroup1Name: "Continue" }));
    await context.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== "GET") writes.push(url.pathname);
        let data = { success: true, rows: [] };
        if (url.pathname === "/api/auth/me") data = { user: { role, displayName: "UI Test" }, permissions: ["*"] };
        if (url.pathname === "/api/students/masters") data.masters = masters;
        if (url.pathname === "/api/students/search") data.rows = [{ studentId: 42, displayName: "เด็กคนอื่น" }];
        if (/^\/api\/students\/\d+$/.test(url.pathname)) { profiles.push(url.pathname); data = { success: true, student, enrollments }; }
        if (url.pathname === "/api/payment/status") {
            const rows = [
                { studentId: 999, studentName: student.displayName, sourceEnrollmentId: 202, subjects: "ME #101 A, EFL #202 A", paymentState: "unpaid", isPaid: false, isPartial: false, expectedNetAmount: 3400 },
                { studentId: 998, studentName: "เด็กจ่ายแล้ว", sourceEnrollmentId: 201, subjects: "ME #201 A", paymentState: "paid", isPaid: true, isPartial: false, netAmount: 1700 },
                { studentId: 997, studentName: "เด็กจ่ายบางส่วน", sourceEnrollmentId: 200, subjects: "ME #200 A", paymentState: "partial", isPaid: false, isPartial: true, unpaidNetAmount: 1700 }
            ];
            const status = url.searchParams.get("status");
            data = { success: true, billingMonth: 10, billingYear: 2026, rows: status === "all" ? rows : rows.filter((row) => row.paymentState === status),
                summary: { totalStudents: 3, paidStudents: 1, partialStudents: 1, unpaidStudents: 1 } };
        }
        if (url.pathname === "/api/payment/printer-status") data = { success: true, supported: false, detail: "Test" };
        await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    return { context, writes, profiles, errors, base: `http://127.0.0.1:${server.address().port}`,
        async close() { await browser.close(); await new Promise((resolve) => server.close(resolve)); } };
}

test("Unpaid status pill navigates the same tab to the exact student and subject without automatic status changes", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 30000
}, async () => {
    const f = await fixture();
    try {
        const page = await f.context.newPage();
        await page.goto(`${f.base}/payment.html`);
        const link = page.locator(".payment-unpaid-shortcut"); await link.waitFor();
        assert.equal(await link.innerText(), "ยังไม่จ่าย");
        assert.equal(await link.getAttribute("target"), null);
        assert.equal(await page.locator(".payment-unpaid-label").isVisible(), false);
        assert.equal(await page.locator(".payment-table tbody td:last-child a").count(), 0);
        assert.equal(await page.locator("#paymentTableWrap").innerText().then((text) => text.includes("ไป Absent")), false);
        const href = new URL(await link.getAttribute("href"), f.base);
        assert.equal(href.searchParams.get("studentId"), "999");
        assert.equal(href.searchParams.get("enrollmentId"), "202");
        assert.equal(href.searchParams.get("focus"), "absent");
        await page.locator('[data-status-filter="all"]').click();
        await page.waitForFunction(() => document.querySelectorAll(".payment-table tbody tr").length === 3);
        assert.equal(await link.count(), 1);
        assert.equal(await page.locator(".payment-table tbody td:last-child button").count(), 3);
        assert.equal(await page.locator(".payment-table tbody td:first-child .status-pill:visible").count(), 3);
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-payment-absent-link.png"), fullPage: true });
        const tabsBefore = f.context.pages().length;
        await link.click();
        await page.waitForURL("**/student-manager.html?**");
        const student = page;
        assert.equal(f.context.pages().length, tabsBefore);
        await student.waitForFunction(() => document.activeElement?.id === "enrollmentAbsentButton", null, { timeout: 3000 }).catch(async () => {
            throw new Error(JSON.stringify(await student.evaluate(() => ({ status: document.getElementById("statusLine").textContent,
                focused: document.activeElement?.id, role: document.documentElement.dataset.role,
                button: document.getElementById("enrollmentAbsentButton").outerHTML,
                display: getComputedStyle(document.getElementById("enrollmentAbsentButton")).display }))) + JSON.stringify(f.errors));
        });
        assert.match(await student.locator("#pageTitle").innerText(), /เด็กยังไม่จ่าย/);
        assert.equal(await student.locator('#enrollmentForm [name="enrollmentId"]').inputValue(), "202");
        assert.equal(await student.locator('#enrollmentTabs .active').getAttribute("data-enrollment-id"), "202");
        assert.equal(await student.locator("#enrollmentAbsentButton").isVisible(), true);
        const directory=await student.locator('.student-directory').boundingBox();
        const profile=await student.locator('.student-workspace > .form-grid').boundingBox();
        assert.ok(directory.x+directory.width<=profile.x,'Selected student remains in the independent left-hand directory');
        assert.equal(await student.locator('.app-menu-panel').isVisible(),false);
        assert.equal(await student.locator("#enrollmentAbsentButton").getAttribute("class").then((value) => value.includes("payment-absent-target")), true);
        assert.deepEqual(f.writes, []);
        assert.ok(f.profiles.every((url) => url === "/api/students/999"));
        await student.locator("#enrollmentAbsentButton").click();
        await student.locator('#enrollmentResumeDialog').waitFor();
        assert.deepEqual(f.writes, []);
        await student.locator('#enrollmentResumeCancel').click();
        await student.screenshot({ path: path.join(os.tmpdir(), "kumondb-student-absent-focused.png"), fullPage: true });
        await student.locator('[data-enrollment-id="101"]').click();
        assert.equal(await student.locator(".payment-absent-target").count(), 0);
        for(const width of [1366,1024]) {
            await student.setViewportSize({width,height:768});
            assert.equal(await student.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
            for(const id of ['newStudentButton','saveStudentButton','newEnrollmentButton','saveEnrollmentButton']) {
                assert.equal(await student.locator(`#${id}`).evaluate(element=>{const rect=element.getBoundingClientRect(),panel=element.closest('.panel').getBoundingClientRect();return rect.left>=panel.left&&rect.right<=panel.right+1;}),true,`${id}: fits its panel at ${width}px`);
            }
            await student.screenshot({path:path.join(os.tmpdir(),`kumondb-student-directory-filled-${width}.png`)});
        }
        await student.setViewportSize({ width: 390, height: 844 });
        await student.reload();
        await student.waitForFunction(() => document.activeElement?.id === "enrollmentAbsentButton", null, { timeout: 5000 });
        assert.equal(await student.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await student.screenshot({ path: path.join(os.tmpdir(), "kumondb-student-absent-mobile.png"), fullPage: true });
        await page.goBack();
        await page.locator(".payment-unpaid-shortcut").waitFor();
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-payment-absent-mobile.png"), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

test("Inactive subject links do not focus another subject's Absent button", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 20000
}, async () => {
    const f = await fixture({ enrollmentStatus: "A" });
    try {
        const page = await f.context.newPage();
        await page.goto(`${f.base}/student-manager.html?studentId=999&enrollmentId=202&focus=absent`);
        await page.waitForFunction(() => document.getElementById("statusLine").textContent.includes("ไม่มีปุ่ม Absent"));
        assert.equal(await page.locator('#enrollmentForm [name="enrollmentId"]').inputValue(), "202");
        assert.equal(await page.locator("#enrollmentAbsentButton").isVisible(), false);
        assert.deepEqual(f.writes, []); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

test("Guest cannot see the Payment Absent link or receive an Absent focus", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 20000
}, async () => {
    const f = await fixture({ role: "guest" });
    try {
        const page = await f.context.newPage(); await page.goto(`${f.base}/payment.html`);
        await page.locator(".payment-unpaid-shortcut").waitFor({ state: "attached" });
        assert.equal(await page.locator(".payment-unpaid-shortcut").isVisible(), false);
        assert.equal(await page.locator(".payment-unpaid-label").isVisible(), true);
        assert.equal(await page.locator(".payment-unpaid-label").innerText(), "ยังไม่จ่าย");
        await page.goto(`${f.base}/student-manager.html?studentId=999&enrollmentId=202&focus=absent`);
        await page.waitForFunction(() => document.getElementById("statusLine").textContent === "พร้อมแก้ไข");
        assert.equal(await page.locator("#enrollmentAbsentButton").isVisible(), false);
        assert.equal(await page.locator(".payment-absent-target").count(), 0);
        assert.deepEqual(f.writes, []); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});

test("Invalid or mismatched deep links never target an unrelated student's status", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 25000
}, async () => {
    const f = await fixture({ role: "instructor" });
    try {
        const page = await f.context.newPage();
        await page.goto(`${f.base}/payment.html`);
        await page.locator(".payment-unpaid-shortcut").waitFor();
        await page.goto(`${f.base}/student-manager.html?studentId=bad&focus=absent`);
        await page.waitForFunction(() => document.getElementById("statusLine").textContent.includes("ลิงก์ไม่ถูกต้อง"));
        assert.deepEqual(f.profiles, []);
        await page.goto(`${f.base}/student-manager.html?studentId=999&enrollmentId=777&focus=absent`);
        await page.waitForFunction(() => document.getElementById("statusLine").textContent.includes("ไม่พบรายวิชา"));
        assert.equal(await page.locator(".payment-absent-target").count(), 0);
        await page.goto(`${f.base}/student-manager.html?studentId=999&enrollmentId=202&focus=absent`);
        await page.waitForFunction(() => document.activeElement?.id === "enrollmentAbsentButton", null, { timeout: 3000 }).catch(async () => {
            throw new Error(JSON.stringify(await page.evaluate(() => ({ status: document.getElementById("statusLine").textContent,
                focused: document.activeElement?.id, role: document.documentElement.dataset.role,
                button: document.getElementById("enrollmentAbsentButton").outerHTML }))) + JSON.stringify(f.errors));
        });
        assert.deepEqual(f.writes, []); assert.deepEqual(f.errors, []);
    } finally { await f.close(); }
});
