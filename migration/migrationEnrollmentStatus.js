import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import pool from "../config/db.js";
import {
    buildNewOnlySummary,
    buildPagination,
    statusFromIssueCounts
} from "./migrationPreviewCommon.js";
import {
    emptyImportResult,
    hasBlockingPreviewError,
    insertRowsInBatches,
    summaryValue
} from "./migrationImportCommon.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.join(__dirname, "tblStatusDetail.csv");

const ISSUE_SAMPLE_COUNT = 5;

function clean(value) {
    if (value === undefined || value === null) {
        return "";
    }

    return String(value)
        .replace(/\uFEFF/g, "")
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

function previewKey(...parts) {
    return parts.map((part) => lookupKey(part)).join("|");
}

function parseRequiredInteger(value, label) {
    const text = clean(value);

    if (!text) {
        return {
            value: null,
            error: `${label} is required.`
        };
    }

    if (!/^\d+$/.test(text)) {
        return {
            value: null,
            error: `${label} must be an integer: ${text}`
        };
    }

    return {
        value: Number(text),
        error: null
    };
}

function parseMonth(value) {
    const parsed = parseRequiredInteger(value, "status_month");

    if (parsed.error) {
        return parsed;
    }

    if (parsed.value < 1 || parsed.value > 12) {
        return {
            value: parsed.value,
            error: `status_month must be 1-12: ${parsed.value}`
        };
    }

    return parsed;
}

function parseYear(value) {
    const parsed = parseRequiredInteger(value, "status_year");

    if (parsed.error) {
        return parsed;
    }

    if (parsed.value < 1900 || parsed.value > 2500) {
        return {
            value: parsed.value,
            error: `status_year is outside expected range: ${parsed.value}`
        };
    }

    return parsed;
}

function normalizeStatusName(value) {
    const status = clean(value);

    if (lookupKey(status) === "enroling in other subject") {
        return "Enrolling in Other Subject";
    }

    return status;
}

function addIssue(issueMap, value, row, message) {
    const issueValue = clean(value) || "(blank)";
    let issue = issueMap.get(issueValue);

    if (!issue) {
        issue = {
            value: issueValue,
            count: 0,
            examples: []
        };

        issueMap.set(issueValue, issue);
    }

    issue.count++;

    if (issue.examples.length < ISSUE_SAMPLE_COUNT) {
        issue.examples.push({
            csv_row: row.csv_row,
            source_status_key: nullable(row.source_status_key),
            enrollment_id: nullable(row.enrollment_id),
            month: nullable(row.status_month),
            year: nullable(row.status_year),
            status: nullable(row.source_status_name),
            message
        });
    }
}

function issueList(issueMap) {
    return [...issueMap.values()]
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

function issueCount(issueMap) {
    return [...issueMap.values()]
        .reduce((sum, issue) => sum + issue.count, 0);
}

function addRowError(row, issues, category, value, message) {
    row.errors.push(message);
    addIssue(issues[category], value, row, message);
}

function addRowWarning(row, warnings, category, value, message) {
    row.warnings.push(message);
    addIssue(warnings[category], value, row, message);
}

async function loadMasterData() {
    const [statusResult, enrollmentResult, existingStatusResult] = await Promise.all([
        pool.query(`
            SELECT status_id, status_code, status_name, status_group
            FROM status_master
            ORDER BY status_id
        `),
        pool.query(`
            SELECT enrollment_id
            FROM enrollment
            ORDER BY enrollment_id
        `),
        pool.query(`
            SELECT enrollment_id, status_id, status_month, status_year
            FROM enrollment_status
            ORDER BY enrollment_status_id
        `)
    ]);

    return {
        statusesByName: new Map(
            statusResult.rows.map((status) => [
                lookupKey(status.status_name),
                status
            ])
        ),
        enrollmentIds: new Set(
            enrollmentResult.rows.map((row) => Number(row.enrollment_id))
        ),
        existingStatusKeys: new Set(
            existingStatusResult.rows.map((row) =>
                previewKey(
                    row.enrollment_id,
                    row.status_id,
                    row.status_month,
                    row.status_year
                )
            )
        ),
        enrollmentCount: enrollmentResult.rows.length
    };
}

function targetDuplicateKey(row) {
    return previewKey(
        row.enrollment_id ?? row.source_enrollment_id,
        row.status_id ?? row.normalized_status_name,
        row.status_month ?? row.source_month_status,
        row.status_year ?? row.source_year_status
    );
}

function buildPreviewRow(record, csvRow, masters, issues, warnings) {
    const enrollmentId = parseRequiredInteger(record.ID, "enrollment_id");
    const statusMonth = parseMonth(record.MonthStatus);
    const statusYear = parseYear(record.YearStatus);
    const normalizedStatusName = normalizeStatusName(record.Status);
    const status = masters.statusesByName.get(lookupKey(normalizedStatusName));

    const row = {
        csv_row: csvRow,
        preview_status: "READY",
        enrollment_status_id: null,
        enrollment_id: enrollmentId.value,
        status_id: status?.status_id || null,
        status_name: status?.status_name || null,
        status_group: status?.status_group || null,
        status_month: statusMonth.value,
        status_year: statusYear.value,
        source_status_key: nullable(record.IDStatusKey),
        source_enrollment_id: nullable(record.ID),
        source_status_id: nullable(record.IDStatus),
        source_status_name: nullable(record.Status),
        normalized_status_name: normalizedStatusName || null,
        source_subject_code: nullable(record.Subject),
        source_free_study: nullable(record.FreeStudy),
        source_month_status: nullable(record.MonthStatus),
        source_year_status: nullable(record.YearStatus),
        duplicate_key: null,
        duplicate_count: 0,
        issue_summary: null,
        import_action: "INSERT",
        errors: [],
        warnings: []
    };

    if (enrollmentId.error) {
        addRowWarning(row, warnings, "enrollment", record.ID, enrollmentId.error);
        row.import_action = "SKIP";
    } else if (!masters.enrollmentIds.has(enrollmentId.value)) {
        addRowWarning(
            row,
            warnings,
            "enrollment",
            enrollmentId.value,
            "CSV ID has no matching enrollment.enrollment_id; row skipped."
        );
        row.import_action = "SKIP";
    }

    if (statusMonth.error) {
        addRowError(row, issues, "monthYear", record.MonthStatus, statusMonth.error);
    }

    if (statusYear.error) {
        addRowError(row, issues, "monthYear", record.YearStatus, statusYear.error);
    }

    if (!status) {
        addRowError(
            row,
            issues,
            "status",
            normalizedStatusName,
            "No matching status_master.status_name."
        );
    }

    row.duplicate_key = targetDuplicateKey(row);

    if (
        row.import_action !== "SKIP" &&
        row.errors.length === 0 &&
        masters.existingStatusKeys.has(row.duplicate_key)
    ) {
        addRowWarning(
            row,
            warnings,
            "existing",
            row.duplicate_key,
            "Target enrollment_status already exists; row skipped."
        );
        row.import_action = "SKIP";
    }

    return row;
}

function applyExactDuplicateValidation(rows, warnings) {
    const rowsByDuplicateKey = new Map();

    for (const row of rows) {
        if (row.import_action === "SKIP" || row.errors.length > 0) {
            continue;
        }

        if (!rowsByDuplicateKey.has(row.duplicate_key)) {
            rowsByDuplicateKey.set(row.duplicate_key, []);
        }

        rowsByDuplicateKey.get(row.duplicate_key).push(row);
    }

    for (const [duplicateKey, duplicateRows] of rowsByDuplicateKey.entries()) {
        if (duplicateRows.length <= 1) {
            continue;
        }

        duplicateRows.forEach((row, index) => {
            row.duplicate_count = duplicateRows.length;
            addRowWarning(
                row,
                warnings,
                "duplicate",
                duplicateKey,
                index === 0
                    ? "Exact duplicate target row in CSV; first row kept."
                    : "Exact duplicate target row in CSV; duplicate skipped."
            );

            if (index > 0) {
                row.import_action = "SKIP";
            }
        });
    }
}

function finalizeRows(rows) {
    return rows.map((row) => {
        const previewStatus = row.errors.length > 0
            ? "ERROR"
            : row.warnings.length > 0
                ? "WARNING"
                : "READY";
        const { errors, warnings, ...publicRow } = row;

        return {
            ...publicRow,
            preview_status: previewStatus,
            issue_summary: [
                ...errors,
                ...warnings
            ].join(" | ") || null
        };
    });
}

function validationItem(label, count, warningCount = 0) {
    if (count > 0) {
        return {
            label,
            status: "ERROR",
            errors: count
        };
    }

    if (warningCount > 0) {
        return {
            label,
            status: "WARNING",
            errors: 0,
            warnings: warningCount
        };
    }

    return {
        label,
        status: "READY",
        errors: 0
    };
}

const HISTORY_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "enrollment_status_id", label: "Enrollment Status ID", defaultValue: "DB default" },
    { key: "enrollment_id", label: "Enrollment ID" },
    { key: "status_id", label: "Status ID" },
    { key: "status_name", label: "Status" },
    { key: "status_group", label: "Status Group" },
    { key: "status_month", label: "Month" },
    { key: "status_year", label: "Year" },
    { key: "source_status_name", label: "CSV Status" },
    { key: "normalized_status_name", label: "Normalized Status" },
    { key: "source_free_study", label: "CSV FreeStudy" },
    { key: "source_subject_code", label: "CSV Subject" },
    { key: "source_status_key", label: "CSV IDStatusKey" },
    { key: "source_status_id", label: "CSV IDStatus" },
    { key: "csv_row", label: "CSV Row" },
    { key: "duplicate_count", label: "Duplicate Count" },
    { key: "issue_summary", label: "Issues" }
];

