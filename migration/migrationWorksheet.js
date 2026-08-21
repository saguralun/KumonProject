import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse";
import iconv from "iconv-lite";
import pool from "../config/db.js";
import { PAGE_SIZE_OPTIONS, statusFromIssueCounts } from "./migrationPreviewCommon.js";
import {
    emptyImportResult,
    hasBlockingPreviewError,
    insertRowsInBatches,
    summaryValue
} from "./migrationImportCommon.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.join(__dirname, "tblWS.txt");
const ISSUE_SAMPLE_COUNT = 5;
const SERVER_PAGE_SIZE_OPTIONS = PAGE_SIZE_OPTIONS;
const DEFAULT_PAGE_SIZE = 50;
const RETENTION_YEARS = 3;

const SOURCE_COLUMNS = [
    "IDAdd",
    "ID",
    "NickName",
    "DateWS",
    "MonthWS",
    "YearWS",
    "Subject",
    "Level",
    "LevelWS",
    "CPWS",
    "StockBeforeUpdate",
    "Modify",
    "DateModify",
    "CtrStock",
    "ModifyConfirm",
    "DateModifyConfirm"
];

const WS_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "preview_status", label: "Preview Status" },
    { key: "import_action", label: "Action" },
    { key: "worksheet_used_id", label: "Worksheet Used ID", defaultValue: "DB default" },
    { key: "enrollment_id", label: "Enrollment ID" },
    { key: "worksheet_master_id", label: "Worksheet Master ID" },
    { key: "subject_code", label: "Subject" },
    { key: "level_master_id", label: "Level ID" },
    { key: "level_code", label: "Level" },
    { key: "packet_worksheet_no", label: "Packet WS No." },
    { key: "actual_worksheet_no", label: "Actual WS No." },
    { key: "worksheet_date", label: "Worksheet Date" },
    { key: "worksheet_month", label: "Month" },
    { key: "worksheet_year", label: "Year" },
    { key: "cpws", label: "CPWS" },
    { key: "is_stock_processed", label: "Stock Processed" },
    { key: "source_id_add", label: "CSV IDAdd" },
    { key: "nickname", label: "Nickname" },
    { key: "csv_row", label: "CSV Row" },
    { key: "duplicate_count", label: "Duplicate Count" },
    { key: "issue_summary", label: "Issues" },
    { key: "created_at", label: "Created At", defaultValue: "DB default" }
];

let wsPreviewCache = null;
let cleanupRegistered = false;

function cleanupCacheFileSync() {
    if (!wsPreviewCache?.dataFile) {
        return;
    }

    try {
        fs.unlinkSync(wsPreviewCache.dataFile);
    } catch {
        // Temp preview cache cleanup is best-effort.
    }
}

function registerCacheCleanup() {
    if (cleanupRegistered) {
        return;
    }

    cleanupRegistered = true;
    process.once("exit", cleanupCacheFileSync);
}

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

function masterKey(...parts) {
    return parts.map((part) => lookupKey(part)).join("|");
}

function previewKey(...parts) {
    return masterKey(...parts);
}

function pad2(value) {
    return String(value).padStart(2, "0");
}

function isValidDate(year, month, day) {
    const date = new Date(Date.UTC(year, month - 1, day));

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

function parseDateToAd(value, label) {
    const text = clean(value);

    if (!text) {
        return {
            value: null,
            error: `${label} is required.`
        };
    }

    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+.*)?$/);

    if (!match) {
        return {
            value: null,
            error: `${label} must use dd/mm/yyyy: ${text}`
        };
    }

    const day = Number(match[1]);
    const month = Number(match[2]);
    let year = Number(match[3]);

    if (year < 100) {
        year += year >= 70 ? 1900 : 2000;
    }

    if (year > 2400) {
        year -= 543;
    }

    if (!isValidDate(year, month, day)) {
        return {
            value: null,
            error: `${label} is invalid: ${text}`
        };
    }

    return {
        value: `${year}-${pad2(month)}-${pad2(day)}`,
        error: null
    };
}

