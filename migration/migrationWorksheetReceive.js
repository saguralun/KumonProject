import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";
import pool from "../config/db.js";
import { buildPagination, statusFromIssueCounts } from "./migrationPreviewCommon.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.join(__dirname, "tblKumonReceive.txt");
const ISSUE_SAMPLE_COUNT = 5;

const SOURCE_COLUMNS = [
    "IDReceiveWS",
    "DONo",
    "IDKumonWS",
    "Subject",
    "Type",
    "Level",
    "LevelWS",
    "Qty",
    "StockBeforeUpdate",
    "OutDate",
    "MonthOD",
    "YearOD",
    "DateReceive",
    "Update"
];

const HEADER_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "preview_status", label: "Preview Status" },
    { key: "header_action", label: "Header Action" },
    { key: "worksheet_do_id", label: "Worksheet DO ID", defaultValue: "DB default" },
    { key: "do_no", label: "DO No." },
    { key: "out_date", label: "Out Date" },
    { key: "receive_date", label: "Receive Date" },
    { key: "receive_month", label: "Receive Month" },
    { key: "receive_year", label: "Receive Year" },
    { key: "is_stock_processed", label: "Stock Processed" },
    { key: "source_row_count", label: "Source Rows" },
    { key: "detail_count", label: "Detail Count" }
];

const DETAIL_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "preview_status", label: "Preview Status" },
    { key: "detail_action", label: "Detail Action" },
    { key: "worksheet_receive_id", label: "Worksheet Receive ID", defaultValue: "DB default" },
    { key: "worksheet_do_id", label: "Worksheet DO ID", defaultValue: "after header insert" },
    { key: "do_no", label: "DO No." },
    { key: "worksheet_master_id", label: "Worksheet Master ID" },
    { key: "subject_code", label: "Subject" },
    { key: "level_master_id", label: "Level ID" },
    { key: "level_code", label: "Level" },
    { key: "worksheet_no", label: "Worksheet No." },
    { key: "quantity", label: "Quantity" },
    { key: "source_id_kumon_ws", label: "CSV IDKumonWS" },
    { key: "source_id_receive_ws", label: "CSV IDReceiveWS" },
    { key: "source_type", label: "CSV Type" },
    { key: "source_row_count", label: "Source Rows" },
    { key: "issue_summary", label: "Issues" }
];

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

