import { withKsisWorkspacePage as withKsisPage } from "./ksisStudentService.js";
import { buildMonthlyReport } from "./reportService.js";
import { readKsisDraftDocument, ksisContextPeriod } from "./ksisReportDraft.js";
import { readKsisRosterDocument } from "./ksisRosterService.js";
import { normalizeKumonStudentId } from "./kumonStudentId.js";
import { normalizeKsisBirthDate } from "./ksisStudentData.js";
import { httpError } from "./httpError.js";
import { matchKsisReportIdentity } from './ksisReportIdentity.js';

const REPORT_URL = "https://kao.ksis.kumon.com/kth/#/reportbeditgrid";
const SUBJECTS = ["ME", "EFL", "TRP"];
const REFRESH_READ_URL = "https://kao.ksis.kumon.com/kth/api/reportb/GetReportBDetailEntryListPageByCriteria";
const AUDIT_READ_URLS = new Set(["GetReportBDetailEntryListPageByCriteria", "GetReportBStatus", "GetReportBDetailErrorCount", "GetReportBDetailValidationPendingCount", "GetReportBDetailCount"]
    .map((name) => `https://kao.ksis.kumon.com/kth/api/reportb/${name}`));
const keyFor = (id, subject) => `${normalizeKumonStudentId(id)}:${subject}`;
const isAbsent = (status) => ['A', 'OT'].includes(status);

function auditSubjectRows(documents, subjects) {
    const rows = [], seen = new Set();
    let ignoredBlankRows = 0, repeatedRows = 0;
    for (const doc of documents) for (const source of doc.rows) {
        if (!subjects.includes(source.subject)) continue;
        const values = ['level', 'worksheet', 'used', 'status'].map((field) => String(source[field]?.value ?? '').trim());
        if (values.every((value) => value === '') && !source.dirty && !source.validationError) { ignoredBlankRows++; continue; }
        // A student can straddle pages; only collapse the same identified subject row with identical data.
        const identity = source.key ? JSON.stringify([source.key, normalizeKumonStudentId(source.kumonId), source.subject,
            String(source.fullName || '').normalize('NFC').trim(), normalizeKsisBirthDate(source.birthDate) || String(source.birthDate || '').trim(), values]) : null;
        if (identity && seen.has(identity)) { repeatedRows++; continue; }
        if (identity) seen.add(identity);
        rows.push({ ...source, page: doc.page, studentKey: source.studentKey ? `${doc.page}:${source.studentKey}` : undefined });
    }
    return { rows, ignoredBlankRows, repeatedRows };
}

export function isKsisAuditReadRequest(method, url, type) {
    return ["GET", "HEAD", "OPTIONS"].includes(method) || method === "POST" && ["fetch", "xhr"].includes(type) && AUDIT_READ_URLS.has(url);
}