function dateKeyFromDate(date) {
    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate())
    ].join("-");
}

function retentionCutoffDate() {
    const today = new Date();
    const cutoff = new Date(
        today.getFullYear() - RETENTION_YEARS,
        today.getMonth(),
        today.getDate()
    );

    return dateKeyFromDate(cutoff);
}

function parsePositiveInteger(value, label) {
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
            error: `${label} must be a positive integer: ${text}`
        };
    }

    const numberValue = Number(text);

    if (!Number.isSafeInteger(numberValue) || numberValue < 1) {
        return {
            value: null,
            error: `${label} must be a positive integer: ${text}`
        };
    }

    return {
        value: numberValue,
        error: null
    };
}

function parseMonth(value, label) {
    const parsed = parsePositiveInteger(value, label);

    if (parsed.error) {
        return parsed;
    }

    if (parsed.value < 1 || parsed.value > 12) {
        return {
            value: parsed.value,
            error: `${label} must be 1-12: ${parsed.value}`
        };
    }

    return parsed;
}

function parseYear(value, label) {
    const parsed = parsePositiveInteger(value, label);

    if (parsed.error) {
        return parsed;
    }

    if (parsed.value < 1900 || parsed.value > 2600) {
        return {
            value: parsed.value,
            error: `${label} is outside expected range: ${parsed.value}`
        };
    }

    return parsed;
}

function parseBooleanWithDefault(value, label, defaultValue) {
    const text = lookupKey(value);

    if (!text) {
        return {
            value: defaultValue,
            defaulted: true,
            error: null
        };
    }

    if (["true", "t", "yes", "y", "1", "-1"].includes(text)) {
        return {
            value: true,
            defaulted: false,
            error: null
        };
    }

    if (["false", "f", "no", "n", "0"].includes(text)) {
        return {
            value: false,
            defaulted: false,
            error: null
        };
    }

    return {
        value: null,
        defaulted: false,
        error: `${label} must be TRUE or FALSE: ${clean(value)}`
    };
}

