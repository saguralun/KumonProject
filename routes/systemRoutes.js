import express from "express";
import { applyUpdate, checkForUpdate } from "../services/updateService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected system error"
    });
}

router.get("/update-check", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await checkForUpdate())
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/update-apply", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await applyUpdate())
        });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
