import express from "express";
import { requireStaff } from "../middleware/auth.js";
import { createSendError } from "./routeErrorHandler.js";
import { previewKsisReportDraft, applyKsisReportDraft, acknowledgeKsisReportDraft, inspectKsisReportDraft, resetKsisReportDraft } from "../services/ksisReportDraft.js";
import { auditKsisWs } from "../services/ksisWsAudit.js";
import { auditKsisAt } from '../services/ksisAtAudit.js';
import { KSIS_AT_URL, previewKsisAt, applyKsisAt, acknowledgeKsisAt, inspectKsisAt } from '../services/ksisAtEntry.js';
import { readKsisWorkspace, runKsisWorkspace, confirmKsisWorkspace, ksisWorkspaceInstance } from '../services/ksisWorkspaceState.js';
import { openKsisDesktop, ksisDesktopStatus, withKsisWorkspacePage as withKsisPage } from "../services/ksisStudentService.js";

const router = express.Router();
const sendError = createSendError("Unexpected KSIS error");

export function requireLocalKsis(req, res, next) {
    res.set("Cache-Control", "no-store");
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) {
        return res.status(403).json({ success: false, error: "กรุณาใช้งาน KSIS ผ่าน localhost บนเครื่องที่รัน KumonDB" });
    }
    next();
}

export async function handleKsisDraft(req, res) {
    try {
        const userId = req.session.user.userId;
        let result;
        const run = (execute) => runKsisWorkspace(userId, 'draft', req.params.action, req.body || {}, execute);
        if (req.params.action === "preview") result = await run(() => previewKsisReportDraft({ userId, month: req.body?.month, year: req.body?.year, subject: req.body?.subject }));
        else if (req.params.action === "fill") result = await run(() => applyKsisReportDraft({ userId, previewId: req.body?.previewId, saveAfterFill: req.body?.saveAfterFill === true, confirmedIdentityMatches: req.body?.confirmedIdentityMatches }));
        else if (req.params.action === "acknowledge") result = await run(() => acknowledgeKsisReportDraft({ userId }));
        else if (req.params.action === "inspect") result = await run(() => inspectKsisReportDraft({ userId }));
        else if (req.params.action === 'reset') result = await run(() => resetKsisReportDraft({ userId, confirmDiscard: req.body?.confirmDiscard }));
        else return res.status(404).json({ success: false, error: "ไม่พบคำสั่ง" });
        res.json({ success: true, ...result });
    } catch (error) { sendError(res, error); }
}

router.use(requireStaff, requireLocalKsis);
router.get('/workspace', (req, res) => res.json({ success: true, ...readKsisWorkspace(req.session.user.userId, req.query.instance === ksisWorkspaceInstance ? req.query.after : undefined), connection: ksisDesktopStatus(req.session.user.userId) }));
router.post('/workspace/confirm', (req, res) => {
    try { res.json({ success: true, ...confirmKsisWorkspace(req.session.user.userId, req.body || {}) }); }
    catch (error) { sendError(res, error); }
});
router.post("/desktop/open", async (req, res) => {
    try {
        if (!req.is('application/json')) return res.status(415).json({ success: false, error: 'กรุณาเปิด K-sis จากเมนูในโปรแกรม' });
        const requestOrigin = req.get('origin');
        if (requestOrigin) {
            const allowedOrigins = ['localhost', '127.0.0.1', '[::1]'].map((host) => new URL(`http://${host}:${req.socket.localPort}`).origin);
            if (!allowedOrigins.includes(requestOrigin)) return res.status(403).json({ success: false, error: 'ไม่อนุญาตให้เว็บอื่นเปิด K-sis ในเครื่องนี้' });
        }
        const result = await openKsisDesktop({ userId: req.session.user.userId, origin: `http://localhost:${req.socket.localPort}`, cookieHeader: req.headers.cookie });
        res.json({ success: true, ...result });
    } catch (error) { sendError(res, error); }
});
router.get("/desktop/status", (req, res) => res.json({ success: true, ...ksisDesktopStatus(req.session.user.userId) }));
router.post("/desktop/report-b", async (req, res) => {
    try {
        if (!ksisDesktopStatus(req.session.user.userId).embedded) return res.status(409).json({ success: false, error: "กรุณาเปิด K-sis ในแอปก่อน" });
        await withKsisPage({ sourceUrl: 'https://kao.ksis.kumon.com/kth/#/reportbeditgrid', userId: req.session.user.userId }, async () => {});
        res.json({ success: true });
    } catch (error) { sendError(res, error); }
});
router.post('/at/:action', async (req, res) => {
    try {
        const userId = req.session.user.userId;
        let result;
        const run = (execute) => runKsisWorkspace(userId, 'at', req.params.action, req.body || {}, execute);
        if (req.params.action === 'open') {
            await withKsisPage({ sourceUrl: KSIS_AT_URL, userId }, async () => {});
            result = { opened: true };
        } else if (req.params.action === 'preview') result = await run(() => previewKsisAt({ userId, month: req.body?.month, year: req.body?.year, subject: req.body?.subject }));
        else if (req.params.action === 'fill') result = await run(() => applyKsisAt({ userId, previewId: req.body?.previewId, confirmedIdentityMatches: req.body?.confirmedIdentityMatches, confirmSave: req.body?.confirmSave === true }));
        else if (req.params.action === 'acknowledge') result = await run(() => acknowledgeKsisAt({ userId }));
        else if (req.params.action === 'inspect') result = await run(() => inspectKsisAt({ userId, month: req.body?.month, year: req.body?.year, subject: req.body?.subject, kumonId: req.body?.kumonId }));
        else return res.status(404).json({ success: false, error: 'ไม่พบคำสั่ง AT' });
        res.json({ success: true, ...result });
    } catch (error) { sendError(res, error); }
});
router.post("/draft/:action", handleKsisDraft);
router.post("/ws-audit", async (req, res) => {
    try {
        const result = await runKsisWorkspace(req.session.user.userId, 'audit', 'read', req.body || {}, () => auditKsisWs({ userId: req.session.user.userId, month: req.body?.month, year: req.body?.year, subject: req.body?.subject, scope: req.body?.scope }));
        res.json({ success: true, ...result });
    } catch (error) { sendError(res, error); }
});

router.post('/at-audit', async (req, res) => {
    try {
        const result = await runKsisWorkspace(req.session.user.userId, 'atAudit', 'read', req.body || {}, () => auditKsisAt({ userId: req.session.user.userId,
            month: req.body?.month, year: req.body?.year, subject: req.body?.subject, scope: req.body?.scope }));
        res.json({ success: true, ...result });
    } catch (error) { sendError(res, error); }
});

export default router;
