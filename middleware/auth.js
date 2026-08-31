// Session shape once logged in: req.session.user = { role: <role_code>, ... }
//
// Role scope:
//   admin      - everything, always, including Table Explorer, Users, and
//                migration tools. Hardcoded — never looked up in
//                role_permission, so granting permissions can never be used
//                to grant more permissions.
//   instructor - the old two-tier model's "staff": everything except the
//                ระบบ (system) group. Renamed when the permission system
//                shipped (see database/004_add_roles_permissions.sql) —
//                still used directly (not through role_permission) for
//                student/enrollment master-data edits, which aren't a nav
//                page and so were never part of the configurable matrix.
//   staff      - new, more restricted role added alongside the permission
//                system: no master-data edits, and only whatever pages an
//                admin has granted it via role_permission (starts with just
//                the คลัง group).
//   <custom>   - any further role an admin adds from the Users page — pages
//                gated by requirePermission()/requirePermissionPage() work
//                for these automatically; nothing else does (they can never
//                edit student master data or reach Users/Migration/Tables
//                unless page:tables is explicitly granted to them).
//   guest      - daily work only (worksheet, AT/Zun, CD, receipts) and can
//                view (not edit) students. Fixed floor, not stored in
//                role_permission, can't be granted more.

import { roleHasPermission } from "../services/roleService.js";

export function requireAuth(req, res, next) {
    if (req.session?.user) {
        return next();
    }

    res.status(401).json({
        success: false,
        error: "กรุณาเข้าสู่ระบบ"
    });
}

// The broad "admin or instructor" tier — used specifically for
// student/enrollment master-data edits (guest can view students but not
// change them; every other role below instructor can't either). This is
// NOT the same thing as the configurable page permissions below.
export function requireStaff(req, res, next) {
    const role = req.session?.user?.role;

    if (role === "admin" || role === "instructor") {
        return next();
    }

    if (req.session?.user) {
        return res.status(403).json({
            success: false,
            error: "เฉพาะ Admin/Instructor เท่านั้นที่ทำรายการนี้ได้"
        });
    }

    res.status(401).json({
        success: false,
        error: "กรุณาเข้าสู่ระบบ"
    });
}

// Table Explorer, Users, and migration tools only — hardcoded, never
// affected by role_permission (see the note in requirePermission below).
export function requireAdmin(req, res, next) {
    if (req.session?.user?.role === "admin") {
        return next();
    }

    if (req.session?.user) {
        return res.status(403).json({
            success: false,
            error: "เฉพาะ Admin เท่านั้นที่ทำรายการนี้ได้"
        });
    }

    res.status(401).json({
        success: false,
        error: "กรุณาเข้าสู่ระบบ"
    });
}

// The configurable gate: admin always passes (hardcoded bypass — admin is
// deliberately never a row an admin can edit permissions for), everyone
// else needs `permissionKey` in their role's role_permission grants. This
// is what Payment/Report/Progress Chart/Stock*/Forecast/Tables/Opening
// Schedule are gated with — see database/004_add_roles_permissions.sql for
// the permission_master catalog and default grants.
export function requirePermission(permissionKey) {
    return async (req, res, next) => {
        const role = req.session?.user?.role;

        if (!role) {
            return res.status(401).json({
                success: false,
                error: "กรุณาเข้าสู่ระบบ"
            });
        }

        if (role === "admin") {
            return next();
        }

        try {
            if (await roleHasPermission(role, permissionKey)) {
                return next();
            }
        } catch (error) {
            console.error(error);
            return res.status(500).json({ success: false, error: "ตรวจสอบสิทธิ์ไม่สำเร็จ" });
        }

        res.status(403).json({
            success: false,
            error: "role นี้ไม่มีสิทธิ์เข้าถึงส่วนนี้"
        });
    };
}

// Gate for the HTML pages themselves (not just the API): redirect an
// unauthenticated visitor to the login page instead of serving the shell.
export function requirePage(req, res, next) {
    if (req.session?.user) {
        return next();
    }

    res.redirect("/login.html");
}

export function requireAdminPage(req, res, next) {
    if (req.session?.user?.role === "admin") {
        return next();
    }

    if (req.session?.user) {
        return res.status(403).send("เฉพาะ Admin เท่านั้นที่เข้าหน้านี้ได้");
    }

    res.redirect("/login.html");
}

// Page-shell equivalent of requirePermission — same admin bypass, same
// role_permission lookup, but redirects/sends an HTML error instead of JSON.
export function requirePermissionPage(permissionKey) {
    return async (req, res, next) => {
        const role = req.session?.user?.role;

        if (!role) {
            return res.redirect("/login.html");
        }

        if (role === "admin") {
            return next();
        }

        try {
            if (await roleHasPermission(role, permissionKey)) {
                return next();
            }
        } catch (error) {
            console.error(error);
            return res.status(500).send("ตรวจสอบสิทธิ์ไม่สำเร็จ");
        }

        res.status(403).send("role นี้ไม่มีสิทธิ์เข้าหน้านี้");
    };
}
