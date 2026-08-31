import ExcelJS from "exceljs";

// Sheet names in Excel are capped at 31 characters and can't contain
// : \ / ? * [ ]
function safeSheetName(name) {
    return String(name || "Sheet")
        .replace(/[:\\/?*[\]]/g, " ")
        .slice(0, 31)
        .trim() || "Sheet";
}

// Turns { name, columns, rows: [{label, values, total}], columnTotals, grandTotal }
// (the exact shape the forecast/order/expected-stock pivots already use in
// the browser) into one worksheet: header row (Level + columns + รวม), one
// row per level, and a bold totals row at the bottom.
export async function buildPivotWorkbook(sheets) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "KumonDB";
    workbook.created = new Date();

    sheets.forEach((sheetDef) => {
        const sheet = workbook.addWorksheet(safeSheetName(sheetDef.name));
        const columns = Array.isArray(sheetDef.columns) ? sheetDef.columns : [];
        const rows = Array.isArray(sheetDef.rows) ? sheetDef.rows : [];

        sheet.addRow(["Level", ...columns, "รวม"]);
        sheet.getRow(1).font = { bold: true };

        rows.forEach((row) => {
            const values = columns.map((column) => {
                const value = row.values ? row.values[column] : undefined;

                return value === undefined || value === null ? "" : value;
            });

            sheet.addRow([row.label, ...values, row.total ?? ""]);
        });

        const columnTotals = sheetDef.columnTotals || {};
        const totalsRow = sheet.addRow([
            "รวม",
            ...columns.map((column) => columnTotals[column] ?? ""),
            sheetDef.grandTotal ?? ""
        ]);

        totalsRow.font = { bold: true };

        sheet.getColumn(1).width = 14;

        for (let index = 2; index <= columns.length + 2; index += 1) {
            sheet.getColumn(index).width = 9;
        }

        sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 1 }];
    });

    return workbook;
}
