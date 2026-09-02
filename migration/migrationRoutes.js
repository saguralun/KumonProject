import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import pool from "../config/db.js";
import { importStudent, previewStudent } from "./migrationStudent.js";
import { importEnrollment, previewEnrollment } from "./migrationEnrollment.js";
import { importEnrollmentStatus, previewEnrollmentStatus } from "./migrationEnrollmentStatus.js";
import { importBilling, previewBilling } from "./migrationBilling.js";
import { importWorksheet, previewWorksheet } from "./migrationWorksheet.js";
import { importWorksheetReceive, previewWorksheetReceive } from "./migrationWorksheetReceive.js";
import { importAt, importCd, importDt, previewAt, previewCd, previewDt } from "./migrationActivity.js";
import { importStock, previewStock } from "./migrationStock.js";
import { buildPagination } from "./migrationPreviewCommon.js";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const databaseDir = path.join(__dirname, "..", "database");

// Order matters — 002 seeds data into tables 001 creates, 003 creates
// transaction tables (and its own default admin/123456 login) that
// reference 001's master tables. Each file DROPs its own tables with
// CASCADE before recreating them, so running these three in order is a
// full schema wipe + rebuild, not an incremental migration.
const DATABASE_SETUP_FILES = [
    "001_create_master_tables.sql",
    "002_insert_master_data.sql",
    "003_create_transaction_tables.sql"
];

router.post("/database/setup", async (req, res) => {
    const steps = [];
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        for (const fileName of DATABASE_SETUP_FILES) {
            try {
                const filePath = path.join(databaseDir, fileName);
                const sql = fs.readFileSync(filePath, "utf8");

                await client.query(sql);
                steps.push({ file: fileName, status: "OK" });
            } catch (stepError) {
                steps.push({ file: fileName, status: "ERROR", message: stepError.message });
                throw stepError;
            }
        }

        await client.query("COMMIT");

        res.json({
            status: "OK",
            message: "Database schema recreated. Default login: admin / 123456 — change it on the Users page after logging in. Restart the app server so its connection pool picks up the new schema.",
            steps
        });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});

        console.error("Database Setup Error:");
        console.error(error);

        res.status(500).json({
            status: "ERROR",
            message: error.message,
            steps
        });
    } finally {
        client.release();
    }
});

// One-off cleanup: old data entry used to append " <realname> A" (or
// similar) onto a student's nickname to keep nicknames unique — e.g.
// "ซัน อัครวิทย์ A". Now that uniqueness isn't enforced that way, this
// strips everything after the first space, keeping just the real
// nickname. TEMPORARY — this button/route exists so every center running
// this same codebase can run it once on their own database; remove it
// once every center has (tracked outside this file, not automated).
router.post("/students/clean-nicknames", async (req, res) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(`
            UPDATE kumon.student
            SET nickname = split_part(nickname, ' ', 1)
            WHERE nickname LIKE '% %'
            RETURNING student_id, nickname
        `);

        await client.query("COMMIT");

        res.json({
            status: "OK",
            message: `แก้ไขชื่อเล่นแล้ว ${result.rowCount.toLocaleString("th-TH")} คน`,
            updatedCount: result.rowCount,
            sample: result.rows.slice(0, 20)
        });
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});

        console.error("Clean Nicknames Error:");
        console.error(error);

        res.status(500).json({ status: "ERROR", message: error.message });
    } finally {
        client.release();
    }
});

const migrationModules = [
    {
        id: "student",
        title: "Student",
        preview: previewStudent,
        import: importStudent
    },
    {
        id: "enrollment",
        title: "Enrollment",
        preview: previewEnrollment,
        import: importEnrollment
    },
    {
        id: "history",
        title: "History",
        preview: previewEnrollmentStatus,
        import: importEnrollmentStatus
    },
    {
        id: "billing",
        title: "Billing",
        preview: previewBilling,
        import: importBilling
    },
    {
        id: "at",
        title: "AT",
        preview: previewAt,
        import: importAt
    },
    {
        id: "dt",
        title: "DT",
        preview: previewDt,
        import: importDt
    },
    {
        id: "ws",
        title: "WS",
        preview: previewWorksheet,
        import: importWorksheet
    },
    {
        id: "worksheet-receive",
        title: "Worksheet Receive",
        preview: previewWorksheetReceive,
        import: importWorksheetReceive
    },
    {
        id: "cd",
        title: "CD",
        preview: previewCd,
        import: importCd
    },
    {
        id: "stock",
        title: "Stock",
        preview: previewStock,
        import: importStock
    }
];

const moduleById = new Map(
    migrationModules.map((moduleConfig) => [
        moduleConfig.id,
        moduleConfig
    ])
);

function buildPlaceholderPreview(moduleConfig) {
    return {
        module: moduleConfig.id,
        title: moduleConfig.title,
        status: "NOT STARTED",
        summary: [
            { label: "Records", value: null },
            { label: "New", value: null },
            { label: "Skipped", value: null },
            { label: "Errors", value: null },
            { label: "Warnings", value: null }
        ],
        validation: [
            {
                label: "Preview Adapter",
                status: "NOT STARTED",
                errors: null,
                message: "Module placeholder ready for future migration logic."
            }
        ],
        columns: [],
        rows: [],
        pagination: buildPagination([])
    };
}

router.get("/modules", (req, res) => {
    res.json({
        modules: migrationModules.map((moduleConfig) => ({
            id: moduleConfig.id,
            title: moduleConfig.title,
            status: moduleConfig.preview ? "PREVIEW READY" : "NOT STARTED"
        }))
    });
});

router.post("/:module/preview", async (req, res) => {
    const moduleId = String(req.params.module || "").toLowerCase();
    const moduleConfig = moduleById.get(moduleId);

    if (!moduleConfig) {
        res.status(404).json({
            status: "ERROR",
            message: `Unknown migration module: ${moduleId}`
        });

        return;
    }

    try {
        const result = moduleConfig.preview
            ? await moduleConfig.preview({
                page: req.query.page ?? req.body?.page,
                pageSize: req.query.pageSize ?? req.body?.pageSize
            })
            : buildPlaceholderPreview(moduleConfig);

        res.json(result);
    } catch (error) {
        console.error(`${moduleConfig.title} Preview Error:`);
        console.error(error);

        res.status(500).json({
            module: moduleConfig.id,
            title: moduleConfig.title,
            status: "ERROR",
            message: error.message
        });
    }
});

router.post("/:module/import", async (req, res) => {
    const moduleId = String(req.params.module || "").toLowerCase();
    const moduleConfig = moduleById.get(moduleId);

    if (!moduleConfig) {
        res.status(404).json({
            status: "ERROR",
            message: `Unknown migration module: ${moduleId}`
        });

        return;
    }

    if (!moduleConfig.import) {
        res.status(405).json({
            module: moduleConfig.id,
            title: moduleConfig.title,
            status: "ERROR",
            message: `${moduleConfig.title} import is not enabled.`
        });

        return;
    }

    try {
        const result = await moduleConfig.import();

        res.json(result);
    } catch (error) {
        console.error(`${moduleConfig.title} Import Error:`);
        console.error(error);

        res.status(500).json({
            module: moduleConfig.id,
            title: moduleConfig.title,
            status: "ERROR",
            message: error.message
        });
    }
});

export default router;
