import express from "express";
import {
    buildMonthlyReport,
    buildWorksheetForecast,
    recalculateWorksheetForecastAverages,
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

router.post("/worksheet-forecast/averages/recalculate", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await recalculateWorksheetForecastAverages())
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/worksheet-forecast", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await buildWorksheetForecast({
                days: req.query.days,
                subject: req.query.subject,
                includeKc: req.query.includeKc,
                force: req.query.force === "true"
            }))
        });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
