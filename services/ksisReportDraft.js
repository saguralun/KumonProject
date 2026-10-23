import { createHash, randomUUID } from "node:crypto";
import { withKsisWorkspacePage as withKsisPage } from "./ksisStudentService.js";
import { buildMonthlyReport } from "./reportService.js";
import { normalizeKumonStudentId } from "./kumonStudentId.js";
import { normalizeKsisBirthDate } from "./ksisStudentData.js";
import { httpError } from "./httpError.js";
import { matchKsisReportIdentity, ksisDraftStudentKey } from './ksisReportIdentity.js';

const REPORT_URL = "https://kao.ksis.kumon.com/kth/#/reportbeditgrid";
const ZUN_LIST_URL = "https://kao.ksis.kumon.com/kth/api/levelz/GetLevelZListByStudent";
const WS_SAVE_URL = "https://kao.ksis.kumon.com/kth/api/reportb/SaveReportBDetailEntryEditItemBatch";
const REPORT_SUBJECTS = ["ME", "EFL", "TRP"];
const previews = new Map();
const hash = (data) => createHash("sha256").update(JSON.stringify(data)).digest("hex");
const compactName = (value) => String(value || "").normalize("NFC").replace(/\s+/g, "");
const numericTestValue = (value) => value == null || String(value).trim() === "" ? NaN : Number(value);

export function readKsisDraftDocument() {
    const visible = (element) => Boolean(element && element.getClientRects().length && getComputedStyle(element).visibility !== "hidden");
    const field = (cell) => {
        const controls = Array.from(cell?.querySelectorAll("select,input") || []);
        const select = controls.find((element) => element.tagName === "SELECT" && visible(element));
        const input = controls.find((element) => element.tagName === "INPUT" && visible(element));
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
        rows: Array.from(document.querySelectorAll("table.vk-grid-content-student")).flatMap((table, studentIndex) => {
            const studentCells = table.rows[0]?.cells || [];
            const subjectTable = table.parentElement.querySelector("table.vk-grid-content-subject");
            return Array.from(subjectTable?.rows || []).map((row) => ({
                key: row.getAttribute("data-clrowid"), kumonId: studentCells[2]?.textContent.trim() || "",
                studentKey: `header:${studentIndex}`,
                fullName: studentCells[1]?.textContent.trim() || "", birthDate: studentCells[4]?.textContent.trim() || "",
                subject: ({ Math: "ME", "English EFL": "EFL", "Thai Reading": "TRP" })[row.cells[1]?.textContent.trim()] || "",
                dirty: Array.from(row.querySelectorAll('[data-ng-show*="isDirty"]')).some(visible),
                level: field(row.cells[5]), worksheet: field(row.cells[6]), used: field(row.cells[7]), status: field(row.cells[9]),
                validationError: Array.from(row.cells[11]?.querySelectorAll(".reportb-grid-col-error") || [])
                    .filter(visible).map((element) => element.innerText.trim()).filter(Boolean).join("; ")
            }));
        }) };
}

export function ksisContextPeriod(context) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const match = context.match(/ประจำเดือน\s+([A-Za-z]{3})\s*-\s*(\d{4})/);
    return match ? { month: months.findIndex((month) => month.toLowerCase() === match[1].toLowerCase()) + 1, year: Number(match[2]) } : null;
}

