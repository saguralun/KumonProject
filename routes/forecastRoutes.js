import express from "express";
import {
    buildWorksheetForecast,
    recalculateWorksheetForecastAverages
} from "../services/reportService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected forecast error"
    });
}

router.post("/averages/recalculate", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await recalculateWorksheetForecastAverages())
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/", async (req, res) => {
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