export function compareKsisWs(records, documents, { subject = "ALL", scope = "current" } = {}) {
    const subjects = subject === "ALL" ? SUBJECTS : [subject];
    if (!subjects.every((item) => SUBJECTS.includes(item)) || !["current", "all"].includes(scope)) throw httpError(400, "ขอบเขตการตรวจ WS ไม่ถูกต้อง");
    const local = records.filter((row) => subjects.includes(row.Subject));
    const { rows: website, ignoredBlankRows, repeatedRows } = auditSubjectRows(documents, subjects);
    const claimed = new Set();
    const rows = []; let outsidePage = 0;
    for (const record of local) {
        const kumonId = normalizeKumonStudentId(record["รหัสคุมอง"]);
        const matched = matchKsisReportIdentity(record, records, website);
        const key = matched.method === 'name_birth_date' ? `local:${record.ID}:${record.Subject}` : keyFor(kumonId, record.Subject);
        const targets = matched.targets;
        for (const target of targets) claimed.add(target);
        const actual = targets[0];
        const current = String(record.CurrentLevel || "").match(/^(.*\D)(\d+)$/);
        const expected = { level: current?.[1] || "", worksheet: current ? Number(current[2]) : null,
            used: record.IsKc === true ? 1 : Number(record.WksUsed), status: record.Status1 };
        const row = { key, kumonId, name: `${record["ชื่อจริง"] || ""} ${record["นามสกุล"] || ""}`.trim(), subject: record.Subject,
            page: actual?.page || null, isKc: record.IsKc === true, expected, matchMethod: matched.method, birthDate: record['วันเกิด'] || '',
            actual: actual ? { level: actual.level.value, worksheet: actual.worksheet.value, used: actual.used.value, status: actual.status.value } : null,
            differences: [], outcome: "matched", reason: "" };
        if (scope === "current" && !actual && matched.method === 'kumon_id' && !matched.reason) { outsidePage++; continue; }
        if (isAbsent(record.Status1) || targets.some((target) => isAbsent(target.status.value))) {
            row.outcome = "skipped"; row.reason = "ข้ามสถานะ A/OT";
        } else if (matched.reason) {
            row.outcome = "review"; row.reason = matched.reason === 'รหัสและวิชาซ้ำใน KSIS'
                ? 'พบหลายแถวที่มีข้อมูลของนักเรียนและวิชาเดียวกันใน KSIS ต้องตรวจแถวที่ใช้เทียบ' : matched.reason;
        } else if (!actual) {
            if (scope === "current") { outsidePage++; continue; }
            row.outcome = "missing_ksis"; row.reason = "ไม่พบในหน้าที่อ่านจาก KSIS กรุณาตรวจตัวกรองและรายชื่อ";
        } else if (normalizeKsisBirthDate(record["วันเกิด"]) && normalizeKsisBirthDate(record["วันเกิด"]) !== normalizeKsisBirthDate(actual.birthDate)) {
            row.outcome = "review"; row.reason = "วันเกิดไม่ตรงกัน ไม่ยืนยันว่าเป็นนักเรียนคนเดียวกัน";
        } else if (!current || expected.worksheet < 10 || expected.worksheet > 200 || expected.worksheet % 10 !== 0
            || !Number.isInteger(expected.used) || expected.used < 0 || !expected.status) {
            row.outcome = "review"; row.reason = "ข้อมูลระดับ หน้า WS หรือ ST1 ใน Report ไม่ครบหรือไม่ถูกต้อง";
        } else {
            for (const [field, label] of [["level", "ระดับ"], ["worksheet", "หน้า"], ["used", "WS used"], ["status", "ST1"]]) {
                const raw = row.actual[field];
                const matches = ["worksheet", "used"].includes(field) ? String(raw).trim() !== "" && Number(raw) === expected[field] : raw === expected[field];
                if (!matches) row.differences.push({ field, label, expected: expected[field], actual: raw });
            }
            if (row.differences.length) { row.outcome = "mismatch"; row.reason = row.differences.map((item) => item.label).join(", "); }
        }
        rows.push(row);
    }
    for (const actual of website) {
        if (claimed.has(actual)) continue;
        rows.push({ key: `${actual.page}:${actual.key || keyFor(actual.kumonId, actual.subject)}`, kumonId: actual.kumonId, name: actual.fullName, subject: actual.subject,
            page: actual.page, expected: null, actual: { level: actual.level.value, worksheet: actual.worksheet.value, used: actual.used.value, status: actual.status.value },
            differences: [], outcome: isAbsent(actual.status.value) ? "skipped" : "missing_report", reason: isAbsent(actual.status.value) ? "ข้ามสถานะ A/OT" : "ไม่พบรายวิชานี้ใน Report ของเดือนที่เลือก" });
    }
    return { rows, outsidePage, ignoredBlankRows, repeatedRows, counts: Object.fromEntries(["matched", "mismatch", "review", "missing_ksis", "missing_report", "skipped"].map((outcome) => [outcome, rows.filter((row) => row.outcome === outcome).length])) };
}

