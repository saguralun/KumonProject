import fs from "fs";
import iconv from "iconv-lite";
import { parse } from "csv-parse/sync";
import { buildPagination } from "./migrationPreviewCommon.js";

// Access "Export - Text File" (used for all current .txt source exports) writes
// the file in the system ANSI codepage, not UTF-8 — on this Thai-locale machine
// that's Windows-874. Decode through iconv-lite before handing the text to
// csv-parse, otherwise every Thai character comes through as U+FFFD.
//
// These exports also have no header row (unlike the old .csv exports, which
// had a header but could get its labels swapped for Access field Captions
// when "with formatting and layout" was ticked). Callers pass the known
// column order explicitly via `columns` instead of relying on a header row.
export function readSourceRecords(csvPath, columns) {
    const buffer = fs.readFileSync(csvPath);
    const csvText = iconv.decode(buffer, "win874");

    return parse(csvText, {
        columns,
        skip_empty_lines: true,
        bom: true,
        relax_quotes: true,
        relax_column_count: true
    });
}

export function hasBlockingPreviewError(previewResult) {
    const status = String(previewResult.status || "").toUpperCase();

    if (status === "ERROR" || status === "FAILED") {
        return true;
    }

    return Array.isArray(previewResult.validation) &&
        previewResult.validation.some((item) =>
            String(item.status || "").toUpperCase() === "ERROR"
        );
}

export function summaryValue(previewResult, label) {
    const item = Array.isArray(previewResult?.summary)
        ? previewResult.summary.find((summaryItem) => summaryItem.label === label)
        : null;

    return Number(item?.value || 0);
}

export function tableRows(previewResult, tableId) {
    const table = Array.isArray(previewResult?.tables)
        ? previewResult.tables.find((item) => item.id === tableId)
        : null;

    return Array.isArray(table?.rows)
        ? table.rows
        : [];
}

export function emptyImportResult({
    module,
    title,
    message,
    previewResult,
    summary,
    errorCount = 1
}) {
    return {
        module,
        title,
        status: "ERROR",
        message,
        summary,
        validation: previewResult?.validation || [
            { label: "Import Request", status: "ERROR", errors: errorCount }
        ],
        columns: [],
        rows: [],
        pagination: buildPagination([]),
        insertedCount: 0,
        skippedCount: summaryValue(previewResult, "Skipped"),
        errorCount
    };
}

function quoteIdentifier(identifier) {
    if (!/^[a-z_][a-z0-9_]*$/i.test(identifier)) {
        throw new Error(`Unsafe SQL identifier: ${identifier}`);
    }

    return `"${identifier}"`;
}

export async function insertRowsInBatches({
    client,
    tableName,
    columns,
    rows,
    values,
    chunkSize = 1000
}) {
    if (rows.length === 0) {
        return 0;
    }

    const tableSql = quoteIdentifier(tableName);
    const columnsSql = columns.map(quoteIdentifier).join(", ");
    let inserted = 0;

    for (let offset = 0; offset < rows.length; offset += chunkSize) {
        const chunk = rows.slice(offset, offset + chunkSize);
        const params = [];
        const valueSql = chunk.map((row) => {
            const rowValues = values(row);
            const placeholders = rowValues.map((value) => {
                params.push(value);
                return `$${params.length}`;
            });

            return `(${placeholders.join(", ")})`;
        });

        const result = await client.query(
            `INSERT INTO ${tableSql} (${columnsSql}) VALUES ${valueSql.join(", ")}`,
            params
        );

        inserted += result.rowCount;
    }

    return inserted;
}

