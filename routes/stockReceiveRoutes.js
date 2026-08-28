import express from "express";
import {
    createDeliveryOrder,
    deleteDeliveryOrder,
    deleteDeliveryOrderItem,
    getDeliveryOrderDetail,
    getStockReceiveMasters,
    processDeliveryOrder,
    searchDeliveryOrders,
    updateDeliveryOrderItemQuantity
} from "../services/stockReceiveService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected stock receive error"
    });
}

router.get("/masters", async (req, res) => {
    try {
        res.json({
            success: true,
            masters: await getStockReceiveMasters()
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/dos", async (req, res) => {
    try {
        res.json({
            success: true,
            rows: await searchDeliveryOrders({
                type: req.query.type,
                status: req.query.status,
                query: req.query.query,
                limit: req.query.limit
            })
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/dos/:doId", async (req, res) => {
    try {
        res.json({
            success: true,
            deliveryOrder: await getDeliveryOrderDetail(req.params.doId)
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/dos", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await createDeliveryOrder(req.body?.type, req.body))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/dos/:doId/process", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await processDeliveryOrder(req.params.doId))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/dos/:doId", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await deleteDeliveryOrder(req.params.doId))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/dos/:doId/items/:receiveId", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await deleteDeliveryOrderItem(req.params.doId, req.params.receiveId))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.patch("/dos/:doId/items/:receiveId", async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await updateDeliveryOrderItemQuantity(req.params.doId, req.params.receiveId, req.body?.quantity))
        });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
