import express from "express";
import { buildFlatWorkbook, buildPivotWorkbook } from "../services/excelExportService.js";

const router = express.Router();

function safeFilename(filename) {
    return String(filename || "export")
        .replace(/[^a-zA-Z0-9-_ ก-๙]/g, "_")
        .slice(0, 80) || "export";
}

async function streamWorkbook(res, workbook, filename) {
    res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(filename)}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
}

function handleExportError(res, error) {
    console.error("Excel export error:");
    console.error(error);

    if (!res.headersSent) {
        res.status(500).json({ success: false, error: error.message || "Export failed" });
    } else {
        res.end();
    }
}

// Generic "pivot data (from the browser) -> multi-sheet .xlsx download"
// endpoint — the browser already computed the exact numbers on screen
// (Forecast / Order / Expect Stock all live client-side), this just formats
// whatever sheets it's handed into a workbook and streams it back.
router.post("/pivot-workbook", async (req, res) => {
    try {
        const { filename, sheets } = req.body || {};

        if (!Array.isArray(sheets) || sheets.length === 0) {
            res.status(400).json({ success: false, error: "sheets is required" });
            return;
        }

        await streamWorkbook(res, await buildPivotWorkbook(sheets), filename);
    } catch (error) {
        handleExportError(res, error);
    }
});

// Same idea, but for a plain flat list rather than a pivot — one sheet,
// a header row, one row per record. Used by the Report page's
// event-summary export.
router.post("/flat-workbook", async (req, res) => {
    try {
        const { filename, sheetName, columns, rows } = req.body || {};

        if (!Array.isArray(columns) || columns.length === 0) {
            res.status(400).json({ success: false, error: "columns is required" });
            return;
        }

        await streamWorkbook(
            res,
            await buildFlatWorkbook({ sheetName, columns, rows }),
            filename
        );
    } catch (error) {
        handleExportError(res, error);
    }
});

export default router;
