import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const startupStages = Object.freeze({
    checking: 'ตรวจโปรแกรม',
    starting: 'เริ่มเซิร์ฟเวอร์',
    modules: 'โหลดส่วนประกอบโปรแกรม',
    server: 'เซิร์ฟเวอร์พร้อมแล้ว',
    desktop: 'เปิดหน้าต่าง KumonDB',
    login: 'โหลดหน้าล็อกอิน',
    ready: 'พร้อมใช้งาน',
    error: 'เปิดโปรแกรมยังไม่สำเร็จ'
});

export function startupStatusPath(projectDirectory, localAppData) {
    if (!localAppData || !path.isAbsolute(localAppData)) return null;
    const resolved = path.resolve(projectDirectory);
    const project = createHash('sha256').update(process.platform === 'win32' ? resolved.toLowerCase() : resolved).digest('hex').slice(0, 12);
    return path.join(localAppData, 'KumonDB', 'startup', `${project}.json`);
}

// Diagnostics contain stage names and elapsed time only. Never allow an env
// variable to redirect this writer into source files or arbitrary user files.
export function createStartupReporter({ env = process.env, projectDirectory = process.cwd(), storage = fs, now = () => Date.now() } = {}) {
    const expected = startupStatusPath(projectDirectory, env.LOCALAPPDATA);
    const attemptId = env.KUMON_STARTUP_ATTEMPT;
    const enabled = expected && env.KUMON_STARTUP_STATUS === expected && /^[a-f\d-]{36}$/i.test(attemptId || '');
    return function report(stage) {
        if (!enabled || !Object.hasOwn(startupStages, stage)) return;
        try {
            const state = JSON.parse(storage.readFileSync(expected, 'utf8').replace(/^\uFEFF/, ''));
            // A later shortcut invocation owns the file; old servers must never
            // overwrite its progress, or resurrect a finished attempt.
            if (state.attemptId !== attemptId || state.status !== 'loading' || state.stage === stage) return;
            const elapsedMs = Math.max(0, now() - Date.parse(state.startedAt));
            if (!Number.isFinite(elapsedMs) || !Array.isArray(state.history)) return;
            const next = { ...state, stage, elapsedMs, updatedAt: new Date(now()).toISOString(),
                status: stage === 'ready' ? 'ready' : stage === 'error' ? 'error' : 'loading',
                history: [...state.history, { stage, elapsedMs }].slice(-16) };
            const temporary = `${expected}.${attemptId}.tmp`;
            storage.writeFileSync(temporary, JSON.stringify(next), 'utf8');
            storage.renameSync(temporary, expected);
        } catch { /* Progress is optional and must never prevent opening the app. */ }
    };
}

export const reportStartupStage = createStartupReporter();
