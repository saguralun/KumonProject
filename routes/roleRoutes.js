import express from "express";
import { createSendError } from "./routeErrorHandler.js";
import {
    createRole,
    deleteRole,
    listAllRolePermissions,
    listPermissionCatalog,
    listRoles,
    renameRole,
    setRolePermissions
} from "../services/roleService.js";

const router = express.Router();

const sendError = createSendError("Unexpected role management error");

// Everything a role/permission admin UI needs in one call: the role list,
// the permission catalog (grouped by nav group), and every current grant —
// small enough that shipping them together beats three round trips.
router.get("/", async (req, res) => {
    try {
        const [roles, permissions, grants] = await Promise.all([
            listRoles(),
            listPermissionCatalog(),
            listAllRolePermissions()
        ]);

        res.json({ success: true, roles, permissions, grants });
    } catch (error) {
        sendError(res, error);
    }
});

router.post("/", async (req, res) => {
    try {
        const role = await createRole({
            roleCode: req.body?.roleCode,
            roleName: req.body?.roleName
        });

        res.json({ success: true, role });
    } catch (error) {
        sendError(res, error);
    }
});

router.put("/:roleCode", async (req, res) => {
    try {
        const role = await renameRole(req.params.roleCode, req.body?.roleName);

        res.json({ success: true, role });
    } catch (error) {
        sendError(res, error);
    }
});

router.delete("/:roleCode", async (req, res) => {
    try {
        await deleteRole(req.params.roleCode);

        res.json({ success: true });
    } catch (error) {
        sendError(res, error);
    }
});

router.put("/:roleCode/permissions", async (req, res) => {
    try {
        const permissions = await setRolePermissions(req.params.roleCode, req.body?.permissionKeys);

        res.json({ success: true, permissions });
    } catch (error) {
        sendError(res, error);
    }
});

export default router;
