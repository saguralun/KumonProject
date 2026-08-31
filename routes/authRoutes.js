import express from "express";
import { verifyAccountLogin, verifyGuestLogin } from "../services/authService.js";
import { grantedPermissionsFor } from "../services/roleService.js";

const router = express.Router();

function sendError(res, error) {
    const statusCode = error.statusCode || 500;

    if (statusCode >= 500) {
        console.error(error);
    }

    res.status(statusCode).json({
        success: false,
        error: error.message || "Unexpected auth error"
    });
}

router.post("/login/admin", async (req, res) => {
    try {
        const user = await verifyAccountLogin({
            username: req.body?.username,
            password: req.body?.password
        });

        req.session.regenerate((error) => {
            if (error) {
                return sendError(res, error);
            }

            req.session.user = user;
            res.json({ success: true, user });
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/login/guest", (req, res) => {
    try {
        const user = verifyGuestLogin({
            displayName: req.body?.displayName,
            pin: req.body?.pin
        });

        req.session.regenerate((error) => {
            if (error) {
                return sendError(res, error);
            }

            req.session.user = user;
            res.json({ success: true, user });
        });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/logout", (req, res) => {
    req.session.destroy(() => {
        res.clearCookie("kumondb.sid");
        res.json({ success: true });
    });
});

router.get("/me", async (req, res) => {
    const user = req.session?.user || null;

    if (!user) {
        return res.json({ success: true, user: null, permissions: [] });
    }

    // admin bypasses role_permission entirely server-side too (see
    // requirePermission) — the frontend nav just needs to know "show
    // everything" without the backend enumerating every key for it.
    const permissions = user.role === "admin"
        ? ["*"]
        : await grantedPermissionsFor(user.role);

    res.json({ success: true, user, permissions });
});

export default router;