export function planKsisReportDraft(records, document, period, subject, { includeAt = false, includeZun = true } = {}) {
    if (!["ALL", ...REPORT_SUBJECTS].includes(subject)) throw httpError(400, "กรุณาเลือกวิชาหรือทุกวิชา");
    const websitePeriod = ksisContextPeriod(document.context);
    if (!websitePeriod || websitePeriod.month !== Number(period.month) || websitePeriod.year !== Number(period.year)) throw httpError(409, "เดือน/ปีใน KSIS ไม่ตรงกับรายงาน หยุดไว้ก่อน ยังไม่กรอก");
    if (document.modalOpen) throw httpError(409, "กรุณาปิดหน้าต่างย่อยใน KSIS ก่อนอ่าน Preview");
    if (document.rows.some((row) => row.dirty)) throw httpError(409, "หน้า KSIS มีข้อมูลที่แก้ค้างอยู่ กรุณาจัดการข้อมูลเดิมก่อน ไม่เขียนทับ");
    const result = [];
    const subjects = subject === "ALL" ? REPORT_SUBJECTS : [subject];
    for (const record of subjects.flatMap((code) => records.filter((row) => row.Subject === code))) {
        const kumonId = normalizeKumonStudentId(record["รหัสคุมอง"]);
        const matched = matchKsisReportIdentity(record, records, document.rows);
        const targets = matched.targets;
        const current = String(record.CurrentLevel || "").match(/^(.*\D)(\d+)$/);
        const desired = { level: current?.[1] || "", worksheet: current ? Number(current[2]) : null,
            used: record.IsKc === true ? 1 : Number(record.WksUsed), status: record.Status1,
            at: (includeAt === true ? ["", "1", "2"] : []).filter((suffix) => record[`TestType${suffix}`] === "AT").map((suffix) => ({
                date: normalizeKsisBirthDate(record[`DateTest${suffix}`]), level: String(record[`LevelTest${suffix}`] || "").trim(),
                time: numericTestValue(record[`Time${suffix}`]), score: numericTestValue(record[`Score${suffix}`]),
                group: numericTestValue(record[`Group${suffix}`]), passed: true
            })),
            zun: (includeZun === true ? [["ZI", record.UsedZI, record.ZIWorksheetNo], ["ZII", record.UsedZII, record.ZIIWorksheetNo]] : [])
                .filter(([, used]) => Number(used) > 0).map(([level, used, worksheet]) => ({ level, used: Number(used), worksheet: Number(worksheet) })) };
        const target = targets[0];
        const skipped = record.Status1 === "A" || targets.some((row) => row.status.value === "A");
        let reason = matched.reason || (!target ? "ไม่อยู่ในหน้า KSIS ปัจจุบัน" : !target.key ? "ไม่พบตัวระบุแถว KSIS"
                : normalizeKsisBirthDate(record["วันเกิด"]) && normalizeKsisBirthDate(target.birthDate) !== normalizeKsisBirthDate(record["วันเกิด"]) ? "วันเกิดไม่ตรงกัน"
                    : target.status.value !== desired.status && (!target.status.options?.includes(desired.status) || !target.status.writable) ? `KSIS ไม่อนุญาต ST1 ${desired.status}`
                        : !Number.isInteger(desired.used) || desired.used < 0 ? "จำนวน WS ไม่ถูกต้อง"
                            : desired.worksheet !== null && (desired.worksheet < 10 || desired.worksheet > 200 || desired.worksheet % 10 !== 0) ? "หน้าปัจจุบันต้องเป็น packet + 9"
                                : desired.level && !target.level.options?.includes(desired.level) && target.level.value !== desired.level ? "KSIS ไม่มีระดับที่ตรงกัน"
                                    : desired.zun.some((row) => !Number.isInteger(row.used) || !Number.isInteger(row.worksheet) || row.worksheet < 10 || row.worksheet > 100 || row.worksheet % 10 !== 0) ? "ข้อมูล Zun Zun ไม่ถูกต้อง: ชุด 1–91 (ถึงหน้า 10–100)" : "");
        // Inactive KSIS rows lock worksheet fields. Never invent a status conversion or force hidden controls.
        if (!reason && desired.at.some((test) => !test.date || !test.level || !Number.isFinite(test.time) || test.time < 0
            || !Number.isFinite(test.score) || test.score < 0 || !Number.isInteger(test.group) || test.group < 1 || test.group > 5)) reason = "ข้อมูล AT ไม่ครบหรือไม่ถูกต้อง กรุณาตรวจวันที่ ระดับ เวลา คะแนน และ Group";
        if (!reason && new Set(desired.at.map((test) => JSON.stringify(test))).size !== desired.at.length) reason = "พบ AT ซ้ำในรายงาน กรุณาตรวจก่อนกรอก";
        if (!reason && ["A", "OT", "D", "CP"].includes(desired.status)
            && (Number(target.used.value || 0) !== desired.used || (desired.level && (target.level.value !== desired.level || Number(target.worksheet.value) !== desired.worksheet)))) reason = "KSIS ล็อกระดับ/หน้า/WS สำหรับสถานะนี้ กรุณาตรวจเอง";
        if (skipped) reason = "ข้ามสถานะ A ให้จัดการสถานะเองใน KSIS";
        result.push({ enrollmentId: record.ID, kumonId, name: `${record["ชื่อจริง"]} ${record["นามสกุล"]}`, subject: record.Subject,
            birthDate: record['วันเกิด'] || '', matchMethod: matched.method, studentKey: matched.studentKey,
            requiresIdentityConfirmation: matched.method === 'name_birth_date',
            key: target?.key, isKc: record.IsKc === true, skipped, desired, before: target || null, ready: !reason, reason });
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
        const rows = planKsisReportDraft(records, document, period, subject, { includeAt: false, includeZun: false });
        for (const [id, value] of previews) if (value.userId === Number(userId) || value.expires < Date.now()) previews.delete(id);
        const previewId = randomUUID();
        previews.set(previewId, { userId: Number(userId), period, subject, rows, documentHash: hash(document), recordsHash: hash(records), expires: Date.now() + 10 * 60 * 1000 });
        return { requiresLogin: false, previewId, period, subject, scope: "WS_ONLY", saveAfterFill: true, saveEveryStudents: 10, rows, context: document.context, page: document.page };
    });
}

export function isKsisDraftReadRequest(method, url, resourceType) {
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;
    // KSIS uses POST to load the student's Zun list before showing its dialog.
    return method === "POST" && ["fetch", "xhr"].includes(resourceType) && url === ZUN_LIST_URL;
}

export function isKsisWsSaveRequest(method, url, resourceType) {
    return method === "POST" && url === WS_SAVE_URL && ["fetch", "xhr"].includes(resourceType);
}