export async function previewEnrollmentStatus() {
    const csvText = fs.readFileSync(csvPath, "utf8");
    const records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        relax_quotes: true,
        relax_column_count: true
    });

    const masters = await loadMasterData();
    const issues = {
        status: new Map(),
        monthYear: new Map()
    };
    const warnings = {
        enrollment: new Map(),
        duplicate: new Map(),
        existing: new Map()
    };

    const draftRows = records.map((record, index) =>
        buildPreviewRow(record, index + 2, masters, issues, warnings)
    );

    applyExactDuplicateValidation(draftRows, warnings);

    const finalizedRows = finalizeRows(draftRows);
    const errorCounts = {
        status: issueCount(issues.status),
        monthYear: issueCount(issues.monthYear)
    };
    const warningCounts = {
        enrollment: issueCount(warnings.enrollment),
        duplicate: issueCount(warnings.duplicate),
        existing: issueCount(warnings.existing)
    };
    const errorTotal = Object.values(errorCounts)
        .reduce((sum, count) => sum + count, 0);
    const warningTotal = Object.values(warningCounts)
        .reduce((sum, count) => sum + count, 0);
    const blockedRows = finalizedRows
        .filter((row) => row.preview_status === "ERROR")
        .length;
    const warningRows = finalizedRows
        .filter((row) => row.preview_status === "WARNING")
        .length;
    const rows = finalizedRows
        .filter((row) =>
            row.import_action === "INSERT" &&
            row.preview_status !== "ERROR"
        )
        .map(({ import_action, ...row }, index) => ({
            row_number: index + 1,
            ...row
        }));
    const skippedCount = records.length - rows.length - blockedRows;
    const validRows = rows.length;
    const status = statusFromIssueCounts(errorTotal, warningTotal);

    return {
        module: "history",
        title: "History",
        status,
        summary: buildNewOnlySummary({
            records: records.length,
            newRows: rows.length,
            skipped: skippedCount,
            errors: errorTotal,
            warnings: warningTotal,
            details: [
                { label: "Missing Enrollment", value: warningCounts.enrollment },
                { label: "Existing", value: warningCounts.existing },
                { label: "Exact Duplicates", value: warningCounts.duplicate },
                { label: "Enrollment Rows", value: masters.enrollmentCount }
            ]
        }),
        validation: [
            validationItem("Enrollment FK", 0, warningCounts.enrollment),
            validationItem("Status Master", errorCounts.status),
            validationItem("Month / Year", errorCounts.monthYear),
            validationItem("Existing Enrollment Status", 0, warningCounts.existing),
            validationItem("Exact Duplicate", 0, warningCounts.duplicate)
        ],
        columns: HISTORY_COLUMNS,
        rows,
        pagination: buildPagination(rows),
        csvRecords: records.length,
        outputRows: rows.length,
        blockedRows,
        warningRows,
        lookupErrors: errorCounts,
        lookupWarnings: warningCounts,
        issueDetails: {
            errors: Object.fromEntries(
                Object.entries(issues).map(([key, value]) => [
                    key,
                    issueList(value)
                ])
            ),
            warnings: Object.fromEntries(
                Object.entries(warnings).map(([key, value]) => [
                    key,
                    issueList(value)
                ])
            )
        },
        previewRows: rows
    };
}