export async function readSavedKsisWsPages(page, { month, year, scope = "current" }) {
    if (!["current", "all"].includes(scope)) throw httpError(400, "ขอบเขตการตรวจไม่ถูกต้อง");
    const load = async () => {
        await page.waitForFunction(() => location.hash.includes("/login") || document.querySelector("table.vk-grid-content-student"), {}, { timeout: 20000 });
        if (page.url().includes("/login")) return null;
        if (page.url() !== REPORT_URL) throw httpError(409, "กรุณาเปิดหน้า Report B ใน KSIS ก่อนตรวจ WS");
        const document = await page.evaluate(readKsisDraftDocument);
        const period = ksisContextPeriod(document.context);
        if (!period || period.month !== Number(month) || period.year !== Number(year)) throw httpError(409, "เดือน/ปีใน KSIS ไม่ตรงกับ Report ไม่เริ่มตรวจ");
        if (document.modalOpen || document.rows.some((row) => row.dirty)) throw httpError(409, "มีหน้าต่างย่อยหรือข้อมูลที่ยังไม่บันทึกใน KSIS กรุณาจัดการก่อนตรวจ ไม่รีเฟรชทิ้งข้อมูล");
        return document;
    };
    const initial = await load();
    if (!initial) return { requiresLogin: true };
    let blocked = false;
    // Verification cannot authorize any write, including KSIS's periodic automatic save.
    const route = (requestRoute) => {
        const request = requestRoute.request();
        if (isKsisAuditReadRequest(request.method(), request.url(), request.resourceType())) return requestRoute.fallback();
        blocked = true; return requestRoute.abort("blockedbyclient");
    };
    await page.route("**/*", route);
    try {
        // Use KSIS's own Refresh command; reloading the document clears its in-memory login.
        const response = page.waitForResponse((item) => item.url() === REFRESH_READ_URL && item.request().method() === "POST", { timeout: 20000 }).catch(() => null);
        await page.locator("#buttonReportBAction").click({ timeout: 8000 });
        await page.locator('a[data-ng-click="buttonClicked({message:\'btnPopupReportBActionRefresh\'})"]:visible').click({ timeout: 8000 });
        const refreshed = await response;
        if (!refreshed || !refreshed.ok() || await refreshed.finished()) throw httpError(409, "KSIS ยังไม่ยืนยันการอ่านข้อมูลใหม่ ไม่ถือว่าตรวจข้อมูลที่บันทึกสำเร็จ");
        await page.waitForFunction(() => document.querySelector("#buttonReportBAction")?.disabled === false, {}, { timeout: 20000 });
        let document = await load();
        if (!document) return { requiresLogin: true };
        const assertContext = () => {
            if (blocked) throw httpError(409, "KSIS พยายามส่งคำขอระหว่างตรวจ ถูกหยุดไว้โดยไม่บันทึก ยังไม่ยืนยันผลตรวจ");
            if (document.context !== initial.context) throw httpError(409, "ศูนย์หรือเดือน KSIS เปลี่ยนระหว่างตรวจ หยุดไว้ก่อน");
        };
        const move = async (label, target) => {
            const old = JSON.stringify(document.rows.map((row) => [row.key, row.kumonId, row.subject]));
            await page.locator("ul.pagination a").filter({ hasText: new RegExp(`^${label}$`) }).click({ timeout: 8000 });
            await page.waitForFunction(({ target, old }) => {
                if (Number(window.document.querySelector("ul.pagination li.active")?.textContent.trim()) !== target) return false;
                const ids = Array.from(window.document.querySelectorAll("table.vk-grid-content-student")).flatMap((table) => {
                    const id = table.rows[0]?.cells[2]?.textContent.trim();
                    return Array.from(table.parentElement.querySelector("table.vk-grid-content-subject")?.rows || []).map((row) => [row.getAttribute("data-clrowid"), id,
                        ({ Math: "ME", "English EFL": "EFL", "Thai Reading": "TRP" })[row.cells[1]?.textContent.trim()] || ""]);
                });
                return ids.length > 0 && JSON.stringify(ids) !== old;
            }, { target, old }, { timeout: 20000 });
            document = await load();
            if (!document) throw httpError(409, "KSIS ออกจากระบบระหว่างตรวจ กรุณาเข้าสู่ระบบใหม่");
            assertContext();
        };
        assertContext();
        if (document.page !== 1) await move("«", 1);
        const targetPage = scope === "current" ? initial.page : 1;
        while (document.page < targetPage) {
            if (!(await page.evaluate(readKsisRosterDocument)).hasNext) throw httpError(409, "ไม่พบหน้าเดิมหลังอ่านข้อมูลที่บันทึก กรุณาตรวจตัวกรอง KSIS");
            await move("›", document.page + 1);
        }
        const documents = []; const seen = new Set();
        while (true) {
            assertContext();
            if (seen.has(document.page) || seen.size >= 200) throw httpError(409, "หน้ารายชื่อ KSIS ซ้ำหรือเกินขอบเขต ไม่ยืนยันผลตรวจ");
            seen.add(document.page); documents.push(document);
            if (scope === "current" || !(await page.evaluate(readKsisRosterDocument)).hasNext) break;
            await move("›", document.page + 1);
        }
        return { requiresLogin: false, documents, context: initial.context, pagesRead: documents.length, originalPage: initial.page,
            page: document.page, verifiedAt: new Date().toISOString() };
    } catch (error) {
        if (blocked) throw httpError(409, "KSIS พยายามส่งคำขอระหว่างตรวจ ถูกหยุดไว้โดยไม่บันทึก ยังไม่ยืนยันผลตรวจ");
        throw error;
    } finally { await page.unroute("**/*", route); }
}

export async function auditKsisWs({ userId, month, year, subject = "ALL", scope = "current" }) {
    if (!["ALL", ...SUBJECTS].includes(subject) || !["current", "all"].includes(scope)) throw httpError(400, "กรุณาเลือกวิชาและขอบเขตการตรวจ");
    const records = await buildMonthlyReport({ month, year });
    return withKsisPage({ sourceUrl: REPORT_URL, userId }, async (page) => {
        const data = await readSavedKsisWsPages(page, { month, year, scope });
        if (data.requiresLogin) return data;
        const { documents, ...metadata } = data;
        return { ...metadata, ...compareKsisWs(records, documents, { subject, scope }), scope, subject, period: { month: Number(month), year: Number(year) } };
    });
}
