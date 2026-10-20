import { createHash, randomUUID } from "node:crypto";
import { withKsisPage } from "./ksisStudentService.js";
import { buildMonthlyReport } from "./reportService.js";
import { normalizeKumonStudentId } from "./kumonStudentId.js";
import { normalizeKsisBirthDate } from "./ksisStudentData.js";
import { httpError } from "./httpError.js";

const REPORT_URL = "https://kao.ksis.kumon.com/kth/#/reportbeditgrid";
const REPORT_SUBJECTS = ["ME", "EFL", "TRP"];
const previews = new Map();
const hash = (data) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
const compactName = (value) => String(value || "").normalize("NFC").replace(/\s+/g, "");
const numericTestValue = (value) => value == null || String(value).trim() === "" ? NaN : Number(value);

export function readKsisDraftDocument() {
    const visible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
    const field = (cell) => {
        const controls = Array.from(cell?.querySelectorAll("select,input") || []);
        const select = controls.find((element) => element.tagName === "SELECT");
        const input = controls.find(visible);
        const control = select || input;
        return { value: select ? select.selectedOptions[0]?.textContent.trim() || "" : input ? input.value.trim() : cell?.innerText.trim() || "",
            writable: visible(control) && !control.disabled && !control.readOnly,
            options: select ? Array.from(select.options).map((option) => option.textContent.trim()) : null };
    };
    const context = (document.querySelector(".container-header")?.textContent || Array.from(document.querySelectorAll("body *"))
        .filter((element) => element.textContent.includes("ชื่อศูนย์") && element.textContent.includes("ประจำเดือน") && element.textContent.length < 250)
        .at(-1)?.textContent || "").replace(/\s+/g, " ").trim();
    return { context, page: Number(document.querySelector("ul.pagination li.active")?.textContent.trim() || 1),
        modalOpen: Array.from(document.querySelectorAll(".modal")).some(visible),
        rows: Array.from(document.querySelectorAll("table.vk-grid-content-student")).flatMap((table) => {
            const studentCells = table.rows[0]?.cells || [];
            const subjectTable = table.parentElement.querySelector("table.vk-grid-content-subject");
            return Array.from(subjectTable?.rows || []).map((row) => ({
                key: row.getAttribute("data-clrowid"), kumonId: studentCells[2]?.textContent.trim() || "",
                fullName: studentCells[1]?.textContent.trim() || "", birthDate: studentCells[4]?.textContent.trim() || "",
                subject: ({ Math: "ME", "English EFL": "EFL", "Thai Reading": "TRP" })[row.cells[1]?.textContent.trim()] || "",
                dirty: Array.from(row.querySelectorAll('[data-ng-show*="isDirty"]')).some(visible),
                level: field(row.cells[5]), worksheet: field(row.cells[6]), used: field(row.cells[7]), status: field(row.cells[9])
            }));
        }) };
}

export function ksisContextPeriod(context) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const match = context.match(/ประจำเดือน\s+([A-Za-z]{3})\s*-\s*(\d{4})/);
    return match ? { month: months.findIndex((month) => month.toLowerCase() === match[1].toLowerCase()) + 1, year: Number(match[2]) } : null;
}