export async function importEnrollmentStatus() {
    const previewResult = await previewEnrollmentStatus();
    const rows = previewResult.rows || [];
    const skipped = summaryValue(previewResult, "Skipped");
    const errors = summaryValue(previewResult, "Errors");

    if (hasBlockingPreviewError(previewResult)) {
        return emptyImportResult({
            module: "history",
            title: "History Import",
            message: "History import stopped because preview validation has blocking errors.",
            previewResult,
            errorCount: errors || 1,
            summary: [
                { label: "Inserted", value: 0 },
                { label: "Skipped", value: skipped },
                { label: "Errors", value: errors || 1 },
                { label: "Preview Rows", value: rows.length }
            ]
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const insertedCount = await insertRowsInBatches({
            client,
            tableName: "enrollment_status",
            columns: [
                "enrollment_id",
                "status_id",
                "status_month",
                "status_year"
            ],
            rows,
            values: (row) => [
                row.enrollment_id,
                row.status_id,
                row.status_month,
                row.status_year
            ]
        });

        await client.query("COMMIT");

        return {
            module: "history",
            title: "History Import",
            status: "READY",
            summary: [
                { label: "Inserted", value: insertedCount },
                { label: "Skipped", value: skipped },
                { label: "Errors", value: 0 },
                { label: "Preview Rows", value: rows.length },
                { label: "Missing Enrollment", value: summaryValue(previewResult, "Missing Enrollment") },
                { label: "Existing", value: summaryValue(previewResult, "Existing") },
                { label: "Exact Duplicates", value: summaryValue(previewResult, "Exact Duplicates") }
            ],
            validation: [
                { label: "Preview Validation", status: "READY", errors: 0 },
                { label: "Transaction", status: "READY", errors: 0 }
            ],
            columns: [
                { key: "row_number", label: "#" },
                { key: "action", label: "Action" },
                { key: "enrollment_id", label: "Enrollment ID" },
                { key: "status_id", label: "Status ID" },
                { key: "status_month", label: "Month" },
                { key: "status_year", label: "Year" },
                { key: "message", label: "Message" }
            ],
            rows: rows.slice(0, 1000).map((row, index) => ({
                row_number: index + 1,
                action: "INSERT",
                enrollment_id: row.enrollment_id,
                status_id: row.status_id,
                status_month: row.status_month,
                status_year: row.status_year,
                message: "Inserted enrollment_status row."
            })),
            pagination: buildPagination(rows.slice(0, 1000)),
            insertedCount,
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
