import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import { requireStaff } from "../middleware/auth.js";
import { previewKsisReportDraft, applyKsisReportDraft, acknowledgeKsisReportDraft } from "../services/ksisReportDraft.js";
import {
    buildEventSummaryReport,
    buildMonthlyReport,
    buildLevelSummaryReport,
    EVENT_SUMMARY_COLUMNS,
    REPORT_COLUMNS
} from "../services/reportService.js";

const router = express.Router();

const sendError = createSendError("Unexpected report error");

router.post("/ksis-draft/:action", requireStaff, async (req, res) => {
    res.set("Cache-Control", "no-store");
    if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return res.status(403).json({ success: false, error: "กรุณาใช้ตัวกรอก KSIS ผ่าน localhost บนเครื่องที่รัน KumonDB" });
    try {
        const userId = req.session.user.userId;
        let result;
        if (req.params.action === "preview") result = await previewKsisReportDraft({ userId, month: req.body?.month, year: req.body?.year, subject: req.body?.subject });
        else if (req.params.action === "fill") result = await applyKsisReportDraft({ userId, previewId: req.body?.previewId });
        else if (req.params.action === "acknowledge") result = await acknowledgeKsisReportDraft({ userId });
        else return res.status(404).json({ success: false, error: "ไม่พบคำสั่ง" });
        res.json({ success: true, ...result });
    } catch (error) { sendError(res, error); }
});

router.get("/monthly", async (req, res) => {
    try {
        const rows = await buildMonthlyReport({
            month: req.query.month,
            year: req.query.year
        });

        res.json({
            success: true,
            columns: REPORT_COLUMNS,
            rows
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/level-summary", async (req, res) => {
    try {
        const subjects = await buildLevelSummaryReport({ month: req.query.month, year: req.query.year });
        res.json({ success: true, subjects });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/event-summary", async (req, res) => {
    try {
        const rows = await buildEventSummaryReport({
            month: req.query.month,
            year: req.query.year
        });

        res.json({
            success: true,
            columns: EVENT_SUMMARY_COLUMNS,
            rows
        });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
