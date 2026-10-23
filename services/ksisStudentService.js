import { chromium } from "playwright-core";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { httpError } from "./httpError.js";
import { normalizeKsisStudentUrl, readKsisStudentDocument, normalizeKsisStudentData } from "./ksisStudentData.js";
import { createKsisDesktop, desktopAppCookie } from "./ksisDesktop.js";
import { mainDesktop } from './appDesktop.js';

const sessions = new Map();

function sessionFor(userId) {
    if (!Number.isSafeInteger(Number(userId)) || Number(userId) < 1) throw httpError(401, "กรุณาเข้าสู่ระบบด้วยบัญชีผู้ใช้");
    const key = Number(userId);
    if (!sessions.has(key)) sessions.set(key, { context: null, page: null, busy: false, desktop: null });
    return sessions.get(key);
}

export function ksisDesktopStatus(userId) {
    const session = sessionFor(userId);
    return { embedded: Boolean(session.desktop && session.context), busy: session.busy, pendingDraft: Boolean(session.pendingDraft), pendingWork: session.pendingDraft ? session.pendingAt ? 'AT' : 'WS' : null };
}

export async function openKsisDesktop({ userId, origin, cookieHeader }) {
    const session = sessionFor(userId);
    if (session.busy) throw httpError(409, "กำลังทำงานกับ KSIS กรุณารอสักครู่");
    session.busy = true;
    try {
        const app = mainDesktop.current();
        if (app) {
            if (app.origin !== origin) throw httpError(409, 'หน้าต่างหลักใช้ที่อยู่เซิร์ฟเวอร์อื่นอยู่');
            if (session.context && !session.desktop?.unified) throw httpError(409, 'มีหน้าต่าง KSIS เดิมอยู่ กรุณาจัดการงานค้างก่อนย้ายเข้าหน้าต่างหลัก');
            const desktop = await app.activateAccount({ userId: Number(userId), profileDirectory: path.join(ksisProfileDirectory(userId), 'desktop'), cookieHeader });
            if (!session.desktop) desktop.application.once('close', () => {
                if (session.desktop === desktop) { session.desktop = null; session.context = null; session.page = null; session.pendingDraft = false; session.draftGuard = null; }
            });
            session.desktop = desktop; session.context = desktop.context; session.page = desktop.page;
            await desktop.focus();
            return { embedded: true, unified: true };
        }
        if (session.desktop) {
            await session.context.addCookies([desktopAppCookie(cookieHeader, origin)]);
            if (new URL(session.desktop.main.url()).pathname !== '/ksis.html') await session.desktop.main.goto(`${origin}/ksis.html`);
            await session.desktop.focus(); return { embedded: true };
        }
        if (session.context) throw httpError(409, "กรุณาบันทึกหรือยกเลิกข้อมูล แล้วปิด Chrome ของ KSIS เดิมก่อนเปิดแบบฝังในแอป");
        const desktop = await createKsisDesktop({ origin, cookieHeader, profileDirectory: path.join(ksisProfileDirectory(userId), 'desktop') });
        session.desktop = desktop; session.context = desktop.context; session.page = desktop.page;
        desktop.application.once('close', () => {
            if (session.desktop === desktop) { session.desktop = null; session.context = null; session.page = null; session.pendingDraft = false; session.draftGuard = null; }
        });
        return { embedded: true };
    } catch (error) {
        if (error.statusCode) throw error;
        throw httpError(503, "เปิด K-sis ในแอปไม่สำเร็จ กรุณาติดตั้ง dependencies และปิดหน้าต่าง K-sis ที่ค้างอยู่ก่อนลองใหม่");
    } finally { session.busy = false; }
}

export function ksisProfileDirectory(userId) {
    const project = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 12);
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), ".local", "share"), "KumonDB", "ksis", project, String(userId));
}

export function withKsisWorkspacePage(options, action) {
    return withKsisPage({ ...options, requireEmbedded: true }, action);
}

export async function withKsisPage({ sourceUrl, userId, allowPendingDraft = false, requireCurrentPage = false, requireEmbedded = false, navigate = true, focus = true }, action) {
    const key = Number(userId);
    const session = sessionFor(userId);
    if (requireEmbedded && !session.desktop) throw httpError(409, 'กรุณาเปิด K-sis ในแอปก่อน งานกรอกและตรวจใช้เว็บในหน้าต่างแอปเดียวกันเท่านั้น');
    if (session.busy) throw httpError(409, "กำลังอ่านข้อมูล KSIS กรุณารอสักครู่");
    if (session.pendingDraft && !allowPendingDraft) throw httpError(409, "มี Report B ที่กรอกค้างอยู่ กรุณาตรวจและบันทึกเองใน KSIS แล้วกดรับทราบในหน้าตัวกรอกก่อน");
    if (session.pendingAt && session.pendingDraft && !sourceUrl.endsWith('#/atestentrygrid')) throw httpError(409, 'มี AT ค้างอยู่ กรุณาจัดการในแท็บกรอก AT ก่อนเปลี่ยนหน้า');
    session.busy = true;
    try {
        if (session.desktop?.isActive && !await session.desktop.isActive()) throw httpError(409, 'บัญชีในหน้าต่างหลักเปลี่ยนแล้ว กรุณาเปิด K-sis จากบัญชีเดิมก่อนทำงานต่อ');
        if (!session.context) {
            if (mainDesktop.current()) throw httpError(409, 'กรุณาเปิดเมนู K-sis และเข้าสู่ระบบในหน้าต่าง KumonDB ก่อนอ่านข้อมูลนักเรียน ไม่เปิด Chrome แยก');
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
        if (session.desktop && (!session.page || session.page !== session.desktop.page || session.page.isClosed())) throw httpError(409, 'เว็บ KSIS ในแอปปิดแล้ว กรุณาเปิด K-sis ใหม่ ไม่เปิดเว็บหรือหน้าต่างอื่นแทน');
        if (!session.page || session.page.isClosed()) session.page = session.context.pages()[0] || await session.context.newPage();
        const page = session.page;
        if (focus) {
            if (session.desktop) await session.desktop.focus();
            else await page.bringToFront();
        }
        if (navigate && page.url() !== sourceUrl) {
            if (requireCurrentPage) throw httpError(409, 'หน้า KSIS เปลี่ยนหลัง Preview กรุณาเปิดหน้าที่ต้องการและเตรียมข้อมูลใหม่');
            // KSIS autosaves when leaving an entry grid. Never navigate away from untracked edits.
            const dirty = await page.evaluate(() => [...document.querySelectorAll('[data-ng-show*="isDirty"],.modal')]
                .some((element) => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'));
            if (dirty) throw httpError(409, 'KSIS มีข้อมูลแก้ค้างหรือหน้าต่างย่อย กรุณาจัดการก่อนเปลี่ยนหน้า');
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
