import express from "express";
import { getStockSummary } from "../services/stockSummaryService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected stock summary error"
    });
}

router.get("/", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getStockSummary())
        });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
