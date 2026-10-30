import path from 'node:path';
import { _electron } from 'playwright-core';
import { parse } from 'cookie';
import { httpError } from './httpError.js';
import { installDesktopDownloads } from './desktopDownloadService.js';

const REPORT_URL = 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid';
const DESKTOP_ENTRY = path.resolve('desktop/main.cjs');

function desktopEnvironment(origin, profileDirectory) {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|COMSPEC|PATH|LOCALAPPDATA|APPDATA|TEMP|TMP|USERPROFILE|HOME|LANG|DISPLAY|XAUTHORITY)$/i.test(key)));
    return { ...env, KUMON_APP_ORIGIN: origin, KUMON_DESKTOP_PROFILE: profileDirectory };
}

async function focusApplication(application) {
    await application.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } });
}

export async function createApplicationDesktop({ origin, profileDirectory, configureContext, cookieHeader, startPath = '/login.html', downloadDirectory }) {
    const startUrl = new URL(startPath, origin);
    if (startUrl.origin !== origin || startUrl.username || startUrl.password) throw httpError(400, 'หน้าเริ่มต้นต้องอยู่ใน KumonDB');
    const application = await _electron.launch({ args: ['--remote-debugging-address=127.0.0.1', DESKTOP_ENTRY], cwd: process.cwd(),
        env: { ...desktopEnvironment(origin, profileDirectory), KUMON_DESKTOP_MAIN: '1', KUMON_DESKTOP_OWNER_PID: String(process.pid) }, chromiumSandbox: true, acceptDownloads: true, timeout: 30000 });
    try {
        const main = await application.firstWindow({ timeout: 20000 }), context = application.context();
        await application.evaluate(async ({ app }) => {
            for (let attempt = 0; attempt < 100; attempt++) {
                if (app.kumonDesktopController?.isReady()) return;
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            throw new Error('Desktop initialization timed out');
        });
        if (configureContext) await configureContext(context);
        if (cookieHeader) await context.addCookies([desktopAppCookie(cookieHeader, origin)]);
        const directory = downloadDirectory || await application.evaluate(({ app }) => app.getPath('downloads'));
        const downloads = installDesktopDownloads({ page: main, origin, directory });
        await main.goto(startUrl.href, { waitUntil: 'domcontentloaded' });
        const accounts = new Map();
        const desktop = { application, context, main, origin,
            downloadsIdle: () => downloads.waitForIdle(),
            focus: () => focusApplication(application),
            async assertAppSession(header) {
                const expected = desktopAppCookie(header, origin).value;
                const actual = (await context.cookies(origin)).find((cookie) => cookie.name === 'kumondb.sid')?.value;
                if (actual !== expected) throw httpError(409, 'กรุณาเข้าเมนู K-sis จากบัญชีในหน้าต่าง KumonDB ที่เปิดอยู่ ไม่เปลี่ยนบัญชีจากหน้าต่างอื่น');
            },
            setStudentPreview: options => application.evaluate(({ app }, value) => app.kumonDesktopController.setStudentPreview(value), options),
            async activateAccount({ userId, profileDirectory: remoteProfile, cookieHeader: header, initialUrl = REPORT_URL }) {
                await desktop.assertAppSession(header);
                const known = accounts.get(userId);
                if (known?.page.isClosed()) throw httpError(409, 'เว็บ KSIS เดิมปิดแล้ว กรุณาตรวจงานค้างก่อนเปิดใหม่');
                const marker = `about:blank#kumon-ksis-${userId}`;
                await application.evaluate(async ({ app }, options) => app.kumonDesktopController.activateKsisAccount(options),
                    { userId, profileDirectory: remoteProfile });
                let page = known?.page || context.pages().find((item) => item !== main && item.url() === marker);
                for (let attempt = 0; !page && attempt < 100; attempt++) {
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    page = context.pages().find((item) => item !== main && item.url() === marker);
                }
                if (!page) throw new Error('The selected KSIS view did not attach');
                if (await page.evaluate(() => Boolean(window.kumonDesktop))) throw new Error('Remote view has app privileges');
                const cookie = desktopAppCookie(header, origin).value;
                const account = known || { application, main, page, context: page.context(), unified: true, focus: desktop.focus };
                account.isActive = async () => {
                    const currentCookie = (await context.cookies(origin)).find((item) => item.name === 'kumondb.sid')?.value;
                    return currentCookie === cookie && await application.evaluate(({ app }, id) => app.kumonDesktopController.activeKsisAccount() === id, userId);
                };
                // Keep the exact page even if the first load fails. Retrying must not create
                // another view or overwrite a page the user has since opened manually.
                accounts.set(userId, account);
                if (page.url() === marker) await page.goto(initialUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
                return account;
            }
        };
        return desktop;
    } catch (error) { await application.close().catch(() => {}); throw error; }
}

export function desktopAppCookie(header, origin) {
    const value = parse(header || '', { decode: (text) => text })['kumondb.sid'];
    if (!value) throw httpError(401, 'กรุณาเข้าสู่ระบบ KumonDB ก่อนเปิด K-sis ในแอป');
    return { name: 'kumondb.sid', value, url: origin, httpOnly: true, sameSite: 'Lax' };
}

export async function createKsisDesktop({ origin, profileDirectory, cookieHeader, configureContext }) {
    const cookie = desktopAppCookie(cookieHeader, origin);
    const application = await _electron.launch({ args: ['--remote-debugging-address=127.0.0.1', path.resolve('desktop/main.cjs')], cwd: process.cwd(),
        env: desktopEnvironment(origin, profileDirectory), chromiumSandbox: true, acceptDownloads: false, timeout: 30000 });
    try {
        const main = await application.firstWindow({ timeout: 20000 });
        const context = application.context();
        const page = context.pages().find((item) => item !== main)
            || await context.waitForEvent('page', { predicate: (item) => item !== main, timeout: 10000 });
        if (!main.url().startsWith('file:') || !await main.evaluate(() => Boolean(window.kumonDesktop))
            || await page.evaluate(() => Boolean(window.kumonDesktop))) throw new Error('Desktop view isolation failed');
        if (configureContext) await configureContext(context);
        await context.addCookies([cookie]);
        await main.goto(`${origin}/ksis.html`, { waitUntil: 'domcontentloaded' });
        await page.goto(REPORT_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
        return { application, context, main, page, focus: () => focusApplication(application) };
    } catch (error) { await application.close().catch(() => {}); throw error; }
}
