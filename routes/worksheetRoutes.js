import express from "express";
import {
    WORKSHEET_PATTERNS,
    getEnrollmentContext,
    getHistory,
    saveWorksheetEntries,
    searchEnrollments
} from "../services/worksheetService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected worksheet error"
    });
}

router.get("/patterns", (req, res) => {
    res.json({
        success: true,
        patterns: WORKSHEET_PATTERNS
    });
});

router.get("/search", async (req, res) => {
    try {
        const rows = await searchEnrollments({
            query: req.query.query,
            mode: req.query.mode,
            subject: req.query.subject,
            limit: req.query.limit
        });

        res.json({
            success: true,
            rows
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/enrollments/:enrollmentId/context", async (req, res) => {
    try {
        const context = await getEnrollmentContext(
            req.params.enrollmentId,
            req.query.historyLimit
        );

        res.json({
            success: true,
            ...context
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/enrollments/:enrollmentId/history", async (req, res) => {
    try {
        const history = await getHistory(
            req.params.enrollmentId,
            req.query.limit
        );

        res.json({
            success: true,
            history
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/entries", async (req, res) => {
    try {
        const result = await saveWorksheetEntries(req.body);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
