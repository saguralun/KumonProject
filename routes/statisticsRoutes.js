import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import { getEnrollmentStatusStatistics } from "../services/statisticsService.js";

const router = express.Router();
const sendError = createSendError("Unexpected statistics error");

router.get("/enrollment-status", async (req, res) => {
    try {
        res.json({ success: true, ...(await getEnrollmentStatusStatistics()) });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
