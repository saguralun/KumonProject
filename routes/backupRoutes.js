import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import { listBackups, runBackupNow, resolveDownloadPath, importBackup } from "../services/backupService.js";

const router = express.Router();
const sendError = createSendError("Unexpected backup error");

router.get("/list", async (req, res) => {
    try {
        res.json({ success: true, ...(await listBackups()) });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/run", async (req, res) => {
    try {
        res.json({ success: true, backup: await runBackupNow() });
    } catch (error) {
        sendError(res, error);
    }
});

router.get("/download/:filename", async (req, res) => {
    try {
        const filePath = await resolveDownloadPath(req.params.filename);
        res.download(filePath, req.params.filename);
    } catch (error) {
        sendError(res, error);
    }
});

// Raw binary body, not JSON — the uploaded file IS the request body (see
// backup.js: fetch(..., { body: file })). Scoped to this one route rather
// than mounted globally so it doesn't interfere with the rest of the app's
// express.json() parsing. 1GB ceiling is generous headroom over today's
// ~3MB dumps — this is admin-only already, so a large-but-legitimate upload
// shouldn't get refused just to shave that limit down further.
router.post(
    "/import",
    express.raw({ type: "application/octet-stream", limit: "1024mb" }),
    async (req, res) => {
        try {
            res.json({
                success: true,
                ...(await importBackup(req.body, { confirmDbName: req.query.confirmDbName }))
            });
        } catch (error) {
            sendError(res, error);
        }
    }
);

export default router;
