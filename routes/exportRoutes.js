import express from "express";
import { buildPivotWorkbook } from "../services/excelExportService.js";

const router = express.Router();

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

        const workbook = await buildPivotWorkbook(sheets);
        const safeFilename = String(filename || "export")
            .replace(/[^a-zA-Z0-9-_ ก-๙]/g, "_")
            .slice(0, 80) || "export";

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}.xlsx"`);

        await workbook.xlsx.write(res);
        res.end();
    } catch (error) {
        console.error("Excel export error:");
        console.error(error);

        if (!res.headersSent) {
            res.status(500).json({ success: false, error: error.message || "Export failed" });
        } else {
            res.end();
        }
    }
});

export default router;
