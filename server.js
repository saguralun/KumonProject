import "dotenv/config";
import express from "express";
import os from "os";
import path from "path";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pool from "./config/db.js";
import tableRoutes from "./routes/tableRoutes.js";
import worksheetRoutes from "./routes/worksheetRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import stockReceiveRoutes from "./routes/stockReceiveRoutes.js";
import stockCutRoutes from "./routes/stockCutRoutes.js";
import stockSummaryRoutes from "./routes/stockSummaryRoutes.js";
import exportRoutes from "./routes/exportRoutes.js";
import progressChartRoutes from "./routes/progressChartRoutes.js";
import reportRoutes from "./routes/reportRoutes.js";
import forecastRoutes from "./routes/forecastRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import roleRoutes from "./routes/roleRoutes.js";
import migrationRoutes from "./migration/migrationRoutes.js";
import systemRoutes from "./routes/systemRoutes.js";
import backupRoutes from "./routes/backupRoutes.js";
import { checkAndApplySchoolYearUpgrade } from "./services/schoolYearUpgradeService.js";
import {
  requireAuth,
  requireAdmin,
  requirePage,
  requireAdminPage,
  requirePermission,
  requirePermissionPage
} from "./middleware/auth.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PgSession = connectPgSimple(session);
const PUBLIC_DIR = path.join(process.cwd(), "public");

// Default 100kb is too small for a 5-sheet Forecast/Order/Expect Stock
// export payload (every level x packet in the pivot, sent as JSON).
app.use(express.json({ limit: "5mb" }));

app.use(session({
  store: new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: false
  }),
  name: "kumondb.sid",
  secret: process.env.SESSION_SECRET || "kumondb-dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    maxAge: 12 * 60 * 60 * 1000 // 12 hours
  }
}));

// Public: login/logout/session-check. Must stay unauthenticated.
app.use("/api/auth", authRoutes);

// Public: lets the login page show "other computers on this network use
// this address" — no auth (nothing sensitive, just this machine's own LAN
// IPs), and it has to work before anyone is logged in anyway.
app.get("/api/server-info", (req, res) => {
  const lanAddresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((entry) => entry && entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);

  res.json({
    success: true,
    port: PORT,
    lanAddresses
  });
});

// Public: lets the login page show "a newer version is on GitHub" and
// offer a one-click update, before anyone has logged in — this repo is
// public, so the check itself needs no credentials either way.
app.use("/api/system", systemRoutes);

// Page shells. Registered before express.static so unauthenticated
// visitors get redirected instead of receiving the (empty, since the
// API calls will 401) page. login.html itself is intentionally left
// ungated and falls through to express.static below.
app.get(["/", "/index.html"], requirePermissionPage("page:tables"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/worksheet.html", requirePage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "worksheet.html"));
});

app.get("/student-manager.html", requirePage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "student-manager.html"));
});

app.get("/payment.html", requirePermissionPage("page:payment"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "payment.html"));
});

// Hardcoded admin-only, deliberately NOT part of the configurable
// permission matrix — this is the page that GRANTS permissions, so it can
// never itself be granted (that would let a role hand itself more access).
app.get("/users.html", requireAdminPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "users.html"));
});

app.get("/opening-schedule.html", requirePermissionPage("page:opening-schedule"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "opening-schedule.html"));
});

app.get("/stock-receive.html", requirePermissionPage("page:stock-receive"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "stock-receive.html"));
});

app.get("/stock.html", requirePermissionPage("page:stock"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "stock.html"));
});

app.get("/progress-chart.html", requirePermissionPage("page:progress-chart"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "progress-chart.html"));
});

app.get("/stock-cut.html", requirePermissionPage("page:stock-cut"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "stock-cut.html"));
});

app.get("/forecast.html", requirePermissionPage("page:forecast"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "forecast.html"));
});

app.get("/report.html", requirePermissionPage("page:report"), (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "report.html"));
});

// The Migration Center page lives under migration/ (alongside its import
// scripts), not public/. Give it a clean, page-guarded URL like the others;
// the static mount below still serves it at /migration/migrationCenter.html.
app.get("/migration.html", requireAdminPage, (req, res) => {
  res.sendFile(path.join(process.cwd(), "migration", "migrationCenter.html"));
});

// Hardcoded admin-only, same reasoning as users.html above: this page can
// export the whole database AND restore (overwrite) it from an uploaded
// file, so it can never be part of the configurable permission matrix.
app.get("/backup.html", requireAdminPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "backup.html"));
});

// Specific /api/* mounts must come before the generic "/api" one below —
// Express tries middleware in registration order, and a broader prefix
// registered first would swallow requests meant for these.
app.use("/api/worksheet", requireAuth, worksheetRoutes);
app.use("/api/students", requireAuth, studentRoutes);
app.use("/api/payment", requirePermission("page:payment"), paymentRoutes);
app.use("/api/stock-receive", requirePermission("page:stock-receive"), stockReceiveRoutes);
app.use("/api/stock-cut", requirePermission("page:stock-cut"), stockCutRoutes);
app.use("/api/stock-summary", requirePermission("page:stock"), stockSummaryRoutes);
app.use("/api/export", requirePermission("page:forecast"), exportRoutes);
app.use("/api/progress-chart", requirePermission("page:progress-chart"), progressChartRoutes);
app.use("/api/forecast", requirePermission("page:forecast"), forecastRoutes);
app.use("/api/report", requirePermission("page:report"), reportRoutes);
app.use("/api/users", requireAdmin, userRoutes);
app.use("/api/roles", requireAdmin, roleRoutes);
app.use("/api/migration", requireAdmin, migrationRoutes);
app.use("/api/backup", requireAdmin, backupRoutes);
app.use("/api", requirePermission("page:tables"), tableRoutes);

app.use(express.static(PUBLIC_DIR));
app.use("/migration", requireAdmin, express.static("migration"));

app.listen(PORT, HOST, () => {
  console.log(`KumonDB running at http://localhost:${PORT}`);
  console.log(`LAN access enabled on http://${HOST}:${PORT}`);
});

// School-year rollover: a no-op every single time except the one moment
// per year the billing-period rule (day > 20 counts as next month) first
// reports May of (school_year + 1) — see schoolYearUpgradeService.js.
// Checked at startup (covers the common case: the app gets restarted
// regularly) and again every hour after that, so it still fires on time
// even if the server process happens to stay up across the actual date
// the year turns over.
function runSchoolYearUpgradeCheck() {
  checkAndApplySchoolYearUpgrade()
    .then((result) => {
      if (result.applied) {
        console.log(
          `[school-year] Upgraded ${result.studentsUpgraded} students: ` +
          `school_year ${result.previousSchoolYear} -> ${result.newSchoolYear}`
        );
      }
    })
    .catch((error) => {
      console.error("[school-year] Upgrade check failed:", error);
    });
}

runSchoolYearUpgradeCheck();
setInterval(runSchoolYearUpgradeCheck, 60 * 60 * 1000);
