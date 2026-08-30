import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/db.js";
import { buildPagination, statusFromIssueCounts } from "./migrationPreviewCommon.js";
import {
    emptyImportResult,
    hasBlockingPreviewError,
    readSourceRecords,
    summaryValue
} from "./migrationImportCommon.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const csvPath = path.join(__dirname, "tblKumonStock.txt");

// tblKumonStock.txt has no header row (Access "Export - Text File" export) —
// this is the column order from the original tblKumonStock.csv header.
const SOURCE_COLUMNS = [
    "ID",
    "Subject",
    "Type",
    "Level",
    "LevelWS",
    "QtyTotal",
    "Status",
    "DateUpdate"
];

// AT/DT still aren't wired up: AT keys off level_master directly like CD does
// (so it's a small extension of the CD path below), but DT keys off a
// free-text test_level with no level_master involved at all and needs its
// own lookup shape before it can be added here.
const SUPPORTED_STOCK_TYPE_CODES = ["WS", "CD"];
const ISSUE_SAMPLE_COUNT = 5;

function clean(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value)
        .replace(/﻿/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

function nullable(value) {
    const text = clean(value);

    return text || null;
}

function lookupKey(value) {
    return clean(value).toLowerCase();
}

function masterKey(...parts) {
    return parts.map((part) => lookupKey(part)).join("|");
}

// QtyTotal is meant to be the current stock count, but a handful of source
// rows (so far only seen on CD) have negative values from the legacy
// system's own deficit tracking. Per the decision made when adding CD
// support: clamp negative quantities to 0 instead of importing them as-is
// or treating them as a parse error, and surface that a value was clamped
// so it stays auditable in the preview rather than silently rewritten.
function parseQuantityClamped(value, label) {
    const text = clean(value);

    if (!text) {
        return { value: null, error: `${label} is required.`, wasClamped: false };
    }

    if (!/^-?\d+$/.test(text)) {
        return { value: null, error: `${label} must be an integer: ${text}`, wasClamped: false };
    }

    const numberValue = Number(text);

    if (!Number.isSafeInteger(numberValue)) {
        return { value: null, error: `${label} must be an integer: ${text}`, wasClamped: false };
    }

    return {
        value: Math.max(0, numberValue),
        error: null,
        wasClamped: numberValue < 0
    };
}

function parsePositiveInteger(value, label) {
    const text = clean(value);

    if (!text) {
        return { value: null, error: `${label} is required.` };
    }

    if (!/^\d+$/.test(text)) {
        return { value: null, error: `${label} must be a positive integer: ${text}` };
    }

    const numberValue = Number(text);

    if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
        return { value: null, error: `${label} must be a positive integer: ${text}` };
    }

    return { value: numberValue, error: null };
}

function addIssue(issueMap, value, row, message) {
    const issueValue = clean(value) || "(blank)";
    let issue = issueMap.get(issueValue);

    if (!issue) {
        issue = { value: issueValue, count: 0, examples: [] };
        issueMap.set(issueValue, issue);
    }

    issue.count++;

    if (issue.examples.length < ISSUE_SAMPLE_COUNT) {
        issue.examples.push({
            csv_row: row.csv_row,
            source_id: nullable(row.source_id),
            subject: nullable(row.subject_code),
            level: nullable(row.source_level),
            message
        });
    }
}

