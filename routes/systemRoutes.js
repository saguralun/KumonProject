import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import { applyUpdate, checkForUpdate } from "../services/updateService.js";
import { requireAdmin } from "../middleware/auth.js";
import {
    createOpeningSchedule,
    deleteOpeningSchedule,
    listOpeningSchedules,
    setOpeningScheduleActive
} from "../services/openingScheduleService.js";

const router = express.Router();

const sendError = createSendError("Unexpected system error");

router.get("/update-check", async (req, res) => {
    // Express adds an ETag by default, which lets a browser reuse a
    // stale cached response instead of hitting this route again — the
    // one check that must never be stale, since a page left open across
    // an update relies on it to eventually notice. No-store forces a
    // real network hit every time.
    res.set("Cache-Control", "no-store");

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

router.get("/opening-schedules", requireAdmin, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await listOpeningSchedules())
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/opening-schedules", requireAdmin, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await createOpeningSchedule(req.body))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/opening-schedules/:scheduleId/active", requireAdmin, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await setOpeningScheduleActive(req.params.scheduleId, req.body?.isActive))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/opening-schedules/:scheduleId", requireAdmin, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await deleteOpeningSchedule(req.params.scheduleId))
        });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
