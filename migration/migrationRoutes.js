import express from "express";
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