export function planKsisReportDraft(records, document, period, subject) {
    if (!["ALL", ...REPORT_SUBJECTS].includes(subject)) throw httpError(400, "กรุณาเลือกวิชาหรือทุกวิชา");
    const websitePeriod = ksisContextPeriod(document.context);
    if (!websitePeriod || websitePeriod.month !== Number(period.month) || websitePeriod.year !== Number(period.year)) throw httpError(409, "เดือน/ปีใน KSIS ไม่ตรงกับรายงาน หยุดไว้ก่อน ยังไม่กรอก");
    if (document.modalOpen) throw httpError(409, "กรุณาปิดหน้าต่างย่อยใน KSIS ก่อนอ่าน Preview");
    if (document.rows.some((row) => row.dirty)) throw httpError(409, "หน้า KSIS มีข้อมูลที่แก้ค้างอยู่ กรุณาจัดการข้อมูลเดิมก่อน ไม่เขียนทับ");
    const result = [];
    const keyFor = (code, subjectCode) => `${normalizeKumonStudentId(code)}:${subjectCode}`;
    const subjects = subject === "ALL" ? REPORT_SUBJECTS : [subject];
    for (const record of subjects.flatMap((code) => records.filter((row) => row.Subject === code))) {
        const kumonId = normalizeKumonStudentId(record["รหัสคุมอง"]);
        const targets = document.rows.filter((row) => keyFor(row.kumonId, row.subject) === keyFor(kumonId, record.Subject));
        const duplicates = records.filter((row) => keyFor(row["รหัสคุมอง"], row.Subject) === keyFor(kumonId, record.Subject));
        const current = String(record.CurrentLevel || "").match(/^(.*\D)(\d+)$/);
        const desired = { level: current?.[1] || "", worksheet: current ? Number(current[2]) : null,
            used: Number(record.WksUsed), status: record.Status1,
            at: ["", "1", "2"].filter((suffix) => record[`TestType${suffix}`] === "AT").map((suffix) => ({
                date: normalizeKsisBirthDate(record[`DateTest${suffix}`]), level: String(record[`LevelTest${suffix}`] || "").trim(),
                time: numericTestValue(record[`Time${suffix}`]), score: numericTestValue(record[`Score${suffix}`]),
                group: numericTestValue(record[`Group${suffix}`]), passed: true
            })),
            zun: [["ZI", record.UsedZI, record.ZIWorksheetNo], ["ZII", record.UsedZII, record.ZIIWorksheetNo]]
                .filter(([, used]) => Number(used) > 0).map(([level, used, worksheet]) => ({ level, used: Number(used), worksheet: Number(worksheet) })) };
        const target = targets[0];
        let reason = !/^\d{13}$/.test(kumonId) ? "ยังไม่มีรหัสคุมองครบ 13 หลัก" : duplicates.length !== 1 ? "รหัสและวิชาซ้ำในรายงาน" : targets.length > 1 ? "รหัสและวิชาซ้ำใน KSIS"
            : !target ? "ไม่อยู่ในหน้า KSIS ปัจจุบัน" : !target.key ? "ไม่พบตัวระบุแถว KSIS"
                : normalizeKsisBirthDate(record["วันเกิด"]) && normalizeKsisBirthDate(target.birthDate) !== normalizeKsisBirthDate(record["วันเกิด"]) ? "วันเกิดไม่ตรงกัน"
                    : !target.status.options?.includes(desired.status) || !target.status.writable ? `KSIS ไม่อนุญาต ST1 ${desired.status}`
                        : !Number.isInteger(desired.used) || desired.used < 0 ? "จำนวน WS ไม่ถูกต้อง"
                            : desired.worksheet !== null && (desired.worksheet < 10 || desired.worksheet > 200 || desired.worksheet % 10 !== 0) ? "หน้าปัจจุบันต้องเป็น packet + 9"
                                : desired.level && !target.level.options?.includes(desired.level) && target.level.value !== desired.level ? "KSIS ไม่มีระดับที่ตรงกัน"
                                    : desired.zun.some((row) => !Number.isInteger(row.used) || !Number.isInteger(row.worksheet) || row.worksheet < 10 || row.worksheet > 100 || row.worksheet % 10 !== 0) ? "ข้อมูล Zun Zun ไม่ถูกต้อง: ชุด 1–91 (ถึงหน้า 10–100)" : "";
        // Inactive KSIS rows lock worksheet fields. Never invent a status conversion or force hidden controls.
        if (!reason && desired.at.some((test) => !test.date || !test.level || !Number.isFinite(test.time) || test.time < 0
            || !Number.isFinite(test.score) || test.score < 0 || !Number.isInteger(test.group) || test.group < 1 || test.group > 5)) reason = "ข้อมูล AT ไม่ครบหรือไม่ถูกต้อง กรุณาตรวจวันที่ ระดับ เวลา คะแนน และ Group";
        if (!reason && new Set(desired.at.map((test) => JSON.stringify(test))).size !== desired.at.length) reason = "พบ AT ซ้ำในรายงาน กรุณาตรวจก่อนกรอก";
        if (!reason && ["A", "OT", "D", "CP"].includes(desired.status)
            && (Number(target.used.value || 0) !== desired.used || (desired.level && (target.level.value !== desired.level || Number(target.worksheet.value) !== desired.worksheet)))) reason = "KSIS ล็อกระดับ/หน้า/WS สำหรับสถานะนี้ กรุณาตรวจเอง";
        result.push({ enrollmentId: record.ID, kumonId, name: `${record["ชื่อจริง"]} ${record["นามสกุล"]}`, subject: record.Subject,
            key: target?.key, desired, before: target || null, ready: !reason, reason });
    }
    return result;
}

