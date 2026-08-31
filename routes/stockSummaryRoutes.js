import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import { getStockSummary } from "../services/stockSummaryService.js";

const router = express.Router();

const sendError = createSendError("Unexpected stock summary error");

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
