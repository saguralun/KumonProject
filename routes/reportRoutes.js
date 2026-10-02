import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import {
    buildEventSummaryReport,
    buildMonthlyReport,
    buildLevelSummaryReport,
    EVENT_SUMMARY_COLUMNS,
    REPORT_COLUMNS
} from "../services/reportService.js";

const router = express.Router();

const sendError = createSendError("Unexpected report error");

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