async function loadedDocument(page) {
    await page.waitForFunction(() => location.hash.includes("/login") || document.querySelector("table.vk-grid-content-student"), {}, { timeout: 20000 });
    if (page.url().includes("/login")) return null;
    if (page.url() !== REPORT_URL) throw httpError(409, "หน้า KSIS เปลี่ยนไป หยุดการทำงาน");
    return page.evaluate(readKsisDraftDocument);
}

export async function previewKsisReportDraft({ userId, month, year, subject }) {
    if (!["ALL", ...REPORT_SUBJECTS].includes(subject)) throw httpError(400, "กรุณาเลือกวิชาหรือทุกวิชา");
    const records = await buildMonthlyReport({ month, year });
    return withKsisPage({ sourceUrl: REPORT_URL, userId }, async (page) => {
        const document = await loadedDocument(page);
        if (!document) return { requiresLogin: true };
        const period = { month: Number(month), year: Number(year) };
        const rows = planKsisReportDraft(records, document, period, subject);
        for (const [id, value] of previews) if (value.userId === Number(userId) || value.expires < Date.now()) previews.delete(id);
        const previewId = randomUUID();
        previews.set(previewId, { userId: Number(userId), period, subject, rows, documentHash: hash(document), recordsHash: hash(records), expires: Date.now() + 10 * 60 * 1000 });
        return { requiresLogin: false, previewId, period, subject, rows, context: document.context, page: document.page };
    });
}

export async function installKsisDraftGuard(page) {
    let blocked = 0;
    await page.evaluate(() => {
        delete document.documentElement.dataset.kumonManualSave;
        document.documentElement.dataset.kumonFilling = "yes";
        const handler = (event) => {
            const button = event.target.closest?.("#btnToolbarSave");
            if (event.isTrusted && button && !button.disabled && (event.type === "click" || ["Enter", " "].includes(event.key))) {
                if (document.documentElement.dataset.kumonFilling === "yes") { event.preventDefault(); event.stopImmediatePropagation(); }
                else document.documentElement.dataset.kumonManualSave = "yes";
            }
        };
        window.addEventListener("click", handler, true); window.addEventListener("keydown", handler, true);
        window.__kumonDraftCleanup = () => { window.removeEventListener("click", handler, true); window.removeEventListener("keydown", handler, true); delete document.documentElement.dataset.kumonManualSave; delete document.documentElement.dataset.kumonFilling; };
    });
    const route = async (requestRoute) => {
        if (["GET", "HEAD", "OPTIONS"].includes(requestRoute.request().method())) return requestRoute.fallback();
        const manual = await page.evaluate(() => document.documentElement.dataset.kumonManualSave === "yes").catch(() => false);
        if (manual) return requestRoute.fallback();
        blocked++; return requestRoute.abort("blockedbyclient");
    };
    await page.route("**/*", route);
    return { blocked: () => blocked, async handoff() { await page.evaluate(() => { delete document.documentElement.dataset.kumonFilling; }); },
        async release() { await page.unroute("**/*", route); await page.evaluate(() => window.__kumonDraftCleanup?.()).catch(() => {}); } };
}