export async function installKsisDraftGuard(page, { allowBatchSave = false } = {}) {
    let blocked = 0;
    let savingEnabled = allowBatchSave === true;
    const pendingSaves = new Set();
    const saveResults = [];
    const blockedRequests = [];
    let released = false;
    let observingManualSaves = false;
    const trackedSaves = new WeakSet();
    const trackSave = (request) => {
        if (!isKsisWsSaveRequest(request.method(), request.url(), request.resourceType()) || trackedSaves.has(request)) return;
        trackedSaves.add(request);
        const completion = (async () => {
            try {
                const response = await request.response();
                if (!response) { saveResults.push({ ok: false, status: 0 }); return; }
                const failure = await response.finished();
                const body = await response.json().catch(() => null);
                const rejected = body === false || body?.success === false || body?.Success === false || body?.IsSuccess === false || body?.isSuccess === false || Boolean(body?.error || body?.Error);
                saveResults.push({ ok: response.ok() && !failure && !rejected, status: response.status() });
            } catch { saveResults.push({ ok: false, status: 0 }); }
        })();
        pendingSaves.add(completion);
        void completion.finally(() => pendingSaves.delete(completion));
    };
    await page.evaluate(() => {
        delete document.documentElement.dataset.kumonManualSave;
        delete document.documentElement.dataset.kumonAllowMainSave;
        document.documentElement.dataset.kumonFilling = "yes";
        const handler = (event) => {
            const button = event.target.closest?.("#btnToolbarSave");
            if (event.isTrusted && button && !button.disabled && (event.type === "click" || ["Enter", " "].includes(event.key))) {
                if (document.documentElement.dataset.kumonFilling === "yes") {
                    if (document.documentElement.dataset.kumonAllowMainSave !== "yes") { event.preventDefault(); event.stopImmediatePropagation(); }
                }
                else document.documentElement.dataset.kumonManualSave = "yes";
            }
        };
        window.addEventListener("click", handler, true); window.addEventListener("keydown", handler, true);
        window.__kumonDraftCleanup = () => { window.removeEventListener("click", handler, true); window.removeEventListener("keydown", handler, true); delete document.documentElement.dataset.kumonManualSave; delete document.documentElement.dataset.kumonFilling; delete document.documentElement.dataset.kumonAllowMainSave; };
    });
    const route = async (requestRoute) => {
        const request = requestRoute.request();
        if (isKsisDraftReadRequest(request.method(), request.url(), request.resourceType())) return requestRoute.fallback();
        if (savingEnabled && isKsisWsSaveRequest(request.method(), request.url(), request.resourceType())) {
            trackSave(request);
            return requestRoute.fallback();
        }
        const manual = await page.evaluate(() => document.documentElement.dataset.kumonManualSave === "yes").catch(() => false);
        if (manual) return requestRoute.fallback();
        const url = new URL(request.url());
        blockedRequests.push({ method: request.method(), url: `${url.origin}${url.pathname}`, resourceType: request.resourceType() });
        blocked++; return requestRoute.abort("blockedbyclient");
    };
    await page.route("**/*", route);
    return { blocked: () => blocked, blockedRequests: () => blockedRequests.map((request) => ({ ...request })),
        saveResults: () => saveResults.map((result) => ({ ...result })),
        pendingSaveCount: () => pendingSaves.size,
        async waitForSaves() {
            let timer;
            try {
                const drain = async () => { while (pendingSaves.size) await Promise.all([...pendingSaves]); };
                await Promise.race([drain(), new Promise((_, reject) => {
                    timer = setTimeout(() => reject(httpError(504, "KSIS ยังไม่ตอบกลับการบันทึก หยุดให้ตรวจผลบนเว็บก่อน")), 20000);
                })]);
            } finally { clearTimeout(timer); }
            if (saveResults.some((result) => !result.ok)) throw httpError(409, "KSIS ตอบกลับว่าบันทึก WS ไม่สำเร็จ หรือการเชื่อมต่อขาด กรุณาตรวจบนเว็บ");
        },
        async beginSave() {
            if (!savingEnabled) throw httpError(409, "รอบนี้ยังไม่ได้อนุญาตให้บันทึก");
            await page.evaluate(() => { document.documentElement.dataset.kumonAllowMainSave = "yes"; });
        },
        async endSave() { await page.evaluate(() => { delete document.documentElement.dataset.kumonAllowMainSave; }); },
        async handoff() { savingEnabled = false; await page.evaluate(() => { delete document.documentElement.dataset.kumonFilling; delete document.documentElement.dataset.kumonAllowMainSave; }); },
        async release() {
            savingEnabled = false;
            if (released) return;
            // Observe manual saves without intercepting or issuing any requests.
            if (!observingManualSaves) { page.on('request', trackSave); observingManualSaves = true; }
            await page.unroute("**/*", route);
            released = true;
            await page.evaluate(() => window.__kumonDraftCleanup?.()).catch(() => {});
        },
        dispose() { page.off('request', trackSave); observingManualSaves = false; } };
}

