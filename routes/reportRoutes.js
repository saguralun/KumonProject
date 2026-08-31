import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import {
    buildMonthlyReport,
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

export default router;