export async function fillKsisReportRows(page, rows, guard) {
    const selectLabel = async (locator, label) => {
        const selected = await locator.locator("option:checked").textContent();
        if (selected?.trim() !== String(label)) await locator.selectOption({ label: String(label) });
    };
    for (const row of rows) {
        if (page.url() !== REPORT_URL) throw httpError(409, "หน้า KSIS เปลี่ยนระหว่างกรอก หยุดทันที");
        const target = page.locator(`tr[data-clrowid=${JSON.stringify(row.key)}]`);
        if (await target.count() !== 1) throw httpError(409, "ไม่พบแถวรายวิชาเดิมใน KSIS");
        const status = target.locator("td").nth(9).locator("select:visible");
        await selectLabel(status, row.desired.status);
        if (!["A", "OT", "D", "CP"].includes(row.desired.status)) {
            if (row.desired.level) {
                await selectLabel(target.locator("td").nth(5).locator("select:visible"), row.desired.level);
                await selectLabel(target.locator("td").nth(6).locator("select:visible"), row.desired.worksheet);
            }
            const used = target.locator("td").nth(7).locator("input:visible");
            await used.fill(String(row.desired.used)); await used.press("Tab");
        }
        for (const [zunIndex, zun] of row.desired.zun.entries()) {
            await target.locator("td").nth(1).click();
            await page.locator("#btnToolbarLevelZ").click();
            const modal = page.locator(".modal:visible").filter({ hasText: "Zun Zun" });
            await modal.waitFor();
            if (!(await modal.innerText()).includes(row.kumonId)) throw httpError(409, "หน้าต่าง Zun Zun เป็นของเด็กคนอื่น หยุดการกรอก");
            const existingLevel = (await modal.locator("select").nth(0).locator("option:checked").textContent())?.trim();
            if (zunIndex === 0 && existingLevel && existingLevel !== "ไม่มี") throw httpError(409, "พบ Zun Zun เดิมใน KSIS หยุดให้ตรวจ เพื่อไม่เพิ่มซ้ำหรือเขียนทับ");
            await selectLabel(modal.locator("select").nth(0), zun.level);
            await selectLabel(modal.locator("select").nth(1), zun.worksheet);
            const usedZun = modal.locator("input:visible");
            await usedZun.fill(String(zun.used)); await usedZun.press("Tab");
            if (await modal.locator("select").nth(0).locator("option:checked").textContent() !== zun.level
                || Number(await modal.locator("select").nth(1).locator("option:checked").textContent()) !== zun.worksheet
                || Number(await usedZun.inputValue()) !== zun.used) throw httpError(409, "ข้อมูล Zun Zun ในหน้าต่างย่อยไม่ตรง หยุดให้ตรวจ");
            await modal.locator('button[data-ng-click="vmPopup.ok()"]' ).click();
            await modal.waitFor({ state: "hidden" });
            if (guard.blocked()) throw httpError(409, "KSIS พยายามส่งข้อมูลระหว่างกรอก ถูกกันไว้แล้ว กรุณาตรวจข้อมูลที่ค้างบนเว็บ");
        }
        for (const test of row.desired.at || []) {
            await target.locator("td").nth(1).click();
            await page.locator("#btnToolbarATest").click();
            const modal = page.locator(".modal:visible").filter({ has: page.locator("#testCd") });
            await modal.waitFor();
            const expectedName = row.before?.fullName || row.name;
            const expectedSubject = { ME: "Math", EFL: "English EFL", TRP: "Thai Reading" }[row.subject];
            if (compactName(await modal.locator(".modal-title").innerText()) !== compactName(expectedName)
                || (await modal.locator(".panel-title").first().innerText()).trim() !== expectedSubject) throw httpError(409, "หน้าต่าง AT ไม่ตรงกับนักเรียนหรือรายวิชา หยุดการกรอก");
            if ((await modal.locator("#testCd option:checked").textContent())?.trim()
                || (await modal.locator("#testDate").inputValue()).trim()) throw httpError(409, "พบข้อมูล AT เดิมในหน้าต่าง หยุดให้ตรวจ ไม่เขียนทับ");
            if (!await modal.locator("#testCd option").allTextContents().then((options) => options.some((option) => option.trim() === test.level))) throw httpError(409, `KSIS ไม่มีแบบทดสอบ AT ระดับ ${test.level}`);
            await selectLabel(modal.locator("#testCd"), test.level);
            const date = test.date.split("-").reverse().join("/");
            await modal.locator("#testDate").fill(date); await modal.locator("#testDate").press("Tab");
            const time = modal.locator("#testTime").locator("..").locator("input:visible");
            const score = modal.locator("#testScore").locator("..").locator("input:visible");
            await time.fill(String(test.time)); await time.press("Tab");
            await score.fill(String(test.score)); await score.press("Tab");
            await selectLabel(modal.locator("#atGroup"), `G${test.group}`);
            await modal.locator("#testResultFlg").check();
            const actualDate = normalizeKsisBirthDate(await modal.locator("#testDate").inputValue());
            if (actualDate !== test.date || Number((await time.inputValue()).replaceAll(",", "")) !== test.time
                || Number((await score.inputValue()).replaceAll(",", "")) !== test.score
                || (await modal.locator("#testCd option:checked").textContent()).trim() !== test.level
                || (await modal.locator("#atGroup option:checked").textContent()).trim() !== `G${test.group}`
                || !await modal.locator("#testResultFlg").isChecked()) throw httpError(409, "ค่าที่ KSIS รับใน AT ไม่ตรงกับรายงาน หยุดให้ตรวจ ไม่กดตกลง");
            if (guard.blocked()) throw httpError(409, "KSIS พยายามส่งข้อมูล AT ระหว่างกรอก ถูกกันไว้แล้ว");
            await modal.locator('button[ng-click="vm.ok()"]').click();
            await modal.waitFor({ state: "hidden" });
            if (guard.blocked()) throw httpError(409, "KSIS พยายามบันทึก AT ลงระบบ ถูกกันไว้แล้ว กรุณาตรวจข้อมูลค้าง");
        }
        const actual = (await page.evaluate(readKsisDraftDocument)).rows.find((item) => item.key === row.key);
        if (!actual || actual.status.value !== row.desired.status || Number(actual.used.value || 0) !== row.desired.used
            || (row.desired.level && (actual.level.value !== row.desired.level || Number(actual.worksheet.value) !== row.desired.worksheet))) throw httpError(409, "ค่าที่ KSIS แสดงไม่ตรงกับรายงาน หยุดให้ตรวจ ไม่กดบันทึก");
        if (guard.blocked()) throw httpError(409, "KSIS พยายามส่งข้อมูลระหว่างกรอก ถูกกันไว้แล้ว ยังไม่บันทึก");
    }
}

