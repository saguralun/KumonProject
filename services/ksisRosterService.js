import { withKsisWorkspacePage as withKsisPage } from "./ksisStudentService.js";
import { httpError } from "./httpError.js";
import { normalizeKsisBirthDate } from "./ksisStudentData.js";

const REPORT_URL = "https://kao.ksis.kumon.com/kth/#/reportbeditgrid";

export function readKsisRosterDocument() {
    const tables = Array.from(document.querySelectorAll("table.vk-grid-content-student"));
    const pager = document.querySelector("ul.pagination");
    const links = Array.from(pager?.querySelectorAll("li") || []);
    const state = (label) => links.find((li) => li.textContent.trim() === label);
    return {
        page: Number(pager?.querySelector("li.active")?.textContent.trim() || 1),
        hasPrevious: Boolean(state("‹") && !state("‹").classList.contains("disabled")),
        hasNext: Boolean(state("›") && !state("›").classList.contains("disabled")),
        context: (document.querySelector(".container-header")?.textContent || Array.from(document.querySelectorAll("body *"))
            .filter((element) => element.textContent.includes("ชื่อศูนย์") && element.textContent.includes("ประจำเดือน") && element.textContent.length < 250)
            .at(-1)?.textContent || "").replace(/\s+/g, " ").trim(),
        rows: tables.map((table) => {
            const cells = table.rows[0]?.cells || [];
            return { fullName: cells[1]?.textContent.trim() || "", kumonId: cells[2]?.textContent.trim() || "", birthDate: cells[4]?.textContent.trim() || "" };
        })
    };
}

export async function readKsisRosterPages(page) {
    await page.waitForFunction(() => location.hash.includes("/login") || document.querySelector("table.vk-grid-content-student"), {}, { timeout: 20000 });
    if (page.url().includes("/login")) return { requiresLogin: true };
    const assertLocation = () => { if (page.url() !== REPORT_URL) throw httpError(409, "หน้า KSIS เปลี่ยนไป กรุณาอ่านรายชื่อใหม่"); };
    const fingerprint = (data) => data.rows.map((row) => `${row.kumonId}:${row.fullName}:${row.birthDate}`).join("|");
    const turnPage = async (label, current, target) => {
        await page.locator("ul.pagination a").filter({ hasText: new RegExp(`^${label}$`) }).click();
        await page.waitForFunction(({ old, targetPage }) => {
            const active = Number(document.querySelector("ul.pagination li.active")?.textContent.trim());
            const rows = Array.from(document.querySelectorAll("table.vk-grid-content-student")).map((table) => {
                const cells = table.rows[0]?.cells || [];
                return `${cells[2]?.textContent.trim() || ""}:${cells[1]?.textContent.trim() || ""}:${cells[4]?.textContent.trim() || ""}`;
            }).join("|");
            return active === targetPage && rows !== old && rows.length > 0;
        }, { old: fingerprint(current), targetPage: target }, { timeout: 20000 });
        assertLocation();
        return page.evaluate(readKsisRosterDocument);
    };
    assertLocation();
    let data = await page.evaluate(readKsisRosterDocument);
    if (data.hasPrevious) data = await turnPage("«", data, 1);
    const rows = [];
    const seen = new Set();
    const context = data.context;
    for (let count = 0; count < 200; count++) {
        assertLocation();
        if (seen.has(data.page) || data.page !== count + 1 || data.context !== context || !data.rows.length) {
            throw httpError(409, "รายชื่อหรือเดือน KSIS เปลี่ยนระหว่างอ่าน กรุณาเริ่มใหม่");
        }
        seen.add(data.page);
        rows.push(...data.rows.map((row) => ({ ...row, birthDate: normalizeKsisBirthDate(row.birthDate) })));
        if (!data.hasNext) return { requiresLogin: false, rows, pagesRead: seen.size, context };
        data = await turnPage("›", data, data.page + 1);
    }
    throw httpError(409, "จำนวนหน้า KSIS เกินขอบเขต ยังไม่สร้างรายการจับคู่");
}

export async function readKsisReportRoster({ userId }) {
    return withKsisPage({ sourceUrl: REPORT_URL, userId }, readKsisRosterPages);
}