export async function saveKsisWsPage(page, guard) {
    if (page.url() !== REPORT_URL) throw httpError(409, "หน้า KSIS เปลี่ยนไป ไม่บันทึกข้ามหน้า");
    await guard.waitForSaves();
    const document = await page.evaluate(readKsisDraftDocument);
    if (document.modalOpen) throw httpError(409, "มีหน้าต่างย่อยใน KSIS กรุณาตรวจก่อนบันทึก WS");
    let clickedMainSave = false;
    if (document.rows.some((row) => row.dirty)) {
        await guard.beginSave();
        const response = page.waitForResponse((item) => isKsisWsSaveRequest(item.request().method(), item.request().url(), item.request().resourceType()), { timeout: 20000 }).catch(() => null);
        try { await page.locator("#btnToolbarSave").click({ timeout: 8000 }); }
        catch { throw httpError(409, "กดปุ่มบันทึกหลักของ KSIS ไม่สำเร็จ กรุณาตรวจข้อมูลที่ค้าง"); }
        finally { await guard.endSave(); }
        clickedMainSave = true;
        if (!await response) throw httpError(504, "ยังไม่พบคำตอบจากการบันทึกหลักของ KSIS กรุณาตรวจบนเว็บก่อนลองซ้ำ");
    }
    await guard.waitForSaves();
    if (!guard.saveResults().length) throw httpError(409, "ยังไม่มีคำตอบยืนยันการบันทึกจาก KSIS ไม่ถือว่าบันทึกสำเร็จ");
    try {
        await page.waitForFunction(() => !Array.from(document.querySelectorAll('[data-ng-show*="isDirty"]')).some((element) => element.getClientRects().length && getComputedStyle(element).visibility !== "hidden"), {}, { timeout: 10000 });
    } catch { throw httpError(409, "KSIS ยังแสดงข้อมูลที่แก้ค้างอยู่หลังบันทึก กรุณาตรวจบนเว็บ"); }
    await guard.waitForSaves();
    if (guard.blocked()) throw httpError(409, "มีคำขออื่นถูกกันไว้ระหว่างบันทึก WS กรุณาตรวจ ไม่ส่งซ้ำอัตโนมัติ");
    return { saved: true, saveRequests: guard.saveResults().length, clickedMainSave };
}

export function groupKsisStudentBatches(rows, size = 10) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError("Invalid student batch size");
    const students = new Map();
    for (const row of rows) {
        if (!row.ready || row.skipped || row.requiresIdentityConfirmation && !row.identityConfirmed || row.desired.status === "A" || row.before?.status.value === "A") continue;
        const student = ksisDraftStudentKey(row);
        if (!students.has(student)) students.set(student, []);
        students.get(student).push(row);
    }
    const groups = [...students.values()];
    const batches = [];
    for (let index = 0; index < groups.length; index += size) batches.push(groups.slice(index, index + size).flat());
    return batches;
}

export async function fillAndSaveKsisWsBatches(page, rows, guard) {
    const initial = await page.evaluate(readKsisDraftDocument);
    const progress = { completedKeys: [], savedKeys: [], notices: [], batchesSaved: 0 };
    try {
        for (const batch of groupKsisStudentBatches(rows)) {
            const current = await page.evaluate(readKsisDraftDocument);
            if (page.url() !== REPORT_URL || current.context !== initial.context || current.page !== initial.page) {
                throw httpError(409, "หน้า KSIS เปลี่ยนระหว่างรอบ หยุด ไม่กรอกข้ามหน้า");
            }
            let filled;
            try { filled = await fillKsisReportRows(page, batch, guard); }
            catch (error) {
                progress.completedKeys.push(...(error.draftProgress?.completedKeys || []));
                progress.notices.push(...(error.draftProgress?.notices || []));
                progress.failedKey = error.draftProgress?.failedKey;
                throw error;
            }
            progress.completedKeys.push(...filled.completedKeys);
            progress.notices.push(...filled.notices);
            await saveKsisWsPage(page, guard);
            progress.savedKeys.push(...filled.completedKeys);
            progress.batchesSaved++;
        }
    } catch (error) { error.draftProgress = progress; throw error; }
    return progress;
}

export function summarizeKsisDraft(rows, completedKeys, failedKey = null, error = "", notices = []) {
    const noticeFor = new Map(notices.map((notice) => [notice.key, notice.message]));
    const summaryRows = rows.filter((row) => row.before || row.requiresIdentityConfirmation).map((row) => ({ ...row,
        outcome: row.skipped ? "skipped" : completedKeys.includes(row.key) ? "filled" : error && row.key === failedKey ? "failed" : row.ready ? "not_started" : "blocked",
        resultReason: error && row.key === failedKey ? error : completedKeys.includes(row.key) && !row.skipped ? noticeFor.get(row.key) || row.reason : row.reason
    }));
    const filled = summaryRows.filter((row) => row.outcome === "filled");
    return { rows: summaryRows, filled: filled.length, studentsFilled: new Set(filled.map(ksisDraftStudentKey)).size,
        filterNotices: filled.filter((row) => noticeFor.has(row.key)).length,
        skipped: summaryRows.filter((row) => row.outcome === "skipped").length, stopped: Boolean(error), error };
}

