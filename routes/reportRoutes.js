import express from "express";
import {
    buildMonthlyReport,
    REPORT_COLUMNS
} from "../services/reportService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected report error"
    });
}

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
