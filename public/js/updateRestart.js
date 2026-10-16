export async function getRuntimeInstanceId() {
    try {
        const response = await fetch("/api/system/runtime", { cache: "no-store", signal: AbortSignal.timeout(2500) });
        if (!response.ok) return null;
        return (await response.json()).instanceId || null;
    } catch { return null; }
}

export async function waitForUpdatedServer(previousInstanceId, { timeoutMs = 60000, intervalMs = 1000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let observedOffline = false;
    do {
        const currentInstanceId = await getRuntimeInstanceId();
        if (currentInstanceId && (previousInstanceId ? currentInstanceId !== previousInstanceId : observedOffline)) return;
        if (!currentInstanceId) observedOffline = true;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    } while (Date.now() < deadline);
    throw new Error("ยังยืนยันการ restart ไม่ได้ กรุณาเปิดผ่าน start-kumondb.bat ใหม่ หากยังไม่สำเร็จให้ตรวจไฟล์ logs/restart-*.log");
}
