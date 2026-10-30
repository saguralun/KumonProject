import path from 'node:path';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';

export function downloadFilename(value) {
    return path.posix.basename(String(value || 'download').replaceAll('\\', '/'))
        .replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'download';
}

export async function saveDesktopDownload({ download, origin, directory, notify = async () => {} }) {
    const filename = downloadFilename(download.suggestedFilename());
    const announce = async state => { try { await notify({ filename, ...state }); } catch { } };
    try {
        const url = new URL(download.url());
        if (url.origin !== origin || url.username || url.password || !['http:', 'blob:'].includes(url.protocol)) {
            await download.cancel();
            const result = { status: 'failed', error: 'ปลายทางดาวน์โหลดไม่ได้อยู่ใน KumonDB' };
            await announce(result); return result;
        }
        await announce({ status: 'saving' });
        // The controller's accepted download is temporary; copy it outside its
        // artifact directory so it survives application shutdown.
        // Avoid native file dialogs: Windows shell integrations can leave an
        // invisible modal while the application's main window remains disabled.
        if (!path.isAbsolute(directory)) throw new Error('ไม่พบโฟลเดอร์ดาวน์โหลดของเครื่องนี้');
        await fs.mkdir(directory, { recursive: true });
        const source = await download.path();
        if (!source) throw new Error('รับไฟล์ดาวน์โหลดไม่สำเร็จ');
        const extension = path.extname(filename), stem = filename.slice(0, filename.length - extension.length);
        for (let index = 0; index < 1000; index++) {
            const destination = path.join(directory, index ? `${stem} (${index})${extension}` : filename);
            try { await fs.copyFile(source, destination, constants.COPYFILE_EXCL); }
            catch (error) { if (error.code === 'EEXIST') continue; throw error; }
            const result = { status: 'saved', path: destination };
            await announce(result); return result;
        }
        throw new Error('มีไฟล์ชื่อซ้ำจำนวนมาก กรุณาตรวจโฟลเดอร์ Downloads');
    } catch (error) {
        await download.cancel().catch(() => {});
        const result = { status: 'failed', error: error.message || 'บันทึกไฟล์ไม่สำเร็จ' };
        await announce(result); return result;
    }
}

export function installDesktopDownloads({ page, origin, directory }) {
    let pending = Promise.resolve();
    page.on('download', download => {
        // Serialize copies; exclusive creation also protects concurrent app runs.
        pending = pending.then(() => saveDesktopDownload({ download, origin, directory,
            notify: state => page.evaluate(value => window.dispatchEvent(new CustomEvent('kumon:download-state', { detail: value })), state)
        }));
    });
    return { waitForIdle: () => pending };
}
