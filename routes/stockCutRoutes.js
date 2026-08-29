import express from "express";
import {
    getPendingDateDetail,
    processPendingDates,
    searchPendingDates
} from "../services/stockCutService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected stock cut error"
    });
}

router.get("/pending-dates", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await searchPendingDates(req.query.type))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/pending-dates/:date", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getPendingDateDetail(req.query.type, req.params.date))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/process", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await processPendingDates(req.body?.type, req.body?.dates))
        });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
