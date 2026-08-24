// Session shape once logged in: req.session.user = { role: "admin"|"staff"|"guest", ... }
//
// Role scope:
//   admin  - everything, including Table Explorer and migration tools.
//   staff  - everything an admin can do EXCEPT Table Explorer and migration
//            tools (student/enrollment CRUD, worksheet, payment are all fine).
//   guest  - daily work only (worksheet, AT/Zun, CD, receipts). No master
//            data edits, no payment page, no Table Explorer, no migration.

export function requireAuth(req, res, next) {
    if (req.session?.user) {
        return next();
    }

    res.status(401).json({
        success: false,
        error: "กรุณาเข้าสู่ระบบ"
    });
}

// Guest sessions are read/daily-work only. Any route that changes master
// data (student/enrollment records) or handles payment must use this
// instead of requireAuth.
export function requireStaff(req, res, next) {
    const role = req.session?.user?.role;

    if (role === "admin" || role === "staff") {
        return next();
    }

    if (req.session?.user) {
        return res.status(403).json({
            success: false,
            error: "เฉพาะ Admin/Staff เท่านั้นที่ทำรายการนี้ได้"
        });
    }

    res.status(401).json({
        success: false,
        error: "กรุณาเข้าสู่ระบบ"
    });
}

// Table Explorer + migration tools only — staff is deliberately excluded.
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

// Gate for the HTML pages themselves (not just the API): redirect an
// unauthenticated visitor to the login page instead of serving the shell.
export function requirePage(req, res, next) {
    if (req.session?.user) {
        return next();
    }

    res.redirect("/login.html");
}

export function requireStaffPage(req, res, next) {
    const role = req.session?.user?.role;

    if (role === "admin" || role === "staff") {
        return next();
    }

    if (req.session?.user) {
        return res.status(403).send("เฉพาะ Admin/Staff เท่านั้นที่เข้าหน้านี้ได้");
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
