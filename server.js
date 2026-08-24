import "dotenv/config";
import express from "express";
import path from "path";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pool from "./config/db.js";
import tableRoutes from "./routes/tableRoutes.js";
import worksheetRoutes from "./routes/worksheetRoutes.js";
import studentRoutes from "./routes/studentRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import migrationRoutes from "./migration/migrationRoutes.js";
import { requireAuth, requireStaff, requireAdmin, requirePage, requireStaffPage, requireAdminPage } from "./middleware/auth.js";

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const PgSession = connectPgSimple(session);
const PUBLIC_DIR = path.join(process.cwd(), "public");

app.use(express.json());

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

// Page shells. Registered before express.static so unauthenticated
// visitors get redirected instead of receiving the (empty, since the
// API calls will 401) page. login.html itself is intentionally left
// ungated and falls through to express.static below.
app.get(["/", "/index.html"], requireAdminPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/worksheet.html", requirePage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "worksheet.html"));
});

app.get("/student-manager.html", requirePage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "student-manager.html"));
});

app.get("/payment.html", requireStaffPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "payment.html"));
});

app.get("/users.html", requireAdminPage, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "users.html"));
});

// Specific /api/* mounts must come before the generic "/api" one below —
// Express tries middleware in registration order, and a broader prefix
// registered first would swallow requests meant for these.
app.use("/api/worksheet", requireAuth, worksheetRoutes);
app.use("/api/students", requireAuth, studentRoutes);
app.use("/api/payment", requireStaff, paymentRoutes);
app.use("/api/users", requireAdmin, userRoutes);
app.use("/api/migration", requireAdmin, migrationRoutes);
app.use("/api", requireAdmin, tableRoutes);

app.use(express.static(PUBLIC_DIR));
app.use("/migration", requireAdmin, express.static("migration"));

app.listen(PORT, HOST, () => {
  console.log(`KumonDB running at http://localhost:${PORT}`);
  console.log(`LAN access enabled on http://${HOST}:${PORT}`);
});
