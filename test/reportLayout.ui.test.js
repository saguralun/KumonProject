import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { chromium } from "playwright-core";
import { once } from "node:events";
import os from "node:os";
import path from "node:path";

test("Report B subject tabs, 20-person pages and period invalidation work on desktop and mobile", {
  skip: process.env.TEST_BROWSER_UI !== "1", timeout: 35000
}, async () => {
  const app = express();
  app.use(express.static("public"));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true, chromiumSandbox: true });
    const page = await browser.newPage({ viewport: { width: 1720, height: 1040 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const rows = Array.from({ length: 45 }, (_, index) => ({
      ID: index + 1, StudentId: index + 100, IDGrade: index % 5 + 1, Grade: ["PK3", "PK2", "PK1", "K", "1"][index % 5],
      Subject: "ME", Status1: index < 4 ? "A" : index > 40 ? "N" : "C", Status2: "",
      "ชื่อจริง": `นักเรียน${String(index).padStart(2, "0")}`, "นามสกุล": "ทดสอบ", "วันเกิด": "01/01/2020", "วันที่สมัคร": "01/01/2026",
      StartLevel: "6A1", PrevLevel: "5A140", CurrentLevel: "5A160", WksUsed: 4,
      TestType: index === 2 ? "AT" : "", Score: index === 2 ? 71 : "", Time: index === 2 ? 28 : "",
      TestType2: index === 2 ? "DT" : "", UsedZI: index === 5 ? 2 : 0, ZIWorksheetNo: 30,
      UsedZII: index === 5 ? 10 : 0, ZIIWorksheetNo: 100
    }));
    rows.push({ ...rows[0], ID: 99, Subject: "EFL", "ชื่อจริง": "ภาษาอังกฤษ" });
    await page.route("**/api/**", async (route) => {
      const url = new URL(route.request().url());
      const data = url.pathname === "/api/auth/me" ? { user: { role: "admin", displayName: "UI Test" }, permissions: ["*"] }
        : url.pathname === "/api/report/monthly" ? { success: true, columns: ["ID", "Subject", "Status1"], rows }
          : url.pathname === "/api/report/level-summary" ? { success: true, subjects: ["ME", "EFL", "TRP"].map((subject) => ({ subject, total: 1, rows: [{ level: "A", count: 1 }] })) }
          : { success: true, rows: [] };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/report.html`);
    await page.locator("#generateButton").click();
    await page.locator(".report-table").waitFor();
    assert.equal(await page.locator(".student-start").count(), 20);
    assert.match(await page.locator("#pageRange").textContent(), /1–20.*45/);
    assert.equal(await page.locator("#previousPage").isDisabled(), true);
    assert.equal(await page.locator(".student-start").first().getAttribute("data-enrollment-id"), "1");
    assert.match(await page.locator(".report-table thead").innerText(), /Zun Zun/);
    const zun = page.locator('[data-enrollment-id="6"] .report-zun');
    assert.deepEqual(await zun.locator(".report-zun-grid").allTextContents(), ["ZI302", "ZII10010"]);
    const borders = await page.locator(".student-start").first().evaluate((row) => ({
      fine: getComputedStyle(row.cells[4]).borderRightColor,
      main: getComputedStyle(row.cells[5]).borderRightColor,
      bottom: getComputedStyle(row.cells[4]).borderBottomColor,
      detail: getComputedStyle(row.cells[0].children[1]).boxShadow
    }));
    assert.notEqual(borders.fine, borders.main);
    assert.equal(borders.bottom, borders.main);
    assert.notEqual(borders.detail, "none");
    for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720]]) {
      await page.setViewportSize({ width, height });
      await page.waitForFunction(() => {
        const wrap = document.getElementById("reportTableWrap");
        return wrap.scrollHeight <= wrap.clientHeight + 1 && wrap.scrollWidth <= wrap.clientWidth + 1;
      }, null, { timeout: 2000 }).catch(async (error) => {
        await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-report-b-overflow-${width}.png`) });
        const dimensions = await page.locator("#reportTableWrap").evaluate((wrap) => ({ width: wrap.clientWidth, height: wrap.clientHeight,
          scrollWidth: wrap.scrollWidth, scrollHeight: wrap.scrollHeight, rowHeight: wrap.querySelector("table").style.cssText }));
        throw new Error(`${width}x${height}: ${JSON.stringify(dimensions)}: ${error.message}`);
      });
      assert.equal(await page.locator(".student-start").count(), 20);
      assert.equal(await zun.locator(".report-zun-grid").evaluateAll((lines) => lines.every((line) =>
        [...line.children].every((cell) => cell.scrollWidth <= cell.clientWidth + 1))), true);
      assert.equal(await page.locator(".student-start").last().evaluate((row) => row.getBoundingClientRect().bottom <= document.getElementById("reportTableWrap").getBoundingClientRect().bottom), true);
      await page.screenshot({ path: path.join(os.tmpdir(), `kumondb-report-b-fit-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 1720, height: 1040 });
    await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-report-b-desktop.png"), fullPage: true });
    await page.locator("#levelSummaryButton").click();
    await page.locator("#levelSummaryTables table").first().waitFor();
    assert.equal(await page.locator("#levelSummary").isVisible(), true);
    for (const selector of ["#reportTableWrap", "#subjectTabs", "#status1Summary", ".report-pagination", "#exportButton"]) {
      assert.equal(await page.locator(selector).isVisible(), false);
    }
    await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-report-summary-only.png"), fullPage: true });
    await page.locator("#generateButton").click();
    await page.locator(".report-table").waitFor();
    assert.equal(await page.locator("#levelSummary").isVisible(), false);
    assert.equal(await page.locator("#reportTableWrap").isVisible(), true);
    assert.equal(await page.locator(".report-pagination").isVisible(), true);
    await page.locator("#nextPage").click();
    assert.match(await page.locator("#pageRange").textContent(), /21–40/);
    await page.locator("#nextPage").click();
    assert.equal(await page.locator(".student-start").count(), 5);
    assert.equal(await page.locator("#nextPage").isDisabled(), true);
    await page.getByRole("tab", { name: /EFL/ }).click();
    assert.equal(await page.locator(".student-start").count(), 1);
    assert.equal(await page.locator("#pageNumber").inputValue(), "1");
    await page.getByRole("tab", { name: /TRP/ }).click();
    assert.equal(await page.locator(".student-start").count(), 0);
    assert.equal(await page.locator("#nextPage").isDisabled(), true);
    await page.getByRole("tab", { name: /ME/ }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(os.tmpdir(), "kumondb-report-b-mobile.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.equal(await page.locator("#reportTableWrap").evaluate((element) => element.scrollWidth > element.clientWidth), true);
    assert.ok(await page.locator(".report-workspace").evaluate((element) => element.clientWidth >= 370));
    await page.locator("#reportYear").fill("2025");
    await page.locator("#reportYear").dispatchEvent("change");
    assert.equal(await page.locator(".student-start").count(), 0);
    assert.equal(await page.locator("#exportButton").isDisabled(), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