export function isUnchangedKsisWorksheetNotice(current, previous) {
    const normalize = (value) => String(value || '').trim().replace(/\s+/g, ' ');
    const known = new Set(['กรุณาใส่หน้าแบบฝึกหัด', '(เตือน) กรุณาใส่จำนวนแบบฝึกหัดที่ใช้', '(เตือน) กรุณาใส่จำนวนวนแบบฝึกหัดที่ใช้']);
    const messages = normalize(current).split(/;\s*/);
    return Boolean(normalize(current)) && normalize(current) === normalize(previous) && messages.every((message) => known.has(message));
}

export async function fillKsisReportRows(page, rows, guard, { includeSupplementary = false } = {}) {
    let step = "เริ่มกรอก";
    const selectLabel = async (locator, label, field) => {
        step = `เลือก${field || label}`;
        const selected = await locator.locator("option:checked").textContent({ timeout: 8000 });
        if (selected?.trim() !== String(label)) await locator.selectOption({ label: String(label) }, { timeout: 8000 });
    };
    const fillNumber = async (container, value, field) => {
        const input = container.locator("input:visible");
        // Kendo swaps its formatted input for the editable input on focus.
        step = `เปิดช่อง ${field}`;
        await input.click({ timeout: 8000 });
        step = `กรอก ${field}`;
        await input.fill(String(value), { timeout: 8000 });
        step = `ยืนยันค่า ${field}`;
        await input.press("Tab", { timeout: 8000 });
        return input;
    };
    const validationNotices = new Map();
    const verifyMainFields = async (row) => {
        step = "ตรวจระดับ หน้า WS used และ ST1 หลังกรอก";
        const actual = (await page.evaluate(readKsisDraftDocument)).rows.find((item) => item.key === row.key);
        const unfilledFilter = isUnchangedKsisWorksheetNotice(actual?.validationError, row.before?.validationError);
        const differences = !actual ? ["ไม่พบแถวหลังกรอก"] : [
            actual.status.value !== row.desired.status ? `ST1 ต้องการ ${row.desired.status} แต่ KSIS แสดง ${actual.status.value || "ว่าง"}` : "",
            Number(actual.used.value || 0) !== row.desired.used ? `WS used ต้องการ ${row.desired.used} แต่ KSIS แสดง ${actual.used.value || "0"}` : "",
            row.desired.level && actual.level.value !== row.desired.level ? `ระดับต้องการ ${row.desired.level} แต่ KSIS แสดง ${actual.level.value || "ว่าง"}` : "",
            row.desired.level && Number(actual.worksheet.value) !== row.desired.worksheet ? `หน้าต้องการ ${row.desired.worksheet} แต่ KSIS แสดง ${actual.worksheet.value || "ว่าง"}` : "",
            actual.validationError && !unfilledFilter ? `KSIS แจ้ง: ${actual.validationError}` : ""
        ].filter(Boolean);
        if (differences.length) throw httpError(409, `${row.name} • ${row.subject}: ${differences.join("; ")} • หยุดให้ตรวจ ไม่กดบันทึก`);
        if (guard.blocked()) throw httpError(409, "KSIS พยายามส่งข้อมูลระหว่างกรอก ถูกกันไว้แล้ว ยังไม่บันทึก");
        // These existing required-WS notices remain visible in KSIS's unfilled-row filter after editing.
        if (unfilledFilter) validationNotices.set(row.key, "KSIS ยังแสดงข้อความตัวกรองเดิม แต่ระดับ หน้า WS used และ ST1 ที่อ่านกลับตรงกับรายงาน");
        else validationNotices.delete(row.key);
    };
    const completedKeys = [];
    let currentRow;
    try {
        for (const row of rows) {
            if (row.skipped || row.desired.status === "A" || row.before?.status.value === "A") continue;
            currentRow = row;
            if (row.requiresIdentityConfirmation && !row.identityConfirmed) throw httpError(409, 'ยังไม่ได้ยืนยันคู่ชื่อและวันเกิด ไม่เริ่มกรอก');
            step = "ตรวจแถวรายวิชา";
            if (page.url() !== REPORT_URL) throw httpError(409, "หน้า KSIS เปลี่ยนระหว่างกรอก หยุดทันที");
            if (row.requiresIdentityConfirmation) {
                const actual = (await page.evaluate(readKsisDraftDocument)).rows.filter((item) => item.key === row.key);
                if (actual.length !== 1 || actual[0].fullName !== row.before.fullName || actual[0].subject !== row.subject
                    || actual[0].kumonId !== row.before.kumonId || normalizeKsisBirthDate(actual[0].birthDate) !== normalizeKsisBirthDate(row.birthDate)) {
                    throw httpError(409, 'ชื่อ วันเกิด หรือรายวิชาใน KSIS เปลี่ยนหลังยืนยันคู่ หยุดก่อนกรอก');
                }
            }
            const target = page.locator(`tr[data-clrowid=${JSON.stringify(row.key)}]`);
            if (await target.count() !== 1) throw httpError(409, "ไม่พบแถวรายวิชาเดิมใน KSIS");
            const currentStatus = (await page.evaluate(readKsisDraftDocument)).rows.find((item) => item.key === row.key)?.status;
            if (!currentStatus) throw httpError(409, 'อ่าน ST1 ใน KSIS ไม่ได้ หยุดก่อนกรอก');
            if (currentStatus.value !== row.desired.status) {
                if (!currentStatus.writable || !currentStatus.options?.includes(row.desired.status)) throw httpError(409, `KSIS ไม่อนุญาต ST1 ${row.desired.status}`);
                await selectLabel(target.locator("td").nth(9).locator("select:visible"), row.desired.status, " ST1");
            }
            if (!["A", "OT", "D", "CP"].includes(row.desired.status)) {
                if (row.desired.level) {
                    await selectLabel(target.locator("td").nth(5).locator("select:visible"), row.desired.level, "ระดับปัจจุบัน");
                    await selectLabel(target.locator("td").nth(6).locator("select:visible"), row.desired.worksheet, "หน้าปัจจุบัน");
                }
                await fillNumber(target.locator("td").nth(7), row.desired.used, "WS used");
            }
            await verifyMainFields(row);
            for (const [zunIndex, zun] of (includeSupplementary === true ? row.desired.zun : []).entries()) {
                step = "เลือกแถวรายวิชาก่อนเปิด Zun Zun";
                await target.locator("td").nth(1).click({ timeout: 8000 });
                step = "กดปุ่ม Z เพื่อเปิด Zun Zun";
                await page.locator("#btnToolbarLevelZ").click({ timeout: 8000 });
                const modal = page.locator(".modal:visible").filter({ hasText: "Zun Zun" });
                step = "รอหน้าต่าง Zun Zun";
                await modal.waitFor({ timeout: 10000 });
                if (!(await modal.innerText()).includes(row.kumonId)) throw httpError(409, "หน้าต่าง Zun Zun เป็นของเด็กคนอื่น หยุดการกรอก");
                const existingLevel = (await modal.locator("select").nth(0).locator("option:checked").textContent())?.trim();
                if (zunIndex === 0 && existingLevel && existingLevel !== "ไม่มี") throw httpError(409, "พบ Zun Zun เดิมใน KSIS หยุดให้ตรวจ เพื่อไม่เพิ่มซ้ำหรือเขียนทับ");
                await selectLabel(modal.locator("select").nth(0), zun.level, "ระดับ Zun Zun");
                await selectLabel(modal.locator("select").nth(1), zun.worksheet, "หน้า Zun Zun");
                const usedZun = await fillNumber(modal, zun.used, "WS used ของ Zun Zun");
                if (await modal.locator("select").nth(0).locator("option:checked").textContent() !== zun.level
                    || Number(await modal.locator("select").nth(1).locator("option:checked").textContent()) !== zun.worksheet
                    || Number(await usedZun.inputValue()) !== zun.used) throw httpError(409, "ข้อมูล Zun Zun ในหน้าต่างย่อยไม่ตรง หยุดให้ตรวจ");
                step = "ยืนยันหน้าต่างย่อย Zun Zun (ไม่ใช่บันทึกหลัก)";
                await modal.locator('button[data-ng-click="vmPopup.ok()"]' ).click({ timeout: 8000 });
                step = "รอปิดหน้าต่าง Zun Zun";
                await modal.waitFor({ state: "hidden", timeout: 10000 });
                if (guard.blocked()) throw httpError(409, "KSIS พยายามส่งข้อมูลระหว่างกรอก ถูกกันไว้แล้ว กรุณาตรวจข้อมูลที่ค้างบนเว็บ");
            }
            for (const test of includeSupplementary === true ? row.desired.at || [] : []) {
                step = "เลือกแถวรายวิชาก่อนเปิด AT";
                await target.locator("td").nth(1).click({ timeout: 8000 });
                step = "กดปุ่มเพิ่ม AT";
                await page.locator("#btnToolbarATest").click({ timeout: 8000 });
                const modal = page.locator(".modal:visible").filter({ has: page.locator("#testCd") });
                step = "รอหน้าต่าง AT";
                await modal.waitFor({ timeout: 10000 });
                const expectedName = row.before?.fullName || row.name;
                const expectedSubject = { ME: "Math", EFL: "English EFL", TRP: "Thai Reading" }[row.subject];
                if (compactName(await modal.locator(".modal-title").innerText()) !== compactName(expectedName)
                    || (await modal.locator(".panel-title").first().innerText()).trim() !== expectedSubject) throw httpError(409, "หน้าต่าง AT ไม่ตรงกับนักเรียนหรือรายวิชา หยุดการกรอก");
                if ((await modal.locator("#testCd option:checked").textContent())?.trim()
                    || (await modal.locator("#testDate").inputValue()).trim()) throw httpError(409, "พบข้อมูล AT เดิมในหน้าต่าง หยุดให้ตรวจ ไม่เขียนทับ");
                if (!await modal.locator("#testCd option").allTextContents().then((options) => options.some((option) => option.trim() === test.level))) throw httpError(409, `KSIS ไม่มีแบบทดสอบ AT ระดับ ${test.level}`);
                await selectLabel(modal.locator("#testCd"), test.level, "ระดับ AT");
                const date = test.date.split("-").reverse().join("/");
                step = "กรอกวันที่ AT";
                await modal.locator("#testDate").fill(date); await modal.locator("#testDate").press("Tab");
                const time = await fillNumber(modal.locator("#testTime").locator(".."), test.time, "เวลา AT");
                const score = await fillNumber(modal.locator("#testScore").locator(".."), test.score, "คะแนน AT");
                await selectLabel(modal.locator("#atGroup"), `G${test.group}`, " Group ของ AT");
                step = "ติ๊กผ่าน AT";
                await modal.locator("#testResultFlg").check();
                const actualDate = normalizeKsisBirthDate(await modal.locator("#testDate").inputValue());
                if (actualDate !== test.date || Number((await time.inputValue()).replaceAll(",", "")) !== test.time
                    || Number((await score.inputValue()).replaceAll(",", "")) !== test.score
                    || (await modal.locator("#testCd option:checked").textContent()).trim() !== test.level
                    || (await modal.locator("#atGroup option:checked").textContent()).trim() !== `G${test.group}`
                    || !await modal.locator("#testResultFlg").isChecked()) throw httpError(409, "ค่าที่ KSIS รับใน AT ไม่ตรงกับรายงาน หยุดให้ตรวจ ไม่กดตกลง");
                if (guard.blocked()) throw httpError(409, "KSIS พยายามส่งข้อมูล AT ระหว่างกรอก ถูกกันไว้แล้ว");
                step = "ยืนยันหน้าต่างย่อย AT (ไม่ใช่บันทึกหลัก)";
                await modal.locator('button[ng-click="vm.ok()"]').click({ timeout: 8000 });
                step = "รอปิดหน้าต่าง AT";
                await modal.waitFor({ state: "hidden", timeout: 10000 });
                if (guard.blocked()) throw httpError(409, "KSIS พยายามบันทึก AT ลงระบบ ถูกกันไว้แล้ว กรุณาตรวจข้อมูลค้าง");
            }
            await verifyMainFields(row);
            completedKeys.push(row.key);
        }
    } catch (error) {
        const request = guard.blockedRequests?.().at(-1);
        const failure = request ? httpError(409, `${currentRow?.name || "นักเรียน"} • ${currentRow?.subject || ""}: ${step} • คำขอ ${request.method} ${request.url} ถูกกันไว้เพื่อป้องกันการบันทึก ต้องตรวจว่าเป็นคำขออ่านหรือบันทึกก่อนอนุญาต • ยังไม่กดบันทึกหลัก`)
            : error.statusCode ? error : httpError(409, `${currentRow?.name || "นักเรียน"} • ${currentRow?.subject || ""}: ${step}ไม่สำเร็จ${error.name === "TimeoutError" ? "ภายในเวลาที่กำหนด" : ""} • หยุดให้ตรวจ ไม่กดบันทึก`);
        if (!error.statusCode) console.error("KSIS Report B draft interrupted", { step, error: error.message });
        failure.draftProgress = { completedKeys, failedKey: currentRow?.key,
            notices: Array.from(validationNotices, ([key, message]) => ({ key, message })) };
        throw failure;
    }
    return { completedKeys, notices: Array.from(validationNotices, ([key, message]) => ({ key, message })) };
}

