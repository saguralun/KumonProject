import { httpError } from './httpError.js';
import { randomUUID } from 'node:crypto';

const workspaces = new Map();
export const ksisWorkspaceInstance = randomUUID();
function workspaceFor(userId) {
    const id = Number(userId);
    if (!Number.isSafeInteger(id) || id < 1) throw httpError(401, 'กรุณาเข้าสู่ระบบ');
    if (!workspaces.has(id)) workspaces.set(id, { revision: 0, activeView: null, busy: false, tools: {} });
    return workspaces.get(id);
}
export function readKsisWorkspace(userId, after) {
    const state = workspaceFor(userId);
    return Number(after) === state.revision ? { instanceId: ksisWorkspaceInstance, revision: state.revision, unchanged: true } : { instanceId: ksisWorkspaceInstance, ...structuredClone(state) };
}

export async function runKsisWorkspace(userId, view, action, input, execute) {
    const state = workspaceFor(userId);
    if (state.busy) throw httpError(409, 'มีหน้าต่างอื่นกำลังทำงานกับ KSIS กรุณารอ');
    if (!['at', 'draft', 'audit', 'atAudit'].includes(view)) throw httpError(400, 'งาน KSIS ไม่ถูกต้อง');
    const tool = state.tools[view] ||= { preview: null, result: null, confirmed: [], pending: false, error: '' };
    if (Object.values(state.tools).some((item) => item.pending) && !['inspect', 'acknowledge'].includes(action)) throw httpError(409, 'มีข้อมูล KSIS ค้างอยู่ กรุณาตรวจโดยไม่เริ่มงานใหม่');
    if (action === 'fill' && tool.preview && tool.preview.previewId !== input.previewId) throw httpError(409, 'หน้าต่างอื่นเตรียม Preview ใหม่แล้ว กรุณาตรวจ Preview ล่าสุด');
    state.activeView = view; state.busy = true; tool.action = action; tool.error = ''; state.revision++;
    if (action === 'preview' || action === 'read') {
        tool.preview = null; tool.result = null; tool.confirmed = []; tool.inspection = null;
        tool.period = { month: Number(input.month), year: Number(input.year) }; tool.subject = input.subject;
    }
    try {
        const result = await execute();
        if (action === 'preview') tool.preview = result.requiresLogin ? null : result;
        else if (action === 'inspect') tool.inspection = result;
        else if (action === 'fill' || action === 'read') {
            tool.result = result; tool.preview = null; tool.pending = result.pendingDraft === true;
        } else if (action === 'acknowledge') tool.pending = false;
        tool.requiresLogin = result.requiresLogin === true;
        return result;
    } catch (error) {
        tool.error = error.statusCode ? error.message : 'ทำงานกับ KSIS ไม่สำเร็จ กรุณาตรวจข้อมูลค้าง';
        if (action === 'fill') tool.preview = null;
        throw error;
    } finally { state.busy = false; state.revision++; }
}

export function confirmKsisWorkspace(userId, { view, previewId, confirmed }) {
    const state = workspaceFor(userId), tool = state.tools[view];
    if (state.busy || tool?.pending) throw httpError(409, 'กำลังทำงานหรือมีข้อมูลค้าง ไม่เปลี่ยนการยืนยันคู่');
    if (!['at', 'draft'].includes(view) || !tool?.preview || tool.preview.previewId !== previewId) throw httpError(409, 'Preview เปลี่ยนหรือหมดอายุ กรุณาเตรียมใหม่');
    if (!Array.isArray(confirmed) || confirmed.length > tool.preview.rows.length || new Set(confirmed).size !== confirmed.length) throw httpError(400, 'รายการยืนยันไม่ถูกต้อง');
    const allowed = tool.preview.rows.filter((row) => row.requiresIdentityConfirmation && (view === 'at' ? row.outcome === 'ready' : row.ready)).map((row) => view === 'at' ? row.id : row.key);
    if (confirmed.some((key) => !allowed.includes(key))) throw httpError(400, 'รายการยืนยันไม่ตรงกับ Preview');
    tool.confirmed = [...confirmed]; state.revision++;
    return readKsisWorkspace(userId);
}
