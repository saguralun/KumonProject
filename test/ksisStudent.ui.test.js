import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { chromium } from "playwright-core";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";
import { previewKsisStudent } from "../services/ksisStudentService.js";

test("Add Student KSIS Preview requires apply and never saves automatically", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 35000
}, async () => {
    const app = express();
    app.use(express.static("public"));
    const server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    let saved = false;
    const errors = [];
    try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("dialog", (dialog) => dialog.accept());
        const masters = {
            prefixes: [{ id: 1, name: "ด.ช." }, { id: 2, name: "ด.ญ." }],
            genders: [{ id: 1, name: "ชาย" }, { id: 2, name: "หญิง" }],
            grades: [{ id: 1, label: "เตรียมอ. (PK3)" }],
            subjects: [], statuses: [], schedules: [], levels: [], worksheets: [],
            dtMasters: [], studentHints: {}, addressRows: []
        };
        await page.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            let data = { success: true, rows: [] };
            if (url.pathname === "/api/auth/me") data = { user: { role: "admin", displayName: "UI Test" }, permissions: ["*"] };
            if (url.pathname === "/api/students/masters") data.masters = masters;
            if (url.pathname === "/api/students/duplicate") data.duplicate = null;
            if (url.pathname === "/api/students" && route.request().method() === "POST") saved = true;
            if (url.pathname === "/api/students/ksis/preview") data.student = {
                firstName: "ตัวอย่าง", lastName: "ทดสอบ", birthDate: "2023-06-29", gender: "หญิง", grade: "PK3",
                schoolName: "โรงเรียนทดสอบ", addressLine2: "9 เจษฏา", addressZipcode: "53000",
                emailCandidates: [{ source: "มารดา", email: "mother@example.test" }, { source: "บิดา", email: "father@example.test" }],
                addressProvince: "อุตรดิตถ์", addressDistrict: "เมืองอุตรดิตถ์", addressSubdistrict: "ท่าเสา", addressNumber: "1"
            };
            await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/student-manager.html`);
        await page.locator("#addStudentModal:not(.hidden)").waitFor();
        await page.locator("#ksisStudentUrl").fill("https://kao.ksis.kumon.com/kth/#/student/11111111-1111-4111-8111-111111111111");
        await page.locator("#ksisPreviewButton").click();
        await page.locator("#ksisPreview table").waitFor();
        assert.equal(await page.locator('#addStudentForm [name="firstName"]').inputValue(), "");
        assert.equal(saved, false);
        await page.getByRole("radio", { name: "Email (บิดา)", exact: true }).check();
        await page.locator("#ksisApplyButton").click();
        await page.waitForFunction(() => document.querySelector('#addStudentForm [name="firstName"]').value === "ตัวอย่าง");
        assert.equal(await page.locator('#addStudentForm [name="genderId"]').inputValue(), "2");
        assert.equal(await page.locator('#addStudentForm [name="prefixId"]').inputValue(), "2");
        assert.equal(await page.locator('#addStudentForm [name="schoolGradeId"]').inputValue(), "1");
        assert.equal(await page.locator('#addStudentForm [name="addressAlley"]').inputValue(), "9");
        assert.equal(await page.locator('#addStudentForm [name="addressRoad"]').inputValue(), "เจษฏา");
        assert.equal(await page.locator('#addStudentForm [name="remark"]').inputValue(), "");
        assert.equal(await page.locator('#addStudentForm [name="mobile"]').inputValue(), "");
        assert.equal(await page.locator('#addStudentForm [name="email"]').inputValue(), "father@example.test");
        assert.equal(await page.locator('#addStudentForm [name="addressProvince"]').inputValue(), "อุตรดิตถ์");
        assert.equal(await page.locator('#addStudentForm [name="addressDistrict"]').inputValue(), "เมืองอุตรดิตถ์");
        assert.equal(saved, false);
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-preview-desktop.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-ksis-preview-mobile.png"), fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true);
        assert.equal(await page.locator(".student-modal-dialog").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
        await new Promise((resolve) => server.close(resolve));
    }
});

test("KSIS connector extracts the observed form structure through a real browser", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 15000
}, async (t) => {
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    const context = await browser.newContext();
    try {
        // Fulfill all requests locally; this test never contacts the actual KSIS service.
        await context.route("**/*", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<meta charset="utf-8">
            <div id="student">รหัสนักเรียน : 1234567890123</div>
            <input id="firstName" value="ตัวอย่าง"><input id="lastName" value="ทดสอบ">
            <input id="dateOfBirth" value="29/06/2566">
            <select id="gender"><option selected>หญิง</option></select>
            <select id="gradeLevel"><option selected>PK3</option></select>
            <input id="schoolName" value="โรงเรียนทดสอบ"><input id="phoneHP" value="0812345678">
            <input id="studentAddress1" value="1"><input id="studentAddress2" value="19">
            <input id="studentAddress3" value="ท่าเสา">
            <select id="studentStateCd"><option selected>อุตรดิตถ์</option></select>
            <select id="studentCityCd"><option selected>เมืองอุตรดิตถ์</option></select>
            <input id="studentZipCd" value="53000">
            <input id="personalId" value="excluded"><input id="guardianMotherEmail" value="excluded">
            <input id="guardianFatherEmail" value="father@example.test">
            <select id="guardianFatherEmailPresence"><option selected>---</option></select>
        ` }));
        t.mock.method(chromium, "launchPersistentContext", async () => context);
        const result = await previewKsisStudent({ userId: 987655, url: "https://kao.ksis.kumon.com/kth/#/student/11111111-1111-4111-8111-111111111111" });
        assert.equal(result.requiresLogin, false);
        assert.equal(result.student.birthDate, "2023-06-29");
        assert.equal(result.student.addressDistrict, "เมืองอุตรดิตถ์");
        assert.equal(result.student.kumonStudentId, "1234567890123");
        assert.equal(result.student.email, "father@example.test");
        assert.ok(!JSON.stringify(result).includes("excluded"));
    } finally { await browser.close(); }
});
