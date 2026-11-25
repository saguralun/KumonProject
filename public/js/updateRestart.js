export async function readUpdateRuntime() {
    try {
        const response = await fetch("/api/system/runtime", { cache: "no-store", signal: AbortSignal.timeout(2500) });
        if (!response.ok) return null;
        return await response.json();
    } catch { return null; }
}

export async function getRuntimeInstanceId() {
    return (await readUpdateRuntime())?.instanceId || null;
}

export function updateConfirmationText(serverName) {
    return `อัปเดตและรีสตาร์ต KumonDB บนเครื่องแม่ ${serverName || 'ที่ให้บริการหน้านี้'} ใช่ไหม?\nเครื่องอื่นที่เชื่อมเครื่องแม่นี้จะใช้งานไม่ได้ชั่วคราว\nระบบจะสำรองไฟล์ที่โปรแกรมสร้างก่อนจัดการไฟล์ค้าง กรุณาตรวจว่าไม่มีงานที่ยังไม่บันทึกในโปรแกรมหรือ KSIS`;
}

export async function waitForUpdatedServer(previousInstanceId, { timeoutMs = 10 * 60000, intervalMs = 1000, updateAttemptId } = {}) {
    const deadline = Date.now() + timeoutMs;
    let observedOffline = false;
    do {
        const runtime = await readUpdateRuntime();
        const currentInstanceId = runtime?.instanceId;
        if (currentInstanceId && (previousInstanceId ? currentInstanceId !== previousInstanceId : observedOffline)) return;
        // Only the response-bound attempt may end this wait. An earlier failure
        // (or a later updater) must never be mistaken for the active restart.
        if (updateAttemptId && runtime?.update?.attemptId === updateAttemptId && runtime.update.phase === 'failed') {
            throw new Error(runtime.update.message || 'เปิดโปรแกรมรุ่นใหม่ไม่สำเร็จ กรุณาลองอัปเดตอีกครั้ง');
        }
        if (!currentInstanceId) observedOffline = true;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (Date.now() < deadline);
    throw new Error("ยังยืนยันการ restart ไม่ได้ กรุณาเปิดผ่าน start-kumondb.bat ใหม่ หากยังไม่สำเร็จให้ตรวจไฟล์ logs/restart-*.log");
}
