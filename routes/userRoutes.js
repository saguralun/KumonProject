import express from "express";
import {
    listAccounts,
    setAccountActive,
    updateAccountRole,
    upsertAccount
} from "../services/authService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected user management error"
    });
}

router.get("/", async (req, res) => {
    try {
        res.json({
            success: true,
            users: await listAccounts()
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/", async (req, res) => {
    try {
        const user = await upsertAccount({
            username: req.body?.username,
            password: req.body?.password,
            displayName: req.body?.displayName,
            role: req.body?.role
        });

        res.json({ success: true, user });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/:userId/role", async (req, res) => {
    try {
        const user = await updateAccountRole(req.params.userId, req.body?.role);
        res.json({ success: true, user });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/:userId/active", async (req, res) => {
    try {
        const user = await setAccountActive(req.params.userId, req.body?.isActive);
        res.json({ success: true, user });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
