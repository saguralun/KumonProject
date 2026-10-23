import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { chromium } from "playwright-core";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

test("WS progress and packet bars follow ME/EFL/TRP on subject and Main/Zun switches without changing status colors or data", {
    skip: process.env.TEST_BROWSER_UI !== "1", timeout: 35000
}, async () => {
    const app = express(); app.use(express.static("public"));
    const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
    const browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    try {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
        const errors = [], writes = [];
        page.on("pageerror", (error) => errors.push(error.message));
        const enrollments = ["ME", "EFL", "TRP"].map((subjectCode, index) => ({
            enrollmentId: index + 1, subjectCode, studentName: "นักเรียน ทดสอบสี", currentLevelMasterId: index + 1,
            currentLevelCode: subjectCode === "TRP" ? "HI" : "H", statusName: "Continue", currentZunLevelMasterId: 99, currentZunLevelCode: "ZI"
        }));
        const monthSummary = { billingMonth: 10, billingYear: 2026, usedDays: 11, cpwsRecords: 11 };
        await page.route("**/api/**", async (route) => {
            const url = new URL(route.request().url());
            if (route.request().method() !== "GET") writes.push(url.pathname);
            let data = { success: true, rows: [] };
            if (url.pathname === "/api/auth/me") data = { user: { role: "admin", displayName: "UI Test" }, permissions: ["*"] };
            if (url.pathname === "/api/worksheet/search") data.rows = [enrollments[0]];
            if (url.pathname.endsWith("/worksheet-summary")) data.worksheetMonthSummary = monthSummary;
            const match = url.pathname.match(/\/enrollments\/(\d+)\/context$/);
            if (match) {
                const enrollment = enrollments[Number(match[1]) - 1];
                data = { enrollment, studentEnrollments: enrollments,
                    defaults: { patternCode: "daily10", receiveDate: "2026-10-20", mainWorksheetNo: 101 },
                    patterns: [{ code: "daily10", shortLabel: "10/วัน", suffixes: [1], dayOffsets: [0] }],
                    worksheetOptions: { main: Array.from({ length: 20 }, (_, index) => ({ worksheetNo: index * 10 + 1 })), zun: [{ worksheetNo: 1 }, { worksheetNo: 21 }] },
                    worksheetProgress: { main: { levelCode: enrollment.currentLevelCode, displayWorksheetNo: 110, percent: 55 }, zun: { levelCode: "ZI", displayWorksheetNo: 30, percent: 30, maxWorksheetNo: 100 } },
                    worksheetPacketSummary: { main: { levelCode: enrollment.currentLevelCode, rows: [{ packetWorksheetNo: 1, count: 2 }, { packetWorksheetNo: 61, count: 4 }] },
                        zun: { levelCode: "ZI", rows: [{ packetWorksheetNo: 21, count: 3 }] } },
                    worksheetMonthSummary: monthSummary,
                    history: [{ worksheetUsedId: 1, worksheetType: "WS", worksheetDate: "2026-10-19", levelMasterId: enrollment.currentLevelMasterId,
                        levelCode: enrollment.currentLevelCode, worksheetLabel: `${enrollment.currentLevelCode}101`, packetWorksheetNo: 101, cpws: true, isStockProcessed: true }]
                };
            }
            await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
        });
        await page.goto(`http://127.0.0.1:${server.address().port}/worksheet.html`);
        await page.locator("#studentSearch").fill("1");
        await page.locator(".result-item").first().click();
        await page.locator(".packet-bar-fill").first().waitFor();
        const palette = {
            ME: { stroke: "rgb(17, 168, 220)", text: "rgb(2, 132, 199)", top: "rgb(34, 183, 232)", bottom: "rgb(47, 95, 230)" },
            EFL: { stroke: "rgb(234, 88, 12)", text: "rgb(194, 65, 12)", top: "rgb(251, 146, 60)", bottom: "rgb(234, 88, 12)" },
            TRP: { stroke: "rgb(5, 150, 105)", text: "rgb(4, 120, 87)", top: "rgb(52, 211, 153)", bottom: "rgb(5, 150, 105)" }
        };
        let statusColors;
        for (const [width, height] of [[1600, 1000], [1024, 768]]) {
            await page.setViewportSize({ width, height });
            for (const enrollment of enrollments) {
                await page.locator("#studentSubjectSelect").selectOption(String(enrollment.enrollmentId));
                await page.waitForFunction((subject) => document.querySelector(".worksheet-page").dataset.wsSubject === subject, enrollment.subjectCode);
                const colors = await page.evaluate(() => ({ stroke: getComputedStyle(document.querySelector(".worksheet-progress-bar")).stroke,
                    text: getComputedStyle(document.getElementById("worksheetProgressCaption")).color,
                    gradient: getComputedStyle(document.querySelector(".packet-bar-fill")).backgroundImage,
                    status: [...document.querySelectorAll(".history-table .badge")].map((element) => getComputedStyle(element).backgroundColor) }));
                const expected = palette[enrollment.subjectCode];
                assert.equal(colors.stroke, expected.stroke); assert.equal(colors.text, expected.text);
                await page.waitForFunction((color) => getComputedStyle(document.querySelector(".worksheet-progress-tab.active")).color === color, expected.text);
                assert.ok(colors.gradient.includes(expected.top)); assert.ok(colors.gradient.includes(expected.bottom));
                if (!statusColors) statusColors = colors.status;
                assert.deepEqual(colors.status, statusColors);
                assert.equal(await page.locator("#worksheetProgressCaption").innerText(), "55%");
                assert.equal(await page.locator("#worksheetProgressValue").innerText(), "110");
                assert.equal(await page.locator(".packet-bar-item").count(), 20);
                assert.equal(await page.locator(".packet-bar-value").allTextContents().then((values) => values.map(Number).reduce((sum, value) => sum + value, 0)), 6);
                await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-ws-colors-${enrollment.subjectCode}-${width}.png`), fullPage: true });
                await page.locator('[data-progress-kind="zun"]').click();
                assert.equal(await page.locator("#worksheetProgressCaption").innerText(), "30%");
                assert.equal(await page.locator(".packet-bar-item").count(), 10);
                assert.equal(await page.locator(".worksheet-progress-bar").evaluate((element) => getComputedStyle(element).stroke), expected.stroke);
                assert.ok(await page.locator(".packet-bar-fill").first().evaluate((element) => getComputedStyle(element).backgroundImage).then((value) => value.includes(expected.bottom)));
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
                const ring = await page.locator("#worksheetProgressRing").boundingBox();
                assert.ok(ring.width >= 90 && ring.height >= 90);
            }
        }
        await page.setViewportSize({ width: 1600, height: 1000 });
        await page.locator("#studentSubjectSelect").selectOption("1");
        await page.waitForFunction(() => document.querySelector(".worksheet-page").dataset.wsSubject === "ME");
        assert.equal(await page.locator(".worksheet-progress-bar").evaluate((element) => getComputedStyle(element).stroke), palette.ME.stroke);
        assert.deepEqual(writes, []); assert.deepEqual(errors, []);
    } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
