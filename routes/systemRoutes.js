import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import { applyUpdate, checkForUpdate, getRuntimeStatus } from "../services/updateService.js";
import { requireAdmin, requirePermission } from "../middleware/auth.js";
import { requireUpdateAccess } from '../middleware/updateAccess.js';
import { mainDesktop } from '../services/appDesktop.js';
import { paymentDatabaseStatus } from '../services/databaseStatusService.js';
import {
    createOpeningSchedule,
    deleteOpeningSchedule,
    listOpeningSchedules,
    setOpeningScheduleActive
} from "../services/openingScheduleService.js";

const router = express.Router();

const sendError = createSendError("Unexpected system error");

router.get("/runtime", (req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ success: true, ...getRuntimeStatus() });
});

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

// The Windows shortcut may focus the login window before a user has signed in.
router.post('/desktop/show', async (req, res) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) || !req.is('application/json')) return res.sendStatus(403);
    const origin = `http://localhost:${req.socket.localPort}`;
    if (req.get('origin') && !['localhost', '127.0.0.1', '[::1]'].some((host) => req.get('origin') === new URL(`http://${host}:${req.socket.localPort}`).origin)) return res.sendStatus(403);
    try { const desktop = await mainDesktop.open({ origin }); await desktop.focus(); res.json({ success: true }); }
    catch (error) { sendError(res, error); }
});

router.post("/update-apply", requireUpdateAccess, async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await applyUpdate())
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.get('/database/status', requireAdmin, async (_req, res) => {
    try { res.set('Cache-Control', 'no-store').json({ success: true, ...(await paymentDatabaseStatus()) }); }
    catch (error) { sendError(res, error); }
});

router.get("/opening-schedules", requirePermission('page:opening-schedule'), async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await listOpeningSchedules())
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/opening-schedules", requirePermission('page:opening-schedule'), async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await createOpeningSchedule(req.body))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/opening-schedules/:scheduleId/active", requirePermission('page:opening-schedule'), async (req, res) => {
    try {
        res.json({
            success: true,
            ...(await setOpeningScheduleActive(req.params.scheduleId, req.body?.isActive))
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/opening-schedules/:scheduleId", requirePermission('page:opening-schedule'), async (req, res) => {
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