export function selectConfirmedKsisDraftRows(rows, confirmations = []) {
    if (!Array.isArray(confirmations) || confirmations.length > rows.length) throw httpError(400, 'รายการยืนยันคู่ไม่ถูกต้อง');
    const selected = new Set();
    for (const item of confirmations) {
        const row = rows.find((row) => row.enrollmentId === item?.enrollmentId && row.key === item?.key && row.requiresIdentityConfirmation && row.ready);
        if (!row || selected.has(row)) throw httpError(400, 'คู่ที่ยืนยันไม่ตรงกับ Preview หรือถูกเลือกซ้ำ กรุณาเตรียมข้อมูลใหม่');
        selected.add(row);
    }
    return rows.map((row) => row.requiresIdentityConfirmation && row.ready && !selected.has(row)
        ? { ...row, ready: false, reason: 'ยังไม่ได้ยืนยันคู่ชื่อและวันเกิด ข้ามการกรอก' }
        : { ...row, identityConfirmed: selected.has(row) });
}

export async function applyKsisReportDraft({ userId, previewId, saveAfterFill = false, confirmedIdentityMatches = [] }) {
    if (saveAfterFill !== true) throw httpError(400, "กรุณายืนยันกรอกและบันทึก WS ของหน้าปัจจุบันก่อนเริ่ม");
    const preview = previews.get(previewId);
    if (!preview || preview.userId !== Number(userId) || preview.expires < Date.now()) throw httpError(409, "Preview หมดอายุ กรุณาเตรียมข้อมูลใหม่");
    const records = await buildMonthlyReport(preview.period);
    if (hash(records) !== preview.recordsHash) throw httpError(409, "ข้อมูลรายงานเปลี่ยนหลัง Preview กรุณาเตรียมใหม่");
    return withKsisPage({ sourceUrl: REPORT_URL, userId }, async (page, session) => {
        const document = await loadedDocument(page);
        if (!document || hash(document) !== preview.documentHash) throw httpError(409, "หน้า KSIS เปลี่ยนหลัง Preview กรุณาเตรียมใหม่");
        const confirmedRows = selectConfirmedKsisDraftRows(preview.rows, confirmedIdentityMatches);
        const rows = confirmedRows.filter((row) => row.ready);
        if (!rows.length) throw httpError(400, "ไม่มีรายการพร้อมกรอกในหน้านี้");
        previews.delete(previewId);
        const guard = await installKsisDraftGuard(page, { allowBatchSave: true });
        session.pendingDraft = true; session.draftGuard = guard;
        let result;
        let progress = { completedKeys: [], savedKeys: [], notices: [], batchesSaved: 0 };
        try {
            progress = await fillAndSaveKsisWsBatches(page, rows, guard);
            result = summarizeKsisDraft(confirmedRows, progress.completedKeys, null, "", progress.notices);
            result.saved = true;
            await guard.release();
            session.pendingDraft = false; session.draftGuard = null;
        }
        catch (error) {
            progress = error.draftProgress || progress;
            const message = `${error.statusCode ? error.message : "กรอกหรือบันทึกไม่ครบ หยุดไว้ก่อน"} • มีข้อมูลค้างใน KSIS กรุณาตรวจเอง`;
            result = summarizeKsisDraft(confirmedRows, progress.completedKeys, progress.failedKey, message, progress.notices);
            result.saved = false;
        }
        // A stopped WS job must not intercept the user's corrections or the next login.
        finally { await guard.release(); if (!session.pendingDraft) guard.dispose(); }
        result.rows = result.rows.map((row) => progress.savedKeys.includes(row.key) ? { ...row, outcome: "saved" } : row);
        return { ...result, attemptId: previewId, savedCount: progress.savedKeys.length, studentsSaved: new Set(result.rows.filter((row) => row.outcome === "saved").map(ksisDraftStudentKey)).size,
            batchesSaved: progress.batchesSaved, saveRequests: guard.saveResults().length, page: document.page, pendingDraft: session.pendingDraft };
    });
}

