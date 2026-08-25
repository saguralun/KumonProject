import express from "express";
import {
    WORKSHEET_PATTERNS,
    completeZunLevel,
    deleteWorksheetEntry,
    getEnrollmentContext,
    getHistory,
    getIncompleteWorksheetStudents,
    getWorksheetMonthSummary,
    cancelReceiptPayment,
    previewReceipt,
    receiveCd,
    receiveReceiptPayment,
    saveAtCompletion,
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

router.get("/incomplete-ws", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getIncompleteWorksheetStudents())
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
        const [history, worksheetMonthSummary] = await Promise.all([
            getHistory(
                req.params.enrollmentId,
                req.query.limit
            ),
            getWorksheetMonthSummary({
                enrollmentId: req.params.enrollmentId,
                billingDate: req.query.billingDate,
                billingMonth: req.query.billingMonth,
                billingYear: req.query.billingYear
            })
        ]);

        res.json({
            success: true,
            history,
            worksheetMonthSummary
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/enrollments/:enrollmentId/worksheet-summary", async (req, res) => {
    try {
        const worksheetMonthSummary = await getWorksheetMonthSummary({
            enrollmentId: req.params.enrollmentId,
            billingDate: req.query.billingDate,
            billingMonth: req.query.billingMonth,
            billingYear: req.query.billingYear
        });

        res.json({
            success: true,
            worksheetMonthSummary
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

router.post("/at-completion", async (req, res) => {
    try {
        const result = await saveAtCompletion(req.body);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/zun-completion", async (req, res) => {
    try {
        const result = await completeZunLevel(req.body);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/receipt/preview", async (req, res) => {
    try {
        const result = await previewReceipt(req.body);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/receipt/payment", async (req, res) => {
    try {
        const result = await receiveReceiptPayment(req.body);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/receipt/cancel", async (req, res) => {
    try {
        const result = await cancelReceiptPayment(req.body);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/cd/receive", async (req, res) => {
    try {
        const result = await receiveCd(req.body);

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/entries/:worksheetUsedId", async (req, res) => {
    try {
        const result = await deleteWorksheetEntry({
            worksheetUsedId: req.params.worksheetUsedId,
            enrollmentId: req.body?.enrollmentId
        });

        res.json(result);
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