function issueList(issueMap) {
    return [...issueMap.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function issueCount(issueMap) {
    return [...issueMap.values()].reduce((sum, issue) => sum + issue.count, 0);
}

function addError(row, issues, category, value, message) {
    row.errors.push(message);
    addIssue(issues[category], value, row, message);
}

function addInfo(row, info, category, value, message) {
    row.info.push(message);
    addIssue(info[category], value, row, message);
}

function validationItem(label, errorCount, skipped = 0) {
    return {
        label,
        status: errorCount > 0 ? "ERROR" : "READY",
        errors: errorCount,
        skipped
    };
}

function emptyIssueMaps() {
    return {
        errors: {
            number: new Map()
        },
        info: {
            typeNotSupported: new Map(),
            missingMaster: new Map(),
            unchanged: new Map(),
            duplicate: new Map(),
            quantityClamped: new Map()
        }
    };
}

async function loadMasters(db = pool) {
    const [subjectResult, levelResult, worksheetResult, cdMasterResult, stockTypeResult] = await Promise.all([
        db.query(`SELECT subject_id, subject_code FROM subject_master ORDER BY subject_id`),
        db.query(`SELECT level_master_id, subject_id, level_code FROM level_master ORDER BY subject_id, level_code`),
        db.query(`SELECT worksheet_master_id, level_master_id, worksheet_no FROM worksheet_master`),
        db.query(`SELECT cd_master_id, level_master_id, cd_no FROM cd_master`),
        db.query(`SELECT stock_type_id, stock_type_code FROM stock_type_master`)
    ]);

    const stockTypeIdByCode = new Map(
        stockTypeResult.rows.map((row) => [lookupKey(row.stock_type_code), row.stock_type_id])
    );

    for (const code of SUPPORTED_STOCK_TYPE_CODES) {
        if (!stockTypeIdByCode.has(lookupKey(code))) {
            throw new Error(`stock_type_master has no '${code}' row.`);
        }
    }

    const existingStockResult = await db.query(
        `SELECT stock_type_id, master_id, quantity FROM stock WHERE stock_type_id = ANY($1::smallint[])`,
        [[...stockTypeIdByCode.values()]]
    );

    return {
        stockTypeIdByCode,
        subjectsByCode: new Map(
            subjectResult.rows.map((subject) => [lookupKey(subject.subject_code), subject])
        ),
        levelsBySubjectAndCode: new Map(
            levelResult.rows.map((level) => [masterKey(level.subject_id, level.level_code), level])
        ),
        worksheetsByLevelNo: new Map(
            worksheetResult.rows.map((worksheet) => [
                masterKey(worksheet.level_master_id, worksheet.worksheet_no),
                worksheet
            ])
        ),
        cdMasterByLevelNo: new Map(
            cdMasterResult.rows.map((cdMaster) => [
                masterKey(cdMaster.level_master_id, cdMaster.cd_no),
                cdMaster
            ])
        ),
        currentQuantityByKey: new Map(
            existingStockResult.rows.map((row) => [
                masterKey(row.stock_type_id, row.master_id),
                Number(row.quantity)
            ])
        ),
        worksheetMasterCount: worksheetResult.rows.length,
        cdMasterCount: cdMasterResult.rows.length
    };
}

// Per-type master lookup. WS resolves through worksheet_master (LevelWS is
// the worksheet packet number); CD resolves through cd_master (LevelWS is
// cd_no directly). Same shape either way: given the level and the LevelWS
// value, return { masterId } or null.
const TYPE_HANDLERS = {
    ws: {
        label: "Worksheet Master",
        resolveMaster(level, unitNo, masters) {
            return masters.worksheetsByLevelNo.get(masterKey(level.level_master_id, unitNo))?.worksheet_master_id || null;
        }
    },
    cd: {
        label: "CD Master",
        resolveMaster(level, unitNo, masters) {
            return masters.cdMasterByLevelNo.get(masterKey(level.level_master_id, unitNo))?.cd_master_id || null;
        }
    }
};

function buildStockRow(record, csvRow, masters, issues, info) {
    const row = {
        csv_row: csvRow,
        preview_status: "READY",
        import_action: "UPDATE",
        source_id: nullable(record.ID),
        source_type: nullable(record.Type),
        source_level: nullable(record.Level),
        source_level_ws: nullable(record.LevelWS),
        subject_code: null,
        level_master_id: null,
        level_code: null,
        unit_no: null,
        stock_type_code: null,
        master_id: null,
        current_quantity: null,
        new_quantity: null,
        quantity_delta: null,
        duplicate_key: null,
        duplicate_count: 0,
        errors: [],
        info: []
    };

    const typeKey = lookupKey(record.Type);
    const handler = TYPE_HANDLERS[typeKey];

    if (!handler) {
        addInfo(
            row,
            info,
            "typeNotSupported",
            record.Type,
            `Stock type '${clean(record.Type)}' is not implemented yet; row skipped.`
        );
        row.import_action = "SKIP";

        return row;
    }

    row.stock_type_code = clean(record.Type).toUpperCase();

    const qty = parseQuantityClamped(record.QtyTotal, "QtyTotal");

    row.new_quantity = qty.value;

    if (qty.error) {
        addError(row, issues, "number", record.QtyTotal, qty.error);
    } else if (qty.wasClamped) {
        addInfo(
            row,
            info,
            "quantityClamped",
            record.QtyTotal,
            `Negative QtyTotal (${clean(record.QtyTotal)}) clamped to 0.`
        );
    }

    const subject = masters.subjectsByCode.get(lookupKey(record.Subject));

    row.subject_code = subject?.subject_code || null;

    if (!subject) {
        addInfo(
            row,
            info,
            "missingMaster",
            record.Subject,
            "No matching subject_master.subject_code; row skipped."
        );
        row.import_action = "SKIP";

        return row;
    }

    const level = masters.levelsBySubjectAndCode.get(masterKey(subject.subject_id, clean(record.Level).toUpperCase()));

    if (!level) {
        addInfo(
            row,
            info,
            "missingMaster",
            `${subject.subject_code} / ${clean(record.Level)}`,
            "No matching level_master row; row skipped."
        );
        row.import_action = "SKIP";

        return row;
    }

    row.level_master_id = level.level_master_id;
    row.level_code = level.level_code;

    const unitNo = parsePositiveInteger(record.LevelWS, "LevelWS");

    row.unit_no = unitNo.value;

    if (unitNo.error) {
        addError(row, issues, "number", record.LevelWS, unitNo.error);

        return row;
    }

    const masterId = handler.resolveMaster(level, unitNo.value, masters);

    if (!masterId) {
        addInfo(
            row,
            info,
            "missingMaster",
            `${subject.subject_code} / ${level.level_code} / ${row.stock_type_code} ${unitNo.value}`,
            `No matching ${handler.label} row; row skipped.`
        );
        row.import_action = "SKIP";

        return row;
    }

    row.master_id = masterId;

    const stockTypeId = masters.stockTypeIdByCode.get(typeKey);

    row.stock_type_id = stockTypeId;
    row.duplicate_key = masterKey(stockTypeId, masterId);

    if (row.errors.length === 0) {
        const currentQuantity = masters.currentQuantityByKey.get(row.duplicate_key) ?? null;

        row.current_quantity = currentQuantity;
        row.quantity_delta = currentQuantity === null ? row.new_quantity : row.new_quantity - currentQuantity;

        if (currentQuantity === row.new_quantity) {
            addInfo(
                row,
                info,
                "unchanged",
                row.duplicate_key,
                "Quantity already matches; row skipped."
            );
            row.import_action = "SKIP";
        }
    }

    return row;
}

function finalizeRows(rows) {
    return rows.map((row) => {
        const previewStatus = row.errors.length > 0 ? "ERROR" : "READY";
        const { errors, info, ...publicRow } = row;

        return {
            ...publicRow,
            preview_status: previewStatus,
            issue_summary: [...errors, ...info].join(" | ") || null
        };
    });
}

async function buildStockPreview() {
    const records = readSourceRecords(csvPath, SOURCE_COLUMNS);

    const masters = await loadMasters();
    const issues = emptyIssueMaps();
    const draftRows = records.map((record, index) =>
        buildStockRow(record, index + 2, masters, issues.errors, issues.info)
    );

    const rowsByKey = new Map();

    for (const row of draftRows) {
        if (row.errors.length > 0 || row.import_action === "SKIP" || !row.duplicate_key) {
            continue;
        }

        if (!rowsByKey.has(row.duplicate_key)) {
            rowsByKey.set(row.duplicate_key, []);
        }

        rowsByKey.get(row.duplicate_key).push(row);
    }

    for (const [duplicateKey, duplicateRows] of rowsByKey.entries()) {
        if (duplicateRows.length <= 1) {
            continue;
        }

        duplicateRows.forEach((row, index) => {
            row.duplicate_count = duplicateRows.length;

            if (index > 0) {
                addInfo(row, issues.info, "duplicate", duplicateKey, "Exact duplicate target row in CSV; duplicate skipped.");
                row.import_action = "SKIP";
            }
        });
    }

    const finalizedRows = finalizeRows(draftRows);
    const errorCounts = { number: issueCount(issues.errors.number) };
    const infoCounts = {
        typeNotSupported: issueCount(issues.info.typeNotSupported),
        missingMaster: issueCount(issues.info.missingMaster),
        unchanged: issueCount(issues.info.unchanged),
        duplicate: issueCount(issues.info.duplicate),
        quantityClamped: issueCount(issues.info.quantityClamped)
    };
    const errorTotal = errorCounts.number;
    const updateRows = finalizedRows.filter((row) => row.import_action === "UPDATE" && row.preview_status !== "ERROR");
    const blockedRows = finalizedRows.filter((row) => row.preview_status === "ERROR").length;
    const skipped = records.length - updateRows.length - blockedRows;
    const rows = updateRows.map((row, index) => ({ row_number: index + 1, ...row }));

    return {
        module: "stock",
        title: "Stock",
        status: statusFromIssueCounts(errorTotal, 0),
        summary: [
            { label: "Records", value: records.length },
            { label: "Updated", value: rows.length },
            { label: "Unchanged", value: infoCounts.unchanged },
            { label: "Skipped", value: skipped },
            { label: "Errors", value: errorTotal },
            { label: "Type Not Supported", value: infoCounts.typeNotSupported },
            { label: "Missing Master", value: infoCounts.missingMaster },
            { label: "Exact Duplicates", value: infoCounts.duplicate },
            { label: "Negative Qty Clamped", value: infoCounts.quantityClamped },
            { label: "Worksheet Master Rows", value: masters.worksheetMasterCount },
            { label: "CD Master Rows", value: masters.cdMasterCount }
        ],
        validation: [
            validationItem("Stock Type Support", 0, infoCounts.typeNotSupported),
            validationItem("Number Fields", errorCounts.number),
            validationItem("Master Lookup", 0, infoCounts.missingMaster),
            validationItem("Already Up To Date", 0, infoCounts.unchanged),
            validationItem("Exact Duplicate", 0, infoCounts.duplicate),
            validationItem("Negative Quantity Clamped", 0, infoCounts.quantityClamped)
        ],
        columns: [
            { key: "row_number", label: "#" },
            { key: "source_id", label: "CSV ID" },
            { key: "stock_type_code", label: "Type" },
            { key: "subject_code", label: "Subject" },
            { key: "level_code", label: "Level" },
            { key: "unit_no", label: "WS No. / CD No." },
            { key: "master_id", label: "Master ID" },
            { key: "current_quantity", label: "Current Qty" },
            { key: "new_quantity", label: "New Qty" },
            { key: "quantity_delta", label: "Delta" },
            { key: "csv_row", label: "CSV Row" },
            { key: "duplicate_count", label: "Duplicate Count" },
            { key: "issue_summary", label: "Issues" }
        ],
        rows,
        pagination: buildPagination(rows),
        csvRecords: records.length,
        outputRows: rows.length,
        blockedRows,
        skippedRows: skipped,
        lookupErrors: errorCounts,
        lookupInfo: infoCounts,
        issueDetails: {
            errors: { number: issueList(issues.errors.number) },
            info: {
                typeNotSupported: issueList(issues.info.typeNotSupported),
                missingMaster: issueList(issues.info.missingMaster),
                unchanged: issueList(issues.info.unchanged),
                duplicate: issueList(issues.info.duplicate),
                quantityClamped: issueList(issues.info.quantityClamped)
            }
        },
        previewRows: rows
    };
}

export async function previewStock() {
    return buildStockPreview();
}

async function upsertStockInBatches(client, rows, chunkSize = 1000) {
    let affected = 0;

    for (let offset = 0; offset < rows.length; offset += chunkSize) {
        const chunk = rows.slice(offset, offset + chunkSize);
        const params = [];
        const valuesSql = chunk.map((row) => {
            params.push(row.stock_type_id, row.master_id, row.new_quantity);
            const base = params.length - 2;

            return `($${base}, $${base + 1}, $${base + 2})`;
        });

        const result = await client.query(
            `
                INSERT INTO stock (stock_type_id, master_id, quantity)
                VALUES ${valuesSql.join(", ")}
                ON CONFLICT (stock_type_id, master_id) DO UPDATE
                    SET quantity = EXCLUDED.quantity,
                        updated_at = CURRENT_TIMESTAMP
            `,
            params
        );

        affected += result.rowCount;
    }

    return affected;
}

export async function importStock() {
    const previewResult = await previewStock();
    const rows = previewResult.rows || [];
    const skipped = summaryValue(previewResult, "Skipped");
    const errors = summaryValue(previewResult, "Errors");

    if (hasBlockingPreviewError(previewResult)) {
        return emptyImportResult({
            module: "stock",
            title: "Stock Import",
            message: "Stock import stopped because preview validation has blocking errors.",
            previewResult,
            errorCount: errors || 1,
            summary: [
                { label: "Updated", value: 0 },
                { label: "Skipped", value: skipped },
                { label: "Errors", value: errors || 1 },
                { label: "Preview Rows", value: rows.length }
            ]
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const updatedCount = await upsertStockInBatches(client, rows);

        await client.query("COMMIT");

        const importRows = rows.slice(0, 1000).map((row, index) => ({
            row_number: index + 1,
            action: "UPSERT",
            stock_type_code: row.stock_type_code,
            master_id: row.master_id,
            subject_code: row.subject_code,
            level_code: row.level_code,
            unit_no: row.unit_no,
            previous_quantity: row.current_quantity,
            new_quantity: row.new_quantity,
            message: "Stock quantity updated."
        }));

        return {
            module: "stock",
            title: "Stock Import",
            status: "READY",
            summary: [
                { label: "Updated", value: updatedCount },
                { label: "Skipped", value: skipped },
                { label: "Errors", value: 0 },
                { label: "Preview Rows", value: rows.length },
                { label: "Type Not Supported", value: summaryValue(previewResult, "Type Not Supported") },
                { label: "Missing Master", value: summaryValue(previewResult, "Missing Master") },
                { label: "Unchanged", value: summaryValue(previewResult, "Unchanged") },
                { label: "Exact Duplicates", value: summaryValue(previewResult, "Exact Duplicates") },
                { label: "Negative Qty Clamped", value: summaryValue(previewResult, "Negative Qty Clamped") }
            ],
            validation: [
                { label: "Preview Validation", status: "READY", errors: 0 },
                { label: "Transaction", status: "READY", errors: 0 }
            ],
            columns: [
                { key: "row_number", label: "#" },
                { key: "action", label: "Action" },
                { key: "stock_type_code", label: "Type" },
                { key: "master_id", label: "Master ID" },
                { key: "subject_code", label: "Subject" },
                { key: "level_code", label: "Level" },
                { key: "unit_no", label: "WS No. / CD No." },
                { key: "previous_quantity", label: "Previous Qty" },
                { key: "new_quantity", label: "New Qty" },
                { key: "message", label: "Message" }
            ],
            rows: importRows,
            pagination: buildPagination(importRows),
            insertedCount: updatedCount,
            skippedCount: skipped,
            errorCount: 0
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