export async function inspectKsisWsDraft(page, session, { acknowledge = false } = {}) {
    await session.draftGuard?.release();
    const state = { readOnly: true, refreshed: false, recovered: false, pendingDraft: true, requiresLogin: false };
    if (session.draftGuard?.pendingSaveCount()) return { ...state, message: 'KSIS ยังไม่ตอบกลับการบันทึก กรุณารอและตรวจผลก่อน ไม่ส่งซ้ำ' };
    const url = new URL(page.url());
    const login = url.origin === new URL(REPORT_URL).origin && /^#\/login(?:[/?]|$)/.test(url.hash);
    if (!login) {
        if (page.url() !== REPORT_URL) return { ...state, message: 'กรุณาเปิดหน้า Report B ที่ต้องการตรวจ โปรแกรมจะไม่เปลี่ยนหน้าหรือรีเฟรชให้' };
        const document = await page.evaluate(readKsisDraftDocument);
        if (document.modalOpen || document.rows.some((row) => row.dirty)) return { ...state, message: 'ยังมีข้อมูลแก้ค้างหรือหน้าต่างย่อยใน KSIS กรุณาบันทึกหรือยกเลิกด้วยตนเอง แล้วกดตรวจสถานะอีกครั้ง' };
        if (!document.rows.length || !ksisContextPeriod(document.context)) return { ...state, message: 'หน้า Report B ยังโหลดไม่ครบ กรุณารอแล้วตรวจสถานะอีกครั้ง' };
        state.page = document.page;
    }
    if (session.draftGuard?.pendingSaveCount()) return { ...state, message: 'KSIS ยังไม่ตอบกลับการบันทึก กรุณารอและตรวจผลก่อน ไม่ส่งซ้ำ' };
    session.draftGuard?.dispose?.();
    session.pendingDraft = false; session.draftGuard = null;
    return { ...state, requiresLogin: login, recovered: true, pendingDraft: false, acknowledged: acknowledge, previousResultUnverified: login,
        message: login ? 'KSIS ออกจากระบบแล้ว ปลดล็อกงานเดิมแล้ว กรุณาเข้าสู่ระบบและเตรียมข้อมูลใหม่ ผลบันทึกรอบเดิมยังไม่ยืนยัน'
            : 'ไม่พบข้อมูลแก้ค้างในหน้านี้ ปลดล็อกแล้ว กรุณาเตรียมข้อมูลใหม่หรือตรวจ WS เพื่อยืนยันผลบันทึกเดิม' };
}

export async function inspectKsisReportDraft({ userId, acknowledge = false }) {
    return withKsisPage({ sourceUrl: REPORT_URL, userId, allowPendingDraft: true, navigate: false }, (page, session) => inspectKsisWsDraft(page, session, { acknowledge }));
}

export async function acknowledgeKsisReportDraft({ userId }) {
    const result = await inspectKsisReportDraft({ userId, acknowledge: true });
    if (!result.recovered) throw httpError(409, result.message);
    return result;
}
