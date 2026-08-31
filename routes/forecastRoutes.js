import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import {
    buildWorksheetForecast,
    getOrderSuggestion,
    recalculateWorksheetForecastAverages
} from "../services/reportService.js";

const router = express.Router();

const sendError = createSendError("Unexpected forecast error");

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

router.get("/order-suggestion", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getOrderSuggestion({
                leadTimeDays: req.query.leadTimeDays,
                bufferPercent: req.query.bufferPercent
            }))
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
