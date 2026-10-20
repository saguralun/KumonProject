import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { httpError } from "./httpError.js";
import { normalizeKsisStudentUrl, readKsisStudentDocument, normalizeKsisStudentData } from "./ksisStudentData.js";

const sessions = new Map();

export function ksisProfileDirectory(userId) {
    const project = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 12);
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "KumonDB", "ksis", project, String(userId));
}

export async function withKsisPage({ sourceUrl, userId, allowPendingDraft = false }, action) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) throw httpError(401, "กรุณาเข้าสู่ระบบด้วยบัญชีผู้ใช้");
    const key = Number(userId);
    let session = sessions.get(key);
    if (!session) {
        session = { context: null, page: null, busy: false };
        sessions.set(key, session);
    }
    if (session.busy) throw httpError(409, "กำลังอ่านข้อมูล KSIS กรุณารอสักครู่");
    if (session.pendingDraft && !allowPendingDraft) throw httpError(409, "มี Report B ที่กรอกค้างอยู่ กรุณาตรวจและบันทึกเองใน KSIS แล้วกดรับทราบในหน้าตัวกรอกก่อน");
    session.busy = true;
    try {
        if (!session.context) {
            try {
                session.context = await chromium.launchPersistentContext(ksisProfileDirectory(key), {
                    channel: "chrome", headless: false, viewport: null, chromiumSandbox: true,
                    acceptDownloads: false, serviceWorkers: "block", timeout: 20000
                });
                session.context.on("close", () => { session.context = null; session.page = null; session.pendingDraft = false; });
            } catch {
                throw httpError(503, "เปิด Chrome สำหรับ KSIS ไม่สำเร็จ กรุณาติดตั้ง Chrome หรือปิดหน้าต่าง KSIS ของ KumonDB ที่ค้างอยู่ แล้วลองใหม่");
            }
        }
        if (!session.page || session.page.isClosed()) session.page = session.context.pages()[0] || await session.context.newPage();
        const page = session.page;
        await page.bringToFront();
        if (page.url() !== sourceUrl) {
            await page.goto("about:blank");
            await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
        }
        return await action(page, session);
    } catch (error) {
        if (error.statusCode) throw error;
        throw httpError(502, "อ่านข้อมูล KSIS ไม่สำเร็จ กรุณาตรวจการเชื่อมต่อ และรอให้หน้าข้อมูลนักเรียนโหลดครบก่อนลองใหม่");
    } finally {
        session.busy = false;
    }
}

export async function previewKsisStudent({ url, userId }) {
    const sourceUrl = normalizeKsisStudentUrl(url);
    return withKsisPage({ sourceUrl, userId }, async (page) => {
        await page.waitForFunction(() => location.hash.includes("/login")
            || Boolean(document.getElementById("firstName")?.value && document.getElementById("lastName")?.value), {}, { timeout: 15000 });
        if (page.url().includes("/login")) return { requiresLogin: true, sourceUrl };
        if (normalizeKsisStudentUrl(page.url()) !== sourceUrl) throw httpError(409, "หน้า KSIS เปลี่ยนไป กรุณาลองอ่านลิงก์นักเรียนอีกครั้ง");
        const student = normalizeKsisStudentData(await page.evaluate(readKsisStudentDocument));
        return { requiresLogin: false, sourceUrl, student };
    });
}
