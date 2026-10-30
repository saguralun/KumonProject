import path from 'node:path';

export function downloadFilename(value) {
    return path.posix.basename(String(value || 'download').replaceAll('\\', '/'))
        .replace(/[<>:"|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '') || 'download';
}

export async function saveDesktopDownload({ download, origin, choosePath, notify = async () => {} }) {
    const filename = downloadFilename(download.suggestedFilename());
    const announce = async state => { try { await notify({ filename, ...state }); } catch { } };
    try {
        const url = new URL(download.url());
        if (url.origin !== origin || url.username || url.password || !['http:', 'blob:'].includes(url.protocol)) {
            await download.cancel();
            const result = { status: 'failed', error: 'ปลายทางดาวน์โหลดไม่ได้อยู่ใน KumonDB' };
            await announce(result); return result;
        }
        await announce({ status: 'choosing' });
        const choice = await choosePath(filename);
        if (choice.canceled || !choice.filePath) {
            await download.cancel(); await announce({ status: 'cancelled' }); return { status: 'cancelled' };
        }
        await announce({ status: 'saving' });
        // Playwright's accepted download is temporary. Only saveAs copies it to
        // the user's chosen destination, which must survive application shutdown.
        await download.saveAs(choice.filePath);
        const result = { status: 'saved', path: choice.filePath };
        await announce(result); return result;
    } catch (error) {
        await download.cancel().catch(() => {});
        const result = { status: 'failed', error: error.message || 'บันทึกไฟล์ไม่สำเร็จ' };
        await announce(result); return result;
    }
}

export function installDesktopDownloads({ page, origin, choosePath }) {
    let pending = Promise.resolve();
    page.on('download', download => {
        // One native save dialog at a time; each file retains its own result.
        pending = pending.then(() => saveDesktopDownload({ download, origin, choosePath,
            notify: state => page.evaluate(value => window.dispatchEvent(new CustomEvent('kumon:download-state', { detail: value })), state)
        }));
    });
    return { waitForIdle: () => pending };
}
