import express from "express";
import {
    cancelReceiptPayment,
    getPaymentStatus,
    previewReceipt,
    receiveReceiptPayment
} from "../services/paymentService.js";
import { getPrinterStatus } from "../services/printerService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected payment error"
    });
}

router.get("/status", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getPaymentStatus({
                billingMonth: req.query.billingMonth,
                billingYear: req.query.billingYear,
                subject: req.query.subject,
                status: req.query.status,
                query: req.query.query,
                limit: req.query.limit
            }))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/printer-status", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await getPrinterStatus())
        });
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

export default router;