function sortedLevelCodes(levels) {
    return levels
        .map((level) => level.level_code)
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function parseLevelCode(value, candidateCodes) {
    const text = clean(value).toUpperCase();

    if (!text) {
        return {
            levelCode: null,
            error: "Level is required."
        };
    }

    for (const code of candidateCodes) {
        if (text === code) {
            return {
                levelCode: code,
                error: null
            };
        }

        const suffix = text.slice(code.length);

        if (text.startsWith(code) && /^\d+$/.test(suffix)) {
            return {
                levelCode: code,
                error: null
            };
        }
    }

    return {
        levelCode: null,
        error: `Cannot derive level code from: ${text}`
    };
}

function worksheetPacketNo(actualWorksheetNo) {
    return Math.floor((actualWorksheetNo - 1) / 10) * 10 + 1;
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
            source_id_add: nullable(row.source_id_add),
            source_id: nullable(row.source_enrollment_id),
            subject: nullable(row.source_subject_code),
            level: nullable(row.source_level),
            level_ws: nullable(row.source_level_ws),
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

function countIssueMaps(issueMaps) {
    return Object.fromEntries(
        Object.entries(issueMaps).map(([key, value]) => [key, issueCount(value)])
    );
}

function addError(row, issues, category, value, message) {
    row.errors.push(message);
    addIssue(issues[category], value, row, message);
}

function addInfo(row, info, category, value, message) {
    row.info.push(message);
    addIssue(info[category], value, row, message);
}

function validationItem(label, errorCount, skipped = 0, defaulted = 0) {
    return {
        label,
        status: errorCount > 0 ? "ERROR" : "READY",
        errors: errorCount,
        skipped,
        defaulted
    };
}

function emptyIssueMaps() {
    return {
        errors: {
            required: new Map(),
            date: new Map(),
            number: new Map()
        },
        warnings: {},
        info: {
            olderThanRetention: new Map(),
            missingEnrollment: new Map(),
            missingMaster: new Map(),
            existing: new Map(),
            duplicate: new Map(),
            booleanDefaults: new Map(),
            invalidBoolean: new Map()
        }
    };
}

async function getDbSignature(db = pool) {
    const [enrollmentResult, worksheetMasterResult, worksheetUsedResult] =
        await Promise.all([
            db.query(`
                SELECT COUNT(*)::int AS count,
                       COALESCE(MAX(enrollment_id), 0)::int AS max_id
                FROM enrollment
            `),
            db.query(`
                SELECT COUNT(*)::int AS count,
                       COALESCE(MAX(worksheet_master_id), 0)::int AS max_id
                FROM worksheet_master
            `),
            db.query(`
                SELECT COUNT(*)::int AS count,
                       COALESCE(MAX(worksheet_used_id), 0)::int AS max_id
                FROM worksheet_used
            `)
        ]);

    return {
        enrollment: enrollmentResult.rows[0],
        worksheetMaster: worksheetMasterResult.rows[0],
        worksheetUsed: worksheetUsedResult.rows[0]
    };
}

async function getPreviewSignature(db = pool) {
    const source = fs.statSync(csvPath);

    return {
        retention: {
            years: RETENTION_YEARS,
            cutoffDate: retentionCutoffDate()
        },
        source: {
            path: csvPath,
            size: source.size,
            mtimeMs: source.mtimeMs
        },
        db: await getDbSignature(db)
    };
}

function sameSignature(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
}

async function loadMasterData(db = pool) {
    const [
        subjectResult,
        levelResult,
        worksheetResult,
        enrollmentResult,
        existingResult
    ] = await Promise.all([
        db.query(`
            SELECT subject_id, subject_code, subject_name
            FROM subject_master
            ORDER BY subject_id
        `),
        db.query(`
            SELECT lm.level_master_id,
                   lm.subject_id,
                   sm.subject_code,
                   lm.level_code
            FROM level_master lm
            JOIN subject_master sm
                ON sm.subject_id = lm.subject_id
            ORDER BY lm.subject_id, LENGTH(lm.level_code) DESC, lm.level_code
        `),
        db.query(`
            SELECT wm.worksheet_master_id,
                   wm.level_master_id,
                   wm.worksheet_no
            FROM worksheet_master wm
            ORDER BY wm.level_master_id, wm.worksheet_no
        `),
        db.query(`
            SELECT enrollment_id
            FROM enrollment
            ORDER BY enrollment_id
        `),
        db.query(`
            SELECT enrollment_id,
                   worksheet_master_id,
                   actual_worksheet_no,
                   worksheet_date::text AS worksheet_date
            FROM worksheet_used
            ORDER BY worksheet_used_id
        `)
    ]);
    const levelsBySubjectId = new Map();

    for (const level of levelResult.rows) {
        if (!levelsBySubjectId.has(level.subject_id)) {
            levelsBySubjectId.set(level.subject_id, []);
        }

        levelsBySubjectId.get(level.subject_id).push(level);
    }

    return {
        subjectsByCode: new Map(
            subjectResult.rows.map((subject) => [
                lookupKey(subject.subject_code),
                subject
            ])
        ),
        levelCodesBySubjectId: new Map(
            [...levelsBySubjectId.entries()].map(([subjectId, levels]) => [
                subjectId,
                sortedLevelCodes(levels)
            ])
        ),
        levelsBySubjectAndCode: new Map(
            levelResult.rows.map((level) => [
                masterKey(level.subject_id, level.level_code),
                level
            ])
        ),
        worksheetsByLevelNo: new Map(
            worksheetResult.rows.map((worksheet) => [
                masterKey(worksheet.level_master_id, worksheet.worksheet_no),
                worksheet
            ])
        ),
        enrollmentIds: new Set(
            enrollmentResult.rows.map((row) => Number(row.enrollment_id))
        ),
        existingKeys: new Set(
            existingResult.rows.map((row) =>
                previewKey(
                    row.enrollment_id,
                    row.worksheet_master_id,
                    row.actual_worksheet_no,
                    row.worksheet_date
                )
            )
        ),
        enrollmentCount: enrollmentResult.rows.length,
        worksheetMasterCount: worksheetResult.rows.length
    };
}

function buildSourceRow(record, csvRow) {
    return {
        csv_row: csvRow,
        source_id_add: nullable(record.IDAdd),
        source_enrollment_id: nullable(record.ID),
        nickname: nullable(record.NickName),
        source_subject_code: nullable(record.Subject),
        source_level: nullable(record.Level),
        source_level_ws: nullable(record.LevelWS),
        preview_status: "READY",
        import_action: "INSERT",
        errors: [],
        info: []
    };
}

function buildWorksheetRow(record, csvRow, masters, issues, cutoffDate) {
    const row = {
        ...buildSourceRow(record, csvRow),
        worksheet_used_id: null,
        enrollment_id: null,
        worksheet_master_id: null,
        subject_id: null,
        subject_code: null,
        level_master_id: null,
        level_code: null,
        packet_worksheet_no: null,
        actual_worksheet_no: null,
        worksheet_date: null,
        worksheet_month: null,
        worksheet_year: null,
        cpws: null,
        is_stock_processed: null,
        duplicate_count: 0,
        issue_summary: null,
        created_at: null
    };
    const enrollmentId = parsePositiveInteger(record.ID, "enrollment_id");
    const worksheetDate = parseDateToAd(record.DateWS, "DateWS");

    row.enrollment_id = enrollmentId.value;
    row.worksheet_date = worksheetDate.value;

    if (worksheetDate.error) {
        addError(row, issues.errors, "date", record.DateWS, worksheetDate.error);
    } else if (worksheetDate.value < cutoffDate) {
        addInfo(
            row,
            issues.info,
            "olderThanRetention",
            worksheetDate.value,
            `Worksheet date is older than ${RETENTION_YEARS} years; row skipped.`
        );
        row.import_action = "SKIP";

        return row;
    }

    const worksheetMonth = parseMonth(record.MonthWS, "worksheet_month");
    const worksheetYear = parseYear(record.YearWS, "worksheet_year");
    const actualWorksheetNo = parsePositiveInteger(record.LevelWS, "LevelWS");
    const cpws = parseBooleanWithDefault(record.CPWS, "CPWS", true);
    const stockProcessed = parseBooleanWithDefault(record.CtrStock, "CtrStock", false);

    row.worksheet_month = worksheetMonth.value;
    row.worksheet_year = worksheetYear.value;
    row.actual_worksheet_no = actualWorksheetNo.value;
    row.cpws = cpws.value;
    row.is_stock_processed = stockProcessed.value;

    if (enrollmentId.error) {
        addError(row, issues.errors, "required", record.ID, enrollmentId.error);
    } else if (!masters.enrollmentIds.has(enrollmentId.value)) {
        addInfo(
            row,
            issues.info,
            "missingEnrollment",
            enrollmentId.value,
            "CSV ID has no matching enrollment.enrollment_id; row skipped."
        );
        row.import_action = "SKIP";
    }

    if (worksheetMonth.error) {
        addError(row, issues.errors, "number", record.MonthWS, worksheetMonth.error);
    }

    if (worksheetYear.error) {
        addError(row, issues.errors, "number", record.YearWS, worksheetYear.error);
    }

    if (actualWorksheetNo.error) {
        addError(row, issues.errors, "number", record.LevelWS, actualWorksheetNo.error);
    } else {
        row.packet_worksheet_no = worksheetPacketNo(actualWorksheetNo.value);
    }

    if (cpws.defaulted) {
        addInfo(
            row,
            issues.info,
            "booleanDefaults",
            "CPWS",
            "Blank CPWS defaulted to true."
        );
    } else if (cpws.error) {
        addInfo(row, issues.info, "invalidBoolean", record.CPWS, `${cpws.error}; row skipped.`);
        row.import_action = "SKIP";
    }

    if (stockProcessed.defaulted) {
        addInfo(
            row,
            issues.info,
            "booleanDefaults",
            "CtrStock",
            "Blank CtrStock defaulted to false."
        );
    } else if (stockProcessed.error) {
        addInfo(
            row,
            issues.info,
            "invalidBoolean",
            record.CtrStock,
            `${stockProcessed.error}; row skipped.`
        );
        row.import_action = "SKIP";
    }

    const subject = masters.subjectsByCode.get(lookupKey(record.Subject));

    if (!subject) {
        addInfo(
            row,
            issues.info,
            "missingMaster",
            record.Subject,
            "No matching subject_master.subject_code; row skipped."
        );
        row.import_action = "SKIP";
    }

    row.subject_id = subject?.subject_id || null;
    row.subject_code = subject?.subject_code || null;

    if (subject) {
        const candidateCodes = masters.levelCodesBySubjectId.get(subject.subject_id) || [];
        const parsedLevel = parseLevelCode(record.Level, candidateCodes);

        if (parsedLevel.error) {
            addInfo(
                row,
                issues.info,
                "missingMaster",
                `${subject.subject_code} / ${clean(record.Level)}`,
                `${parsedLevel.error}; row skipped.`
            );
            row.import_action = "SKIP";
        } else {
            const level = masters.levelsBySubjectAndCode.get(
                masterKey(subject.subject_id, parsedLevel.levelCode)
            );

            if (level) {
                row.level_master_id = level.level_master_id;
                row.level_code = level.level_code;
            } else {
                addInfo(
                    row,
                    issues.info,
                    "missingMaster",
                    `${subject.subject_code} / ${parsedLevel.levelCode}`,
                    "No matching level_master row; row skipped."
                );
                row.import_action = "SKIP";
            }
        }
    }

    if (row.level_master_id && row.packet_worksheet_no) {
        const worksheet = masters.worksheetsByLevelNo.get(
            masterKey(row.level_master_id, row.packet_worksheet_no)
        );

        if (worksheet) {
            row.worksheet_master_id = worksheet.worksheet_master_id;
        } else {
            addInfo(
                row,
                issues.info,
                "missingMaster",
                `${row.subject_code} / ${row.level_code} / WS ${row.packet_worksheet_no}`,
                "No matching worksheet_master packet row; row skipped."
            );
            row.import_action = "SKIP";
        }
    }

    row.duplicate_key = previewKey(
        row.enrollment_id,
        row.worksheet_master_id,
        row.actual_worksheet_no,
        row.worksheet_date
    );

    return row;
}

function finalizePublicRow(row, rowNumber) {
    return {
        row_number: rowNumber,
        preview_status: "READY",
        import_action: "INSERT",
        worksheet_used_id: null,
        enrollment_id: row.enrollment_id,
        worksheet_master_id: row.worksheet_master_id,
        subject_code: row.subject_code,
        level_master_id: row.level_master_id,
        level_code: row.level_code,
        packet_worksheet_no: row.packet_worksheet_no,
        actual_worksheet_no: row.actual_worksheet_no,
        worksheet_date: row.worksheet_date,
        worksheet_month: row.worksheet_month,
        worksheet_year: row.worksheet_year,
        cpws: row.cpws,
        is_stock_processed: row.is_stock_processed,
        source_id_add: row.source_id_add,
        nickname: row.nickname,
        csv_row: row.csv_row,
        duplicate_count: row.duplicate_count,
        issue_summary: row.info.join(" | ") || null,
        created_at: null
    };
}

async function writeJsonLine(stream, row) {
    const line = `${JSON.stringify(row)}\n`;

    if (!stream.write(line)) {
        await new Promise((resolve) => stream.once("drain", resolve));
    }

    return Buffer.byteLength(line);
}

async function readRowsFromCache(cache, page, pageSize) {
    if (cache.newRows === 0) {
        return [];
    }

    const startIndex = (page - 1) * pageSize;
    const endIndex = Math.min(startIndex + pageSize, cache.newRows);

    if (startIndex >= endIndex) {
        return [];
    }

    const startOffset = cache.offsets[startIndex];
    const endOffset = endIndex < cache.offsets.length
        ? cache.offsets[endIndex] - 1
        : cache.dataFileSize - 1;
    const length = endOffset - startOffset + 1;
    const buffer = Buffer.alloc(length);
    const file = await fs.promises.open(cache.dataFile, "r");

    try {
        await file.read(buffer, 0, length, startOffset);
    } finally {
        await file.close();
    }

    const text = buffer.toString("utf8");

    return text
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
}

async function removeCacheFile(cache) {
    if (!cache?.dataFile) {
        return;
    }

    try {
        await fs.promises.unlink(cache.dataFile);
    } catch {
        // Temp preview cache cleanup is best-effort.
    }
}

function buildSummary(cache) {
    return [
        { label: "Records", value: cache.records },
        { label: "New", value: cache.newRows },
        { label: "Skipped", value: cache.skipped },
        { label: "Errors", value: cache.errorTotal },
        { label: "Warnings", value: 0 },
        { label: "Older Than 3 Years", value: cache.infoCounts.olderThanRetention },
        { label: "Missing Enrollment", value: cache.infoCounts.missingEnrollment },
        { label: "Missing Master", value: cache.infoCounts.missingMaster },
        { label: "Existing", value: cache.infoCounts.existing },
        { label: "Exact Duplicates", value: cache.infoCounts.duplicate },
        { label: "Boolean Defaults", value: cache.infoCounts.booleanDefaults },
        { label: "Invalid Boolean", value: cache.infoCounts.invalidBoolean },
        { label: "Enrollment Rows", value: cache.enrollmentCount },
        { label: "Worksheet Master Rows", value: cache.worksheetMasterCount }
    ];
}

function buildValidation(cache) {
    return [
        validationItem("Enrollment FK", 0, cache.infoCounts.missingEnrollment),
        validationItem("Retention Window", 0, cache.infoCounts.olderThanRetention),
        validationItem("Worksheet Master Lookup", 0, cache.infoCounts.missingMaster),
        validationItem("Date", cache.errorCounts.date),
        validationItem("Required ID", cache.errorCounts.required),
        validationItem("Number Fields", cache.errorCounts.number),
        validationItem("Existing Target Rows", 0, cache.infoCounts.existing),
        validationItem("Exact Duplicate", 0, cache.infoCounts.duplicate),
        validationItem("Boolean Defaults", 0, 0, cache.infoCounts.booleanDefaults),
        validationItem("Invalid Boolean", 0, cache.infoCounts.invalidBoolean)
    ];
}

function buildPagination(page, pageSize, totalRows) {
    const totalPages = Math.ceil(totalRows / pageSize);
    const safePage = totalPages === 0
        ? 1
        : Math.min(Math.max(page, 1), totalPages);
    const startRow = totalRows === 0
        ? 0
        : (safePage - 1) * pageSize + 1;

    return {
        page: safePage,
        pageSize,
        pageSizeOptions: SERVER_PAGE_SIZE_OPTIONS,
        totalRows,
        totalPages,
        startRow,
        endRow: Math.min(safePage * pageSize, totalRows),
        serverSide: true
    };
}

function normalizePageSize(value) {
    const numberValue = Number(value);

    return SERVER_PAGE_SIZE_OPTIONS.includes(numberValue)
        ? numberValue
        : DEFAULT_PAGE_SIZE;
}

function normalizePage(value) {
    const numberValue = Number(value);

    return Number.isSafeInteger(numberValue) && numberValue > 0
        ? numberValue
        : 1;
}

async function buildCache(signature) {
    registerCacheCleanup();

    const startedAt = Date.now();
    const masters = await loadMasterData();
    const cutoffDate = signature.retention.cutoffDate;
    const issues = emptyIssueMaps();
    const seenKeys = new Set();
    const dataFile = path.join(
        os.tmpdir(),
        `kumondb-ws-preview-${process.pid}-${Date.now()}.jsonl`
    );
    const writer = fs.createWriteStream(dataFile, { encoding: "utf8" });
    const offsets = [];
    let currentOffset = 0;
    let records = 0;
    let newRows = 0;
    let errorRows = 0;
    let skipped = 0;

    const parser = fs.createReadStream(csvPath)
        .pipe(iconv.decodeStream("win874"))
        .pipe(parse({
            columns: SOURCE_COLUMNS,
            skip_empty_lines: true,
            relax_quotes: true,
            relax_column_count: true,
            bom: true
        }));

    for await (const record of parser) {
        records++;
        const row = buildWorksheetRow(record, records, masters, issues, cutoffDate);

        if (row.errors.length > 0) {
            errorRows++;
            continue;
        }

        if (row.import_action === "SKIP") {
            skipped++;
            continue;
        }

        if (masters.existingKeys.has(row.duplicate_key)) {
            addInfo(
                row,
                issues.info,
                "existing",
                row.duplicate_key,
                "Target row already exists; row skipped."
            );
            skipped++;
            continue;
        }

        if (seenKeys.has(row.duplicate_key)) {
            addInfo(
                row,
                issues.info,
                "duplicate",
                row.duplicate_key,
                "Exact duplicate target row in CSV; duplicate skipped."
            );
            skipped++;
            continue;
        }

        seenKeys.add(row.duplicate_key);
        row.duplicate_count = 1;
        const publicRow = finalizePublicRow(row, newRows + 1);

        offsets.push(currentOffset);
        currentOffset += await writeJsonLine(writer, publicRow);
        newRows++;
    }

    await new Promise((resolve, reject) => {
        writer.end(resolve);
        writer.on("error", reject);
    });

    const errorCounts = countIssueMaps(issues.errors);
    const infoCounts = countIssueMaps(issues.info);
    const dataFileSize = currentOffset;
    const errorTotal = Object.values(errorCounts)
        .reduce((sum, count) => sum + count, 0);

    return {
        signature,
        dataFile,
        dataFileSize,
        offsets,
        records,
        newRows,
        skipped,
        errorRows,
        errorCounts,
        warningCounts: {},
        infoCounts,
        errorTotal,
        warningTotal: 0,
        enrollmentCount: masters.enrollmentCount,
        worksheetMasterCount: masters.worksheetMasterCount,
        processingMs: Date.now() - startedAt,
        issueDetails: {
            errors: Object.fromEntries(
                Object.entries(issues.errors).map(([key, value]) => [
                    key,
                    issueList(value)
                ])
            ),
            warnings: {},
            info: Object.fromEntries(
                Object.entries(issues.info).map(([key, value]) => [
                    key,
                    issueList(value)
                ])
            )
        }
    };
}

async function getCache() {
    const signature = await getPreviewSignature();

    if (wsPreviewCache && sameSignature(wsPreviewCache.signature, signature)) {
        return {
            cache: wsPreviewCache,
            cacheHit: true
        };
    }

    await removeCacheFile(wsPreviewCache);
    wsPreviewCache = await buildCache(signature);

    return {
        cache: wsPreviewCache,
        cacheHit: false
    };
}

export async function previewWorksheet(options = {}) {
    const requestedPageSize = normalizePageSize(options.pageSize);
    const { cache, cacheHit } = await getCache();
    const pagination = buildPagination(
        normalizePage(options.page),
        requestedPageSize,
        cache.newRows
    );
    const rows = await readRowsFromCache(cache, pagination.page, pagination.pageSize);

    return {
        module: "ws",
        title: "WS",
        status: statusFromIssueCounts(cache.errorTotal, 0),
        serverPaginated: true,
        summary: buildSummary(cache),
        validation: buildValidation(cache),
        columns: WS_COLUMNS,
        rows,
        pagination,
        csvRecords: cache.records,
        outputRows: cache.newRows,
        skippedRows: cache.skipped,
        blockedRows: cache.errorRows,
        warningRows: 0,
        lookupErrors: cache.errorCounts,
        lookupWarnings: cache.warningCounts,
        lookupInfo: cache.infoCounts,
        issueDetails: cache.issueDetails,
        retention: cache.signature.retention,
        previewRows: rows,
        cache: {
            hit: cacheHit,
            processingMs: cache.processingMs,
            dataFileSize: cache.dataFileSize
        }
    };
}

function importPagination(rows) {
    return {
        page: 1,
        pageSize: DEFAULT_PAGE_SIZE,
        pageSizeOptions: SERVER_PAGE_SIZE_OPTIONS,
        totalRows: rows.length,
        totalPages: Math.ceil(rows.length / DEFAULT_PAGE_SIZE),
        startRow: rows.length > 0 ? 1 : 0,
        endRow: Math.min(DEFAULT_PAGE_SIZE, rows.length)
    };
}

export async function importWorksheet() {
    const previewResult = await previewWorksheet({ page: 1, pageSize: DEFAULT_PAGE_SIZE });
    const skipped = summaryValue(previewResult, "Skipped");
    const errors = summaryValue(previewResult, "Errors");

    if (hasBlockingPreviewError(previewResult)) {
        return emptyImportResult({
            module: "ws",
            title: "WS Import",
            message: "WS import stopped because preview validation has blocking errors.",
            previewResult,
            errorCount: errors || 1,
            summary: [
                { label: "Inserted", value: 0 },
                { label: "Skipped", value: skipped },
                { label: "Errors", value: errors || 1 },
                { label: "Preview Rows", value: previewResult.outputRows || 0 }
            ]
        });
    }

    const { cache } = await getCache();
    const client = await pool.connect();
    const importRows = [];
    let insertedCount = 0;
    const chunkSize = 5000;

    try {
        await client.query("BEGIN");

        for (let page = 1; (page - 1) * chunkSize < cache.newRows; page++) {
            const rows = await readRowsFromCache(cache, page, chunkSize);

            insertedCount += await insertRowsInBatches({
                client,
                tableName: "worksheet_used",
                columns: [
                    "enrollment_id",
                    "worksheet_master_id",
                    "actual_worksheet_no",
                    "worksheet_date",
                    "worksheet_month",
                    "worksheet_year",
                    "cpws",
                    "is_stock_processed"
                ],
                rows,
                values: (row) => [
                    row.enrollment_id,
                    row.worksheet_master_id,
                    row.actual_worksheet_no,
                    row.worksheet_date,
                    row.worksheet_month,
                    row.worksheet_year,
                    row.cpws,
                    row.is_stock_processed
                ],
                chunkSize: 1000
            });

            for (const row of rows) {
                if (importRows.length >= 1000) {
                    break;
                }

                importRows.push({
                    row_number: importRows.length + 1,
                    action: "INSERT",
                    enrollment_id: row.enrollment_id,
                    worksheet_master_id: row.worksheet_master_id,
                    actual_worksheet_no: row.actual_worksheet_no,
                    worksheet_date: row.worksheet_date,
                    message: "Inserted worksheet_used row."
                });
            }
        }

        await client.query("COMMIT");
        await removeCacheFile(wsPreviewCache);
        wsPreviewCache = null;

        return {
            module: "ws",
            title: "WS Import",
            status: "READY",
            summary: [
                { label: "Inserted", value: insertedCount },
                { label: "Skipped", value: skipped },
                { label: "Errors", value: 0 },
                { label: "Preview Rows", value: cache.newRows },
                { label: "Older Than 3 Years", value: summaryValue(previewResult, "Older Than 3 Years") },
                { label: "Missing Enrollment", value: summaryValue(previewResult, "Missing Enrollment") },
                { label: "Missing Master", value: summaryValue(previewResult, "Missing Master") },
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
                { key: "worksheet_master_id", label: "Worksheet Master ID" },
                { key: "actual_worksheet_no", label: "Actual WS No." },
                { key: "worksheet_date", label: "Worksheet Date" },
                { key: "message", label: "Message" }
            ],
            rows: importRows,
            pagination: importPagination(importRows),
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
