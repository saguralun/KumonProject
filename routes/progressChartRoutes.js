import express from "express";
import { getProgressChartData } from "../services/progressChartService.js";

const router = express.Router();

router.get("/", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getProgressChartData({ subjectCode: req.query.subject }))
        });
    } catch (error) {
        console.error("Progress Chart Error:");
        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message || "Unexpected progress chart error"
        });
    }
});

export default router;