export async function applyKsisReportDraft({ userId, previewId }) {
    const preview = previews.get(previewId);
    if (!preview || preview.userId !== Number(userId) || preview.expires < Date.now()) throw httpError(409, "Preview หมดอายุ กรุณาเตรียมข้อมูลใหม่");
    const records = await buildMonthlyReport(preview.period);
    if (hash(records) !== preview.recordsHash) throw httpError(409, "ข้อมูลรายงานเปลี่ยนหลัง Preview กรุณาเตรียมใหม่");
    return withKsisPage({ sourceUrl: REPORT_URL, userId }, async (page, session) => {
        const document = await loadedDocument(page);
        if (!document || hash(document) !== preview.documentHash) throw httpError(409, "หน้า KSIS เปลี่ยนหลัง Preview กรุณาเตรียมใหม่");
        const rows = preview.rows.filter((row) => row.ready);
        if (!rows.length) throw httpError(400, "ไม่มีรายการพร้อมกรอกในหน้านี้");
        previews.delete(previewId);
        const guard = await installKsisDraftGuard(page);
        session.pendingDraft = true; session.draftGuard = guard;
        try { await fillKsisReportRows(page, rows, guard); }
        catch (error) { throw httpError(error.statusCode || 409, `${error.statusCode ? error.message : "กรอกไม่ครบ หยุดไว้ก่อน"} • มีข้อมูลค้างใน KSIS กรุณาตรวจเอง`); }
        finally { await guard.handoff(); }
        return { filled: rows.length, page: document.page, pendingDraft: true };
    });
}

export async function acknowledgeKsisReportDraft({ userId }) {
    return withKsisPage({ sourceUrl: REPORT_URL, userId, allowPendingDraft: true }, async (page, session) => {
        await session.draftGuard?.release(); session.pendingDraft = false; session.draftGuard = null;
        return { acknowledged: true };
    });
}
