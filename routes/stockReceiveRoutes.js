import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import { getStockReceiveRetryScope } from "../services/stockReceiveRetry.js";
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

const sendError = createSendError("Unexpected stock receive error");

function retryActor(req) {
    return req.session?.user?.userId
        ? `account:${req.session.user.userId}`
        : req.session?.user && req.sessionID ? `session:${req.sessionID}` : null;
}

router.get("/masters", async (req, res) => {
    try {
        res.json({
            success: true,
            masters: await getStockReceiveMasters(),
            retryScope: await getStockReceiveRetryScope(retryActor(req))
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
            ...(await createDeliveryOrder(req.body?.type, req.body, {
                actor: retryActor(req), operationKey: req.body?.operationKey
            }))
        });
    } catch (error) {
        if (error.stockReceiveRetrySafe) {
            res.status(error.statusCode || 500).json({ success: false, error: error.message, retrySafe: true });
        } else {
            sendError(res, error);
        }
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
        if (req.body?.expectedQuantity === undefined) {
            res.status(409).json({ success: false, error: 'หน้ากรอก DO เป็นข้อมูลรุ่นเก่า กรุณาโหลดหน้าใหม่ก่อนแก้จำนวน' });
            return;
        }
        res.json({
            success: true,
            ...(await updateDeliveryOrderItemQuantity(req.params.doId, req.params.receiveId, req.body?.quantity, req.body.expectedQuantity))
        });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