function parseDateToAd(value, label, options = {}) {
    const text = clean(value);

    if (!text) {
        return options.optional
            ? { value: null, error: null }
            : { value: null, error: `${label} is required.` };
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
            do_no: nullable(row.do_no),
            source_id_receive_ws: nullable(row.source_id_receive_ws),
            source_id_kumon_ws: nullable(row.source_id_kumon_ws),
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

function validationItem(label, errorCount = 0, skipped = 0) {
    return {
        label,
        status: errorCount > 0 ? "ERROR" : "READY",
        errors: errorCount,
        skipped
    };
}

function tableMissingItem(label, missing) {
    return {
        label,
        status: "READY",
        errors: 0,
        message: missing
            ? "Target table is not present in DB; preview treats existing rows as 0."
            : "Target table is present."
    };
}

async function tableExists(db, tableName) {
    const result = await db.query("SELECT to_regclass($1) AS table_name", [
        tableName
    ]);

    return Boolean(result.rows[0].table_name);
}

async function loadMasterData(db = pool) {
    const [
        subjectResult,
        levelResult,
        worksheetResult,
        doExists,
        receiveExists
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
        tableExists(db, "worksheet_do"),
        tableExists(db, "worksheet_receive")
    ]);
    const levelsBySubjectId = new Map();

    for (const level of levelResult.rows) {
        if (!levelsBySubjectId.has(level.subject_id)) {
            levelsBySubjectId.set(level.subject_id, []);
        }

        levelsBySubjectId.get(level.subject_id).push(level);
    }

    let existingDoResult = { rows: [] };
    let existingReceiveResult = { rows: [] };

    if (doExists) {
        existingDoResult = await db.query(`
            SELECT worksheet_do_id, do_no
            FROM worksheet_do
            ORDER BY worksheet_do_id
        `);
    }

    if (doExists && receiveExists) {
        existingReceiveResult = await db.query(`
            SELECT wr.worksheet_do_id,
                   wd.do_no,
                   wr.worksheet_master_id
            FROM worksheet_receive wr
            JOIN worksheet_do wd
                ON wd.worksheet_do_id = wr.worksheet_do_id
            ORDER BY wr.worksheet_receive_id
        `);
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
        existingDoByNo: new Map(
            existingDoResult.rows.map((row) => [
                lookupKey(row.do_no),
                row
            ])
        ),
        existingReceiveKeys: new Set(
            existingReceiveResult.rows.map((row) =>
                masterKey(row.do_no, row.worksheet_master_id)
            )
        ),
        worksheetMasterCount: worksheetResult.rows.length,
        doTableExists: doExists,
        receiveTableExists: receiveExists,
        existingDoCount: existingDoResult.rows.length,
        existingReceiveCount: existingReceiveResult.rows.length
    };
}

function buildSourceRow(record, csvRow) {
    return {
        csv_row: csvRow,
        record,
        do_no: nullable(record.DONo),
        source_id_receive_ws: nullable(record.IDReceiveWS),
        source_id_kumon_ws: nullable(record.IDKumonWS),
        source_subject_code: nullable(record.Subject),
        source_type: nullable(record.Type),
        source_level: nullable(record.Level),
        source_level_ws: nullable(record.LevelWS),
        skip: false,
        errors: [],
        info: []
    };
}

function parseSourceRow(row, issues, info) {
    const record = row.record;
    const doNo = clean(record.DONo);

    if (/^(draft|rt)/i.test(doNo)) {
        addInfo(
            row,
            info,
            "fakeDo",
            doNo,
            "Draft/RT DO number is legacy fake data; row skipped."
        );
        row.skip = true;

        return row;
    }

    const outDate = parseDateToAd(record.OutDate, "OutDate");
    const receiveDate = parseDateToAd(record.DateReceive, "DateReceive", {
        optional: true
    });
    const receiveMonth = parseMonth(record.MonthOD, "receive_month");
    const receiveYear = parseYear(record.YearOD, "receive_year");
    const quantity = parsePositiveInteger(record.Qty, "quantity");
    const packetWorksheetNo = parsePositiveInteger(record.LevelWS, "LevelWS");
    const stockProcessed = parseBooleanWithDefault(record.Update, "Update", false);

    row.out_date = outDate.value;
    row.receive_date = receiveDate.value;
    row.receive_month = receiveMonth.value;
    row.receive_year = receiveYear.value;
    row.quantity = quantity.value;
    row.packet_worksheet_no = packetWorksheetNo.value;
    row.is_stock_processed = stockProcessed.value;

    if (!clean(record.DONo)) {
        addError(row, issues, "required", record.DONo, "DONo is required.");
    }

    if (!clean(record.Subject)) {
        addError(row, issues, "required", record.Subject, "Subject is required.");
    }

    if (!clean(record.Level)) {
        addError(row, issues, "required", record.Level, "Level is required.");
    }

    if (outDate.error) {
        addError(row, issues, "date", record.OutDate, outDate.error);
    }

    if (receiveDate.error) {
        addError(row, issues, "date", record.DateReceive, receiveDate.error);
    }

    if (receiveMonth.error) {
        addError(row, issues, "number", record.MonthOD, receiveMonth.error);
    }

    if (receiveYear.error) {
        addError(row, issues, "number", record.YearOD, receiveYear.error);
    }

    if (quantity.error) {
        addError(row, issues, "number", record.Qty, quantity.error);
    }

    if (packetWorksheetNo.error) {
        addError(row, issues, "number", record.LevelWS, packetWorksheetNo.error);
    }

    if (stockProcessed.defaulted) {
        addInfo(
            row,
            info,
            "booleanDefaults",
            "Update",
            "Blank Update defaulted to false."
        );
    } else if (stockProcessed.error) {
        addInfo(
            row,
            info,
            "invalidBoolean",
            record.Update,
            `${stockProcessed.error}; row skipped.`
        );
        row.skip = true;
    }

    return row;
}

function resolveWorksheetItem(row, masters, info) {
    if (lookupKey(row.record.Type) !== "ws") {
        addInfo(
            row,
            info,
            "unsupportedType",
            row.record.Type,
            "Type is not WS; row skipped."
        );
        return null;
    }

    const subject = masters.subjectsByCode.get(lookupKey(row.record.Subject));

    if (!subject) {
        addInfo(
            row,
            info,
            "missingMaster",
            row.record.Subject,
            "No matching subject_master.subject_code; row skipped."
        );
        return null;
    }

    const level = resolveLevelForWorksheet(row, subject, masters, info);

    if (!level) {
        return null;
    }

    const worksheet = masters.worksheetsByLevelNo.get(
        masterKey(level.level_master_id, row.packet_worksheet_no)
    );

    if (!worksheet) {
        addInfo(
            row,
            info,
            "missingMaster",
            `${subject.subject_code} / ${level.level_code} / ${clean(row.record.LevelWS)}`,
            "No matching worksheet_master row; row skipped."
        );
        return null;
    }

    return {
        subject,
        level,
        worksheet
    };
}

function resolveLevelForWorksheet(row, subject, masters, info) {
    const candidateCodes = masters.levelCodesBySubjectId.get(subject.subject_id) || [];
    const parsedLevel = parseLevelCode(row.record.Level, candidateCodes);

    if (parsedLevel.error) {
        addInfo(
            row,
            info,
            "missingMaster",
            `${subject.subject_code} / ${clean(row.record.Level)}`,
            `${parsedLevel.error}; row skipped.`
        );
        return null;
    }

    const level = masters.levelsBySubjectAndCode.get(
        masterKey(subject.subject_id, parsedLevel.levelCode)
    );

    if (!level) {
        addInfo(
            row,
            info,
            "missingMaster",
            `${subject.subject_code} / ${parsedLevel.levelCode}`,
            "No matching level_master row; row skipped."
        );
        return null;
    }

    return level;
}

function buildGroups(rows, masters, info) {
    const groups = new Map();

    for (const row of rows) {
        if (row.skip) {
            continue;
        }

        const doNo = clean(row.record.DONo);

        if (!groups.has(doNo)) {
            groups.set(doNo, {
                do_no: doNo,
                rows: [],
                detailsByWorksheetId: new Map(),
                errors: [],
                info: [],
                source_row_count: 0,
                skipped_source_rows: 0,
                headerSkipped: false,
                headerIssue: null
            });
        }

        groups.get(doNo).rows.push(row);
    }

    for (const group of groups.values()) {
        group.source_row_count = group.rows.length;

        if (masters.existingDoByNo.has(lookupKey(group.do_no))) {
            const firstRow = group.rows[0];

            addInfo(
                firstRow,
                info,
                "existingDo",
                group.do_no,
                "worksheet_do.do_no already exists; header and details skipped."
            );
            group.headerSkipped = true;
            group.headerIssue = "Existing DO";
            group.skipped_source_rows += group.rows.length;
            continue;
        }

        const firstValidHeaderRow = group.rows.find((row) =>
            row.errors.length === 0 && !row.skip
        );

        if (!firstValidHeaderRow) {
            group.headerSkipped = true;
            group.headerIssue = "Header validation error";
            group.skipped_source_rows += group.rows.length;
            continue;
        }

        group.out_date = firstValidHeaderRow.out_date;
        group.receive_date = firstValidHeaderRow.receive_date;
        group.receive_month = firstValidHeaderRow.receive_month;
        group.receive_year = firstValidHeaderRow.receive_year;
        group.is_stock_processed = firstValidHeaderRow.is_stock_processed;

        const headerFields = [
            ["OutDate", "out_date"],
            ["DateReceive", "receive_date"],
            ["MonthOD", "receive_month"],
            ["YearOD", "receive_year"],
            ["Update", "is_stock_processed"]
        ];

        for (const [label, key] of headerFields) {
            const values = [
                ...new Set(
                    group.rows
                        .filter((row) => row.errors.length === 0 && !row.skip)
                        .map((row) => row[key])
                )
            ];

            if (values.length > 1) {
                addInfo(
                    firstValidHeaderRow,
                    info,
                    "headerConsistency",
                    `${group.do_no} / ${label}`,
                    `Inconsistent ${label} inside DO; first valid value used for preview.`
                );
            }
        }

        for (const row of group.rows) {
            if (row.errors.length > 0 || row.skip) {
                group.skipped_source_rows++;
                continue;
            }

            const resolved = resolveWorksheetItem(row, masters, info);

            if (!resolved) {
                group.skipped_source_rows++;
                continue;
            }

            const detailKey = String(resolved.worksheet.worksheet_master_id);

            if (!group.detailsByWorksheetId.has(detailKey)) {
                group.detailsByWorksheetId.set(detailKey, {
                    do_no: group.do_no,
                    worksheet_master_id: resolved.worksheet.worksheet_master_id,
                    subject_code: resolved.subject.subject_code,
                    level_master_id: resolved.level.level_master_id,
                    level_code: resolved.level.level_code,
                    worksheet_no: resolved.worksheet.worksheet_no,
                    quantity: 0,
                    source_id_kumon_ws: row.source_id_kumon_ws,
                    source_id_receive_ws: row.source_id_receive_ws,
                    source_type: row.source_type,
                    source_row_count: 0,
                    info: []
                });
            }

            const detail = group.detailsByWorksheetId.get(detailKey);

            detail.quantity += row.quantity;
            detail.source_row_count++;

            if (detail.source_row_count > 1) {
                detail.info.push("Duplicate DO + worksheet item aggregated by quantity.");
            }
        }
    }

    return {
        groups
    };
}

function buildHeaderRows(groups) {
    return [...groups.values()]
        .filter((group) => !group.headerSkipped && group.detailsByWorksheetId.size > 0)
        .map((group, index) => ({
            row_number: index + 1,
            preview_status: "READY",
            header_action: "INSERT",
            worksheet_do_id: null,
            do_no: group.do_no,
            out_date: group.out_date,
            receive_date: group.receive_date,
            receive_month: group.receive_month,
            receive_year: group.receive_year,
            is_stock_processed: group.is_stock_processed,
            source_row_count: group.source_row_count,
            detail_count: group.detailsByWorksheetId.size
        }));
}

function buildDetailRows(groups, masters, info) {
    const rows = [];

    for (const group of groups.values()) {
        if (group.headerSkipped || group.detailsByWorksheetId.size === 0) {
            continue;
        }

        for (const detail of group.detailsByWorksheetId.values()) {
            if (masters.existingReceiveKeys.has(
                masterKey(detail.do_no, detail.worksheet_master_id)
            )) {
                const issueRow = {
                    csv_row: null,
                    do_no: detail.do_no,
                    source_id_receive_ws: detail.source_id_receive_ws,
                    source_id_kumon_ws: detail.source_id_kumon_ws,
                    source_subject_code: detail.subject_code,
                    source_level: detail.level_code,
                    source_level_ws: detail.worksheet_no
                };

                addIssue(
                    info.existingReceive,
                    `${detail.do_no} / ${detail.worksheet_master_id}`,
                    issueRow,
                    "worksheet_receive row already exists; detail skipped."
                );
                continue;
            }

            rows.push({
                row_number: rows.length + 1,
                preview_status: "READY",
                detail_action: "INSERT",
                worksheet_receive_id: null,
                worksheet_do_id: null,
                do_no: detail.do_no,
                worksheet_master_id: detail.worksheet_master_id,
                subject_code: detail.subject_code,
                level_master_id: detail.level_master_id,
                level_code: detail.level_code,
                worksheet_no: detail.worksheet_no,
                quantity: detail.quantity,
                source_id_kumon_ws: detail.source_id_kumon_ws,
                source_id_receive_ws: detail.source_id_receive_ws,
                source_type: detail.source_type,
                source_row_count: detail.source_row_count,
                issue_summary: [...new Set(detail.info)].join(" | ") || null
            });
        }
    }

    return rows;
}

function summaryValue(summary, label) {
    return summary.find((item) => item.label === label)?.value ?? 0;
}

export async function previewWorksheetReceive() {
    const csvText = fs.readFileSync(csvPath, "utf8");
    const records = parse(csvText, {
        columns: SOURCE_COLUMNS,
        skip_empty_lines: true,
        bom: true,
        relax_quotes: true,
        relax_column_count: true
    });
    const masters = await loadMasterData();
    const issues = {
        required: new Map(),
        date: new Map(),
        number: new Map()
    };
    const info = {
        unsupportedType: new Map(),
        fakeDo: new Map(),
        missingMaster: new Map(),
        existingDo: new Map(),
        existingReceive: new Map(),
        headerConsistency: new Map(),
        booleanDefaults: new Map(),
        invalidBoolean: new Map()
    };
    const sourceRows = records.map((record, index) =>
        parseSourceRow(buildSourceRow(record, index + 1), issues, info)
    );
    const { groups } = buildGroups(sourceRows, masters, info);
    const headerRows = buildHeaderRows(groups);
    const detailRows = buildDetailRows(groups, masters, info);
    const errorCounts = countIssueMaps(issues);
    const infoCounts = countIssueMaps(info);
    const errorTotal = Object.values(errorCounts)
        .reduce((sum, count) => sum + count, 0);
    const warningTotal = 0;
    const groupedSourceRows = [...groups.values()]
        .reduce((sum, group) => sum + group.source_row_count, 0);
    const skipped = records.length - detailRows.reduce(
        (sum, row) => sum + row.source_row_count,
        0
    );
    const summary = [
        { label: "Records", value: records.length },
        { label: "Worksheet Source Rows", value: groupedSourceRows },
        { label: "DO Groups", value: groups.size },
        { label: "New DO Headers", value: headerRows.length },
        { label: "New Details", value: detailRows.length },
        { label: "Skipped", value: skipped },
        { label: "Errors", value: errorTotal },
        { label: "Warnings", value: warningTotal },
        { label: "Non-WS Type", value: infoCounts.unsupportedType },
        { label: "Fake DO", value: infoCounts.fakeDo },
        { label: "Missing Master", value: infoCounts.missingMaster },
        { label: "Existing DO", value: infoCounts.existingDo },
        { label: "Existing Details", value: infoCounts.existingReceive },
        { label: "Header Consistency Info", value: infoCounts.headerConsistency },
        { label: "Boolean Defaults", value: infoCounts.booleanDefaults },
        { label: "Invalid Boolean", value: infoCounts.invalidBoolean },
        { label: "Worksheet Master Rows", value: masters.worksheetMasterCount },
        { label: "Target DO Table Exists", value: masters.doTableExists ? "YES" : "NO" },
        { label: "Target Receive Table Exists", value: masters.receiveTableExists ? "YES" : "NO" }
    ];

    return {
        module: "worksheet-receive",
        title: "Worksheet Receive",
        status: statusFromIssueCounts(errorTotal, warningTotal),
        summary,
        validation: [
            validationItem("Required Fields", errorCounts.required),
            validationItem("Date Fields", errorCounts.date),
            validationItem("Number Fields", errorCounts.number),
            validationItem("Worksheet Master Lookup", 0, infoCounts.missingMaster),
            validationItem("Non-WS Type", 0, infoCounts.unsupportedType),
            validationItem("Fake DO", 0, infoCounts.fakeDo),
            validationItem("Existing DO", 0, infoCounts.existingDo),
            validationItem("Existing Receive Detail", 0, infoCounts.existingReceive),
            validationItem("Header Consistency", 0, infoCounts.headerConsistency),
            validationItem("Boolean Defaults", 0, infoCounts.booleanDefaults),
            validationItem("Invalid Boolean", 0, infoCounts.invalidBoolean),
            tableMissingItem("worksheet_do Target Table", !masters.doTableExists),
            tableMissingItem("worksheet_receive Target Table", !masters.receiveTableExists)
        ],
        columns: DETAIL_COLUMNS,
        rows: detailRows,
        pagination: buildPagination(detailRows),
        tables: [
            {
                id: "worksheet_do_headers",
                title: "Worksheet DO Headers",
                columns: HEADER_COLUMNS,
                rows: headerRows,
                pagination: buildPagination(headerRows)
            },
            {
                id: "worksheet_receive_details",
                title: "Worksheet Receive Details",
                columns: DETAIL_COLUMNS,
                rows: detailRows,
                pagination: buildPagination(detailRows)
            }
        ],
        csvRecords: records.length,
        outputRows: summaryValue(summary, "New Details"),
        lookupErrors: errorCounts,
        lookupWarnings: {},
        lookupInfo: infoCounts,
        issueDetails: {
            errors: Object.fromEntries(
                Object.entries(issues).map(([key, value]) => [
                    key,
                    issueList(value)
                ])
            ),
            warnings: {},
            info: Object.fromEntries(
                Object.entries(info).map(([key, value]) => [
                    key,
                    issueList(value)
                ])
            )
        },
        previewRows: detailRows
    };
}

function hasBlockingPreviewError(previewResult) {
    const status = String(previewResult.status || "").toUpperCase();

    if (status === "ERROR" || status === "FAILED") {
        return true;
    }

    return Array.isArray(previewResult.validation) &&
        previewResult.validation.some((item) =>
            String(item.status || "").toUpperCase() === "ERROR"
        );
}

function tableRows(previewResult, tableId) {
    const table = Array.isArray(previewResult.tables)
        ? previewResult.tables.find((item) => item.id === tableId)
        : null;

    return Array.isArray(table?.rows)
        ? table.rows
        : [];
}

async function targetTablesExist(client) {
    const result = await client.query(`
        SELECT
            to_regclass('worksheet_do') AS worksheet_do,
            to_regclass('worksheet_receive') AS worksheet_receive
    `);
    const row = result.rows[0];

    return Boolean(row.worksheet_do && row.worksheet_receive);
}

export async function importWorksheetReceive() {
    const previewResult = await previewWorksheetReceive();
    const headerRows = tableRows(previewResult, "worksheet_do_headers");
    const detailRows = tableRows(previewResult, "worksheet_receive_details");
    const previewSkippedCount = summaryValue(previewResult.summary, "Skipped");
    const previewErrorCount = summaryValue(previewResult.summary, "Errors");

    if (hasBlockingPreviewError(previewResult)) {
        return {
            module: "worksheet-receive",
            title: "Worksheet Receive Import",
            status: "ERROR",
            message: "Worksheet Receive import stopped because preview validation has blocking errors.",
            summary: [
                { label: "Inserted DO Headers", value: 0 },
                { label: "Inserted Details", value: 0 },
                { label: "Skipped", value: previewSkippedCount },
                { label: "Errors", value: previewErrorCount || 1 },
                { label: "Preview DO Headers", value: headerRows.length },
                { label: "Preview Details", value: detailRows.length },
                { label: "Non-WS Type", value: summaryValue(previewResult.summary, "Non-WS Type") },
                { label: "Missing Master", value: summaryValue(previewResult.summary, "Missing Master") },
                { label: "Existing DO", value: summaryValue(previewResult.summary, "Existing DO") },
                { label: "Existing Details", value: summaryValue(previewResult.summary, "Existing Details") }
            ],
            validation: previewResult.validation,
            columns: [],
            rows: [],
            pagination: buildPagination([]),
            insertedHeaderCount: 0,
            insertedDetailCount: 0,
            skippedCount: previewSkippedCount,
            errorCount: previewErrorCount || 1
        };
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        if (!(await targetTablesExist(client))) {
            await client.query("ROLLBACK");

            return {
                module: "worksheet-receive",
                title: "Worksheet Receive Import",
                status: "ERROR",
                message: "worksheet_do and worksheet_receive tables are required before import.",
                summary: [
                    { label: "Inserted DO Headers", value: 0 },
                    { label: "Inserted Details", value: 0 },
                    { label: "Skipped", value: previewSkippedCount },
                    { label: "Errors", value: 1 },
                    { label: "Preview DO Headers", value: headerRows.length },
                    { label: "Preview Details", value: detailRows.length }
                ],
                validation: [
                    { label: "Target Tables", status: "ERROR", errors: 1 }
                ],
                columns: [],
                rows: [],
                pagination: buildPagination([]),
                insertedHeaderCount: 0,
                insertedDetailCount: 0,
                skippedCount: previewSkippedCount,
                errorCount: 1
            };
        }

        const detailRowsByDoNo = new Map();

        for (const detail of detailRows) {
            if (!detailRowsByDoNo.has(detail.do_no)) {
                detailRowsByDoNo.set(detail.do_no, []);
            }

            detailRowsByDoNo.get(detail.do_no).push(detail);
        }

        const importRows = [];
        let insertedHeaderCount = 0;
        let insertedDetailCount = 0;
        let skippedHeaderCount = 0;
        let skippedDetailCount = 0;

        for (const header of headerRows) {
            const headerResult = await client.query(
                `
                    INSERT INTO worksheet_do (
                        do_no,
                        out_date,
                        receive_date,
                        receive_month,
                        receive_year,
                        is_stock_processed
                    )
                    VALUES ($1, $2, $3, $4, $5, $6)
                    ON CONFLICT (do_no) DO NOTHING
                    RETURNING worksheet_do_id
                `,
                [
                    header.do_no,
                    header.out_date,
                    header.receive_date,
                    header.receive_month,
                    header.receive_year,
                    header.is_stock_processed
                ]
            );

            if (headerResult.rowCount === 0) {
                const skippedDetails = detailRowsByDoNo.get(header.do_no) || [];

                skippedHeaderCount++;
                skippedDetailCount += skippedDetails.length;
                importRows.push({
                    row_number: importRows.length + 1,
                    action: "SKIP",
                    do_no: header.do_no,
                    worksheet_do_id: null,
                    worksheet_receive_id: null,
                    worksheet_master_id: null,
                    quantity: null,
                    message: "Existing worksheet_do.do_no; header and details skipped."
                });
                continue;
            }

            const worksheetDoId = headerResult.rows[0].worksheet_do_id;

            insertedHeaderCount++;
            importRows.push({
                row_number: importRows.length + 1,
                action: "INSERT HEADER",
                do_no: header.do_no,
                worksheet_do_id: worksheetDoId,
                worksheet_receive_id: null,
                worksheet_master_id: null,
                quantity: null,
                message: "Inserted worksheet_do header."
            });

            for (const detail of detailRowsByDoNo.get(header.do_no) || []) {
                const detailResult = await client.query(
                    `
                        INSERT INTO worksheet_receive (
                            worksheet_do_id,
                            worksheet_master_id,
                            quantity
                        )
                        VALUES ($1, $2, $3)
                        ON CONFLICT (worksheet_do_id, worksheet_master_id) DO NOTHING
                        RETURNING worksheet_receive_id
                    `,
                    [
                        worksheetDoId,
                        detail.worksheet_master_id,
                        detail.quantity
                    ]
                );

                if (detailResult.rowCount === 0) {
                    skippedDetailCount++;
                    importRows.push({
                        row_number: importRows.length + 1,
                        action: "SKIP DETAIL",
                        do_no: detail.do_no,
                        worksheet_do_id: worksheetDoId,
                        worksheet_receive_id: null,
                        worksheet_master_id: detail.worksheet_master_id,
                        quantity: detail.quantity,
                        message: "Existing worksheet_receive detail."
                    });
                    continue;
                }

                insertedDetailCount++;
                importRows.push({
                    row_number: importRows.length + 1,
                    action: "INSERT DETAIL",
                    do_no: detail.do_no,
                    worksheet_do_id: worksheetDoId,
                    worksheet_receive_id: detailResult.rows[0].worksheet_receive_id,
                    worksheet_master_id: detail.worksheet_master_id,
                    quantity: detail.quantity,
                    message: "Inserted worksheet_receive detail."
                });
            }
        }

        await client.query("COMMIT");

        return {
            module: "worksheet-receive",
            title: "Worksheet Receive Import",
            status: "READY",
            summary: [
                { label: "Inserted DO Headers", value: insertedHeaderCount },
                { label: "Inserted Details", value: insertedDetailCount },
                { label: "Skipped", value: previewSkippedCount + skippedHeaderCount + skippedDetailCount },
                { label: "Errors", value: 0 },
                { label: "Preview DO Headers", value: headerRows.length },
                { label: "Preview Details", value: detailRows.length },
                { label: "Non-WS Type", value: summaryValue(previewResult.summary, "Non-WS Type") },
                { label: "Missing Master", value: summaryValue(previewResult.summary, "Missing Master") },
                { label: "Existing DO", value: summaryValue(previewResult.summary, "Existing DO") },
                { label: "Existing Details", value: summaryValue(previewResult.summary, "Existing Details") }
            ],
            validation: [
                { label: "Preview Validation", status: "READY", errors: 0 },
                { label: "Transaction", status: "READY", errors: 0 }
            ],
            columns: [
                { key: "row_number", label: "#" },
                { key: "action", label: "Action" },
                { key: "do_no", label: "DO No." },
                { key: "worksheet_do_id", label: "Worksheet DO ID" },
                { key: "worksheet_receive_id", label: "Worksheet Receive ID" },
                { key: "worksheet_master_id", label: "Worksheet Master ID" },
                { key: "quantity", label: "Quantity" },
                { key: "message", label: "Message" }
            ],
            rows: importRows,
            pagination: buildPagination(importRows),
            insertedHeaderCount,
            insertedDetailCount,
            skippedCount: previewSkippedCount + skippedHeaderCount + skippedDetailCount,
            errorCount: 0
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
