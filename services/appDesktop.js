import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createApplicationDesktop } from './ksisDesktop.js';
import { httpError } from './httpError.js';

function appDesktopProfileDirectory() {
    const project = createHash('sha256').update(process.cwd()).digest('hex').slice(0, 12);
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'KumonDB', 'desktop', project);
}

export function createAppDesktopManager(launch = createApplicationDesktop) {
    let desktop = null, launching = null;
    return {
        current: () => desktop,
        async open(options) {
            if (desktop && desktop.origin !== options.origin) throw httpError(409, 'หน้าต่าง KumonDB ใช้ที่อยู่เซิร์ฟเวอร์อื่นอยู่');
            if (!desktop && !launching) {
                launching = launch({ profileDirectory: appDesktopProfileDirectory(), ...options }).then((created) => {
                    desktop = created;
                    created.application.once('close', () => { if (desktop === created) desktop = null; });
                    return created;
                }).finally(() => { launching = null; });
            }
            const current = desktop || await launching;
            if (current.origin !== options.origin) throw httpError(409, 'หน้าต่าง KumonDB ใช้ที่อยู่เซิร์ฟเวอร์อื่นอยู่');
            return current;
        }
    };
}

export const mainDesktop = createAppDesktopManager();
