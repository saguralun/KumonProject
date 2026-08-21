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

const ISSUE_SAMPLE_COUNT = 5;

const csvPaths = {
    cd: path.join(__dirname, "tblCD.csv"),
    dt: path.join(__dirname, "tblDT.csv"),
    at: path.join(__dirname, "tblAT.csv")
};

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

    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);

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

function parseNonNegativeInteger(value, label) {
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
            error: `${label} must be a non-negative integer: ${text}`
        };
    }

    const numberValue = Number(text);

    if (!Number.isSafeInteger(numberValue) || numberValue < 0) {
        return {
            value: null,
            error: `${label} must be a non-negative integer: ${text}`
        };
    }

    return {
        value: numberValue,
        error: null
    };
}

function parseDtTime(value) {
    if (!clean(value)) {
        return {
            value: 5,
            error: null,
            defaulted: true
        };
    }

    return {
        ...parseNonNegativeInteger(value, "Time"),
        defaulted: false
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

    if (parsed.value < 1900 || parsed.value > 2500) {
        return {
            value: parsed.value,
            error: `${label} is outside expected range: ${parsed.value}`
        };
    }

    return parsed;
}

function parseBoolean(value, label) {
    const text = lookupKey(value);

    if (["true", "t", "yes", "y", "1"].includes(text)) {
        return {
            value: true,
            error: null
        };
    }

    if (["false", "f", "no", "n", "0"].includes(text)) {
        return {
            value: false,
            error: null
        };
    }

    return {
        value: null,
        error: `${label} must be TRUE or FALSE: ${clean(value) || "(blank)"}`
    };
}

function sortedLevelCodes(levels) {
    return levels
        .map((level) => level.level_code)
        .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

function parseLevelCode(value, candidateCodes, label = "Level") {
    const text = clean(value).toUpperCase();

    if (!text) {
        return {
            levelCode: null,
            error: `${label} is required.`
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
        error: `Cannot derive ${label.toLowerCase()} code from: ${text}`
    };
}

function parseWorksheetReference(value, candidateCodes, label = "StartingPoint") {
    const text = clean(value).toUpperCase();

    if (!text) {
        return {
            levelCode: null,
            worksheetNo: null,
            error: `${label} is required.`
        };
    }

    for (const code of candidateCodes) {
        const suffix = text.slice(code.length);

        if (text.startsWith(code) && /^\d+$/.test(suffix)) {
            return {
                levelCode: code,
                worksheetNo: Number(suffix),
                error: null
            };
        }
    }

    return {
        levelCode: null,
        worksheetNo: null,
        error: `Cannot derive level and worksheet number from: ${text}`
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
            source_id: nullable(row.source_enrollment_id),
            subject: nullable(row.source_subject_code),
            level: nullable(row.source_level),
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

function addRowInfo(row, info, category, value, message) {
    row.info.push(message);
    addIssue(info[category], value, row, message);
}

function validationItem(label, errorCount, warningCount = 0) {
    if (errorCount > 0) {
        return {
            label,
            status: "ERROR",
            errors: errorCount
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

async function loadMasterData(moduleId, db = pool) {
    const [
        subjectResult,
        levelResult,
        worksheetResult,
        enrollmentResult,
        cdMasterResult,
        dtMasterResult,
        atMasterResult,
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
                   lm.level_code,
                   lm.level_type
            FROM level_master lm
            JOIN subject_master sm
                ON sm.subject_id = lm.subject_id
            ORDER BY lm.subject_id, LENGTH(lm.level_code) DESC, lm.level_code
        `),
        db.query(`
            SELECT wm.worksheet_master_id,
                   lm.subject_id,
                   sm.subject_code,
                   lm.level_code,
                   wm.worksheet_no
            FROM worksheet_master wm
            JOIN level_master lm
                ON lm.level_master_id = wm.level_master_id
            JOIN subject_master sm
                ON sm.subject_id = lm.subject_id
            ORDER BY lm.subject_id, lm.level_master_id, wm.worksheet_no
        `),
        db.query(`
            SELECT enrollment_id
            FROM enrollment
            ORDER BY enrollment_id
        `),
        db.query(`
            SELECT cm.cd_master_id,
                   cm.level_master_id,
                   cm.cd_no,
                   lm.subject_id,
                   sm.subject_code,
                   lm.level_code
            FROM cd_master cm
            JOIN level_master lm
                ON lm.level_master_id = cm.level_master_id
            JOIN subject_master sm
                ON sm.subject_id = lm.subject_id
            ORDER BY sm.subject_code, lm.level_code, cm.cd_no
        `),
        db.query(`
            SELECT dm.dt_master_id,
                   dm.subject_id,
                   sm.subject_code,
                   dm.test_level,
                   dm.max_score,
                   dm.max_time
            FROM dt_master dm
            JOIN subject_master sm
                ON sm.subject_id = dm.subject_id
            ORDER BY sm.subject_code, dm.test_level
        `),
        db.query(`
            SELECT am.at_master_id,
                   am.subject_id,
                   sm.subject_code,
                   am.level_master_id,
                   lm.level_code,
                   am.max_score,
                   am.max_time
            FROM at_master am
            JOIN subject_master sm
                ON sm.subject_id = am.subject_id
            JOIN level_master lm
                ON lm.level_master_id = am.level_master_id
            ORDER BY sm.subject_code, lm.level_code
        `),
        db.query(existingQueryForModule(moduleId))
    ]);

    const levelsBySubjectId = new Map();

    for (const level of levelResult.rows) {
        if (!levelsBySubjectId.has(level.subject_id)) {
            levelsBySubjectId.set(level.subject_id, []);
        }

        levelsBySubjectId.get(level.subject_id).push(level);
    }

    const existingKeys = new Set(
        existingResult.rows.map((row) =>
            previewKey(row.enrollment_id, row.master_id, row.used_date)
        )
    );

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
        worksheetsBySubjectLevelNo: new Map(
            worksheetResult.rows.map((worksheet) => [
                masterKey(
                    worksheet.subject_id,
                    worksheet.level_code,
                    worksheet.worksheet_no
                ),
                worksheet
            ])
        ),
        cdMasterByLevelNo: new Map(
            cdMasterResult.rows.map((cdMaster) => [
                masterKey(cdMaster.level_master_id, cdMaster.cd_no),
                cdMaster
            ])
        ),
        dtMasterBySubjectLevel: new Map(
            dtMasterResult.rows.map((dtMaster) => [
                masterKey(dtMaster.subject_id, dtMaster.test_level),
                dtMaster
            ])
        ),
        atMasterBySubjectLevel: new Map(
            atMasterResult.rows.map((atMaster) => [
                masterKey(atMaster.subject_id, atMaster.level_master_id),
                atMaster
            ])
        ),
        enrollmentIds: new Set(
            enrollmentResult.rows.map((row) => Number(row.enrollment_id))
        ),
        existingKeys,
        enrollmentCount: enrollmentResult.rows.length
    };
}

function existingQueryForModule(moduleId) {
    if (moduleId === "cd") {
        return `
            SELECT enrollment_id,
                   cd_master_id AS master_id,
                   cd_date AS used_date
            FROM cd_used
            ORDER BY cd_used_id
        `;
    }

    if (moduleId === "dt") {
        return `
            SELECT enrollment_id,
                   dt_master_id AS master_id,
                   dt_date AS used_date
            FROM dt_used
            ORDER BY dt_used_id
        `;
    }

    return `
        SELECT enrollment_id,
               at_master_id AS master_id,
               at_date AS used_date
        FROM at_used
        ORDER BY at_used_id
    `;
}

function resolveSubject(row, record, masters, warnings) {
    const subject = masters.subjectsByCode.get(lookupKey(record.Subject));

    if (!subject) {
        addRowWarning(
            row,
            warnings,
            "master",
            record.Subject,
            "No matching subject_master.subject_code; row skipped."
        );
        row.import_action = "SKIP";
    }

    return subject || null;
}

function resolveLevel(row, record, subject, masters, warnings, info, options = {}) {
    if (!subject) {
        return null;
    }

    const candidateCodes = masters.levelCodesBySubjectId.get(subject.subject_id) || [];
    const parsedLevel = parseLevelCode(record.Level, candidateCodes);

    if (parsedLevel.error) {
        if (options.missingMasterAsInfo) {
            addRowInfo(
                row,
                info,
                "missingMaster",
                `${subject.subject_code} / ${clean(record.Level)}`,
                `${parsedLevel.error}; row skipped.`
            );
        } else {
            addRowWarning(
                row,
                warnings,
                "master",
                `${subject.subject_code} / ${clean(record.Level)}`,
                `${parsedLevel.error}; row skipped.`
            );
        }

        row.import_action = "SKIP";

        return null;
    }

    const level = masters.levelsBySubjectAndCode.get(
        masterKey(subject.subject_id, parsedLevel.levelCode)
    );

    if (!level) {
        if (options.missingMasterAsInfo) {
            addRowInfo(
                row,
                info,
                "missingMaster",
                `${subject.subject_code} / ${parsedLevel.levelCode}`,
                "No matching level_master row; row skipped."
            );
        } else {
            addRowWarning(
                row,
                warnings,
                "master",
                `${subject.subject_code} / ${parsedLevel.levelCode}`,
                "No matching level_master row; row skipped."
            );
        }

        row.import_action = "SKIP";
    }

    return level || null;
}

function resolveWorksheet(row, record, subject, masters, warnings, info, options = {}) {
    if (!subject) {
        return null;
    }

    const candidateCodes = masters.levelCodesBySubjectId.get(subject.subject_id) || [];
    const parsedWorksheet = parseWorksheetReference(record.StartingPoint, candidateCodes);

    row.source_starting_point = nullable(record.StartingPoint);
    row.starting_level_code = parsedWorksheet.levelCode;
    row.starting_worksheet_no = parsedWorksheet.worksheetNo;

    if (parsedWorksheet.error) {
        if (options.missingMasterAsInfo) {
            addRowInfo(
                row,
                info,
                "missingMaster",
                `${subject.subject_code} / ${clean(record.StartingPoint)}`,
                `${parsedWorksheet.error}; row skipped.`
            );
        } else {
            addRowWarning(
                row,
                warnings,
                "master",
                `${subject.subject_code} / ${clean(record.StartingPoint)}`,
                `${parsedWorksheet.error}; row skipped.`
            );
        }

        row.import_action = "SKIP";

        return null;
    }

    const worksheet = masters.worksheetsBySubjectLevelNo.get(
        masterKey(subject.subject_id, parsedWorksheet.levelCode, parsedWorksheet.worksheetNo)
    );

    if (!worksheet) {
        if (options.missingMasterAsInfo) {
            addRowInfo(
                row,
                info,
                "missingMaster",
                `${subject.subject_code} / ${parsedWorksheet.levelCode}${parsedWorksheet.worksheetNo}`,
                "No matching worksheet_master row; row skipped."
            );
        } else {
            addRowWarning(
                row,
                warnings,
                "master",
                `${subject.subject_code} / ${parsedWorksheet.levelCode}${parsedWorksheet.worksheetNo}`,
                "No matching worksheet_master row; row skipped."
            );
        }

        row.import_action = "SKIP";
    }

    return worksheet || null;
}

function applyCommonValidation(
    row,
    record,
    masters,
    issues,
    warnings,
    info,
    dateField,
    dateLabel,
    options = {}
) {
    const enrollmentId = parsePositiveInteger(record.ID, "enrollment_id");
    const usedDate = parseDateToAd(record[dateField], dateLabel);

    row.enrollment_id = enrollmentId.value;
    row[dateFieldToOutputKey(dateField)] = usedDate.value;

    if (enrollmentId.error) {
        addRowError(row, issues, "required", record.ID, enrollmentId.error);
    } else if (!masters.enrollmentIds.has(enrollmentId.value)) {
        if (options.missingEnrollmentAsInfo) {
            addRowInfo(
                row,
                info,
                "missingEnrollment",
                enrollmentId.value,
                "CSV ID has no matching enrollment.enrollment_id; row skipped."
            );
        } else {
            addRowWarning(
                row,
                warnings,
                "enrollment",
                enrollmentId.value,
                "CSV ID has no matching enrollment.enrollment_id; row skipped."
            );
        }

        row.import_action = "SKIP";
    }

    if (usedDate.error) {
        addRowError(row, issues, "date", record[dateField], usedDate.error);
    }
}

function dateFieldToOutputKey(dateField) {
    if (dateField === "DateCD") {
        return "cd_date";
    }

    if (dateField === "DateDT") {
        return "dt_date";
    }

    return "at_date";
}

function addIntegerField(row, issues, recordValue, outputKey, label, parser = parseNonNegativeInteger) {
    const parsed = parser(recordValue, label);

    row[outputKey] = parsed.value;

    if (parsed.error) {
        addRowError(row, issues, "number", recordValue, parsed.error);
    }

    return parsed.value;
}

function addDtTimeField(row, issues, info, recordValue) {
    const parsed = parseDtTime(recordValue);

    row.used_time = parsed.value;

    if (parsed.error) {
        addRowError(row, issues, "number", recordValue, parsed.error);
    }

    if (parsed.defaulted) {
        addRowInfo(
            row,
            info,
            "timeDefaulted",
            "(blank)",
            "Blank Time defaulted to 5."
        );
    }

    return parsed.value;
}

function addBooleanField(row, issues, recordValue, outputKey, label) {
    const parsed = parseBoolean(recordValue, label);

    row[outputKey] = parsed.value;

    if (parsed.error) {
        addRowError(row, issues, "boolean", recordValue, parsed.error);
    }

    return parsed.value;
}

function addAuditWarning(row, warnings, sourceValue, masterValue, label) {
    if (sourceValue === null || masterValue === null || sourceValue === masterValue) {
        return;
    }

    addRowWarning(
        row,
        warnings,
        "audit",
        `${label}: ${sourceValue} / ${masterValue}`,
        `${label} differs from master (${sourceValue} in CSV, ${masterValue} in master).`
    );
}

function buildBaseRow(record, csvRow) {
    return {
        csv_row: csvRow,
        preview_status: "READY",
        source_id_add: nullable(record.IDAdd),
        source_enrollment_id: nullable(record.ID),
        nickname: nullable(record.NickName),
        source_subject_code: nullable(record.Subject),
        source_level: nullable(record.Level),
        duplicate_key: null,
        duplicate_count: 0,
        issue_summary: null,
        import_action: "INSERT",
        errors: [],
        warnings: [],
        info: []
    };
}

function buildCdRow(record, csvRow, masters, issues, warnings, info) {
    const row = {
        ...buildBaseRow(record, csvRow),
        cd_used_id: null,
        cd_master_id: null,
        level_master_id: null,
        level_code: null,
        cd_no: null,
        source_level_ws: nullable(record.LevelWS),
        created_at: null
    };

    applyCommonValidation(
        row,
        record,
        masters,
        issues,
        warnings,
        info,
        "DateCD",
        "DateCD",
        { missingEnrollmentAsInfo: true }
    );

    const cdMonth = parseMonth(record.MonthWS, "cd_month");
    const cdYear = parseYear(record.YearWS, "cd_year");
    row.cd_month = cdMonth.value;
    row.cd_year = cdYear.value;

    if (cdMonth.error) {
        addRowError(row, issues, "number", record.MonthWS, cdMonth.error);
    }

    if (cdYear.error) {
        addRowError(row, issues, "number", record.YearWS, cdYear.error);
    }

    addBooleanField(row, issues, record.CPCD, "cpcd", "CPCD");
    addBooleanField(row, issues, record.CtrStock, "is_stock_processed", "CtrStock");

    const subject = resolveSubject(row, record, masters, warnings);
    const level = resolveLevel(
        row,
        record,
        subject,
        masters,
        warnings,
        info,
        { missingMasterAsInfo: true }
    );
    const cdNo = parsePositiveInteger(record.LevelWS, "LevelWS");

    row.subject_id = subject?.subject_id || null;
    row.subject_code = subject?.subject_code || null;
    row.level_master_id = level?.level_master_id || null;
    row.level_code = level?.level_code || null;
    row.cd_no = cdNo.value;

    if (cdNo.error) {
        addRowError(row, issues, "number", record.LevelWS, cdNo.error);
    } else if (level) {
        const cdMaster = masters.cdMasterByLevelNo.get(
            masterKey(level.level_master_id, cdNo.value)
        );

        if (cdMaster) {
            row.cd_master_id = cdMaster.cd_master_id;
        } else {
            addRowInfo(
                row,
                info,
                "missingMaster",
                `${subject.subject_code} / ${level.level_code} / CD ${cdNo.value}`,
                "No matching cd_master row; row skipped."
            );
            row.import_action = "SKIP";
        }
    }

    row.duplicate_key = previewKey(row.enrollment_id, row.cd_master_id, row.cd_date);

    return row;
}

function buildDtRow(record, csvRow, masters, issues, warnings, info) {
    const row = {
        ...buildBaseRow(record, csvRow),
        dt_used_id: null,
        dt_master_id: null,
        dt_test_level: nullable(record.Level),
        starting_worksheet_master_id: null
    };

    applyCommonValidation(
        row,
        record,
        masters,
        issues,
        warnings,
        info,
        "DateDT",
        "DateDT",
        { missingEnrollmentAsInfo: true }
    );

    addIntegerField(row, issues, record.Score, "score", "Score");
    addDtTimeField(row, issues, info, record.Time);
    addIntegerField(row, issues, record.MaxScore, "source_max_score", "MaxScore");
    addIntegerField(row, issues, record.MaxTime, "source_max_time", "MaxTime");

    const subject = resolveSubject(row, record, masters, warnings);
    const worksheet = resolveWorksheet(
        row,
        record,
        subject,
        masters,
        warnings,
        info,
        { missingMasterAsInfo: true }
    );
    const dtMaster = subject
        ? masters.dtMasterBySubjectLevel.get(masterKey(subject.subject_id, record.Level))
        : null;

    row.subject_id = subject?.subject_id || null;
    row.subject_code = subject?.subject_code || null;
    row.starting_worksheet_master_id = worksheet?.worksheet_master_id || null;

    if (dtMaster) {
        row.dt_master_id = dtMaster.dt_master_id;
        row.master_max_score = dtMaster.max_score;
        row.master_max_time = dtMaster.max_time;
    } else if (subject) {
        addRowWarning(
            row,
            warnings,
            "master",
            `${subject.subject_code} / ${clean(record.Level)}`,
            "No matching dt_master subject_id + test_level; row skipped."
        );
        row.import_action = "SKIP";
    }

    row.duplicate_key = previewKey(row.enrollment_id, row.dt_master_id, row.dt_date);

    return row;
}

function isLegacyAtExcluded(subjectCode, levelCode) {
    const key = masterKey(subjectCode, levelCode);

    return new Set([
        "me|5a",
        "me|6a",
        "me|zi",
        "me|zii",
        "efl|zi",
        "efl|zii",
        "trp|zi",
        "trp|zii"
    ]).has(key);
}

function buildAtRow(record, csvRow, masters, issues, warnings, info) {
    const row = {
        ...buildBaseRow(record, csvRow),
        at_used_id: null,
        at_master_id: null,
        level_master_id: null,
        level_code: null,
        source_cpat: nullable(record.CPAT),
        created_at: null
    };

    applyCommonValidation(
        row,
        record,
        masters,
        issues,
        warnings,
        info,
        "DateAT",
        "DateAT",
        { missingEnrollmentAsInfo: true }
    );

    addIntegerField(row, issues, record.Score, "score", "Score");
    addIntegerField(row, issues, record.Time, "used_time", "Time");
    addIntegerField(row, issues, record.Group, "at_group", "Group");
    addBooleanField(row, issues, record.Pass, "is_pass", "Pass");
    const sourceMaxScore = addIntegerField(row, issues, record.MaxScore, "source_max_score", "MaxScore");
    const sourceMaxTime = addIntegerField(row, issues, record.MaxTime, "source_max_time", "MaxTime");

    const subject = resolveSubject(row, record, masters, warnings);
    if (subject && isLegacyAtExcluded(subject.subject_code, record.Level)) {
        row.subject_id = subject.subject_id;
        row.subject_code = subject.subject_code;
        addRowInfo(
            row,
            info,
            "legacyExcluded",
            `${subject.subject_code} / ${clean(record.Level).toUpperCase()}`,
            "Legacy AT level intentionally excluded; row skipped."
        );
        row.import_action = "SKIP";
        row.duplicate_key = previewKey(row.enrollment_id, row.at_master_id, row.at_date);

        return row;
    }

    const level = resolveLevel(row, record, subject, masters, warnings);

    row.subject_id = subject?.subject_id || null;
    row.subject_code = subject?.subject_code || null;
    row.level_master_id = level?.level_master_id || null;
    row.level_code = level?.level_code || null;

    const atMaster = subject && level
        ? masters.atMasterBySubjectLevel.get(masterKey(subject.subject_id, level.level_master_id))
        : null;

    if (atMaster) {
        row.at_master_id = atMaster.at_master_id;
        row.master_max_score = atMaster.max_score;
        row.master_max_time = atMaster.max_time;
        addAuditWarning(row, warnings, sourceMaxScore, atMaster.max_score, "MaxScore");
        addAuditWarning(row, warnings, sourceMaxTime, atMaster.max_time, "MaxTime");
    } else if (subject && level) {
        addRowWarning(
            row,
            warnings,
            "master",
            `${subject.subject_code} / ${level.level_code}`,
            "No matching at_master subject_id + level_master_id; row skipped."
        );
        row.import_action = "SKIP";
    }

    row.duplicate_key = previewKey(row.enrollment_id, row.at_master_id, row.at_date);

    return row;
}

function applyNewOnlyValidation(rows, masters, warnings, info, options = {}) {
    const rowsByDuplicateKey = new Map();

    for (const row of rows) {
        if (row.errors.length > 0 || row.import_action === "SKIP") {
            continue;
        }

        if (masters.existingKeys.has(row.duplicate_key)) {
            addRowWarning(
                row,
                warnings,
                "existing",
                row.duplicate_key,
                "Target row already exists; row skipped."
            );
            row.import_action = "SKIP";
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

            if (index > 0) {
                if (options.duplicateAsInfo) {
                    addRowInfo(
                        row,
                        info,
                        "duplicate",
                        duplicateKey,
                        "Exact duplicate target row in CSV; duplicate skipped."
                    );
                } else {
                    addRowWarning(
                        row,
                        warnings,
                        "duplicate",
                        duplicateKey,
                        "Exact duplicate target row in CSV; duplicate skipped."
                    );
                }

                row.import_action = "SKIP";
            } else if (!options.duplicateAsInfo) {
                addRowWarning(
                    row,
                    warnings,
                    "duplicate",
                    duplicateKey,
                    "Exact duplicate target row in CSV; first row kept."
                );
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
        const { errors, warnings, info, ...publicRow } = row;

        return {
            ...publicRow,
            preview_status: previewStatus,
            issue_summary: [
                ...errors,
                ...warnings,
                ...info
            ].join(" | ") || null
        };
    });
}

function countSummaries(records, rows, issues, warnings, info) {
    const errorCounts = Object.fromEntries(
        Object.entries(issues).map(([key, value]) => [key, issueCount(value)])
    );
    const warningCounts = Object.fromEntries(
        Object.entries(warnings).map(([key, value]) => [key, issueCount(value)])
    );
    const infoCounts = Object.fromEntries(
        Object.entries(info).map(([key, value]) => [key, issueCount(value)])
    );
    const errorTotal = Object.values(errorCounts)
        .reduce((sum, count) => sum + count, 0);
    const warningTotal = Object.values(warningCounts)
        .reduce((sum, count) => sum + count, 0);
    const newRows = rows.filter((row) =>
        row.import_action === "INSERT" &&
        row.preview_status !== "ERROR"
    );
    const blockedRows = rows.filter((row) => row.preview_status === "ERROR").length;
    const skipped = records.length - newRows.length - blockedRows;

    return {
        errorCounts,
        warningCounts,
        infoCounts,
        errorTotal,
        warningTotal,
        newRows,
        blockedRows,
        skipped
    };
}

async function buildActivityPreview({
    module,
    title,
    csvPath,
    buildRow,
    columns,
    validation,
    summaryDetails,
    newOnlyOptions
}) {
    const csvText = fs.readFileSync(csvPath, "utf8");
    const records = parse(csvText, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        relax_quotes: true,
        relax_column_count: true
    });

    const masters = await loadMasterData(module);
    const issues = {
        required: new Map(),
        date: new Map(),
        number: new Map(),
        boolean: new Map()
    };
    const warnings = {
        enrollment: new Map(),
        master: new Map(),
        duplicate: new Map(),
        existing: new Map(),
        audit: new Map()
    };
    const info = {
        missingEnrollment: new Map(),
        legacyExcluded: new Map(),
        missingMaster: new Map(),
        duplicate: new Map(),
        timeDefaulted: new Map()
    };

    const draftRows = records.map((record, index) =>
        buildRow(record, index + 2, masters, issues, warnings, info)
    );

    applyNewOnlyValidation(draftRows, masters, warnings, info, newOnlyOptions);

    const finalizedRows = finalizeRows(draftRows);
    const counts = countSummaries(records, finalizedRows, issues, warnings, info);
    const rows = counts.newRows.map(({ import_action, ...row }, index) => ({
        row_number: index + 1,
        ...row
    }));

    return {
        module,
        title,
        status: statusFromIssueCounts(counts.errorTotal, counts.warningTotal),
        summary: buildNewOnlySummary({
            records: records.length,
            newRows: rows.length,
            skipped: counts.skipped,
            errors: counts.errorTotal,
            warnings: counts.warningTotal,
            details: summaryDetails ? summaryDetails(counts, masters) : [
                { label: "Missing Enrollment", value: counts.warningCounts.enrollment },
                { label: "Missing Master", value: counts.warningCounts.master },
                { label: "Existing", value: counts.warningCounts.existing },
                { label: "Exact Duplicates", value: counts.warningCounts.duplicate },
                { label: "Audit Warnings", value: counts.warningCounts.audit },
                { label: "Enrollment Rows", value: masters.enrollmentCount }
            ]
        }),
        validation: validation(counts),
        columns,
        rows,
        pagination: buildPagination(rows),
        csvRecords: records.length,
        outputRows: rows.length,
        blockedRows: counts.blockedRows,
        warningRows: finalizedRows
            .filter((row) => row.preview_status === "WARNING")
            .length,
        lookupErrors: counts.errorCounts,
        lookupWarnings: counts.warningCounts,
        lookupInfo: counts.infoCounts,
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
            ),
            info: Object.fromEntries(
                Object.entries(info).map(([key, value]) => [
                    key,
                    issueList(value)
                ])
            )
        },
        previewRows: rows
    };
}

const CD_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "cd_used_id", label: "CD Used ID", defaultValue: "DB default" },
    { key: "enrollment_id", label: "Enrollment ID" },
    { key: "cd_master_id", label: "CD Master ID" },
    { key: "cd_date", label: "CD Date" },
    { key: "cd_month", label: "Month" },
    { key: "cd_year", label: "Year" },
    { key: "cpcd", label: "CPCD" },
    { key: "is_stock_processed", label: "Stock Processed" },
    { key: "source_subject_code", label: "CSV Subject" },
    { key: "level_master_id", label: "Level ID" },
    { key: "level_code", label: "Level" },
    { key: "cd_no", label: "CD No." },
    { key: "source_level_ws", label: "CSV LevelWS" },
    { key: "csv_row", label: "CSV Row" },
    { key: "duplicate_count", label: "Duplicate Count" },
    { key: "issue_summary", label: "Issues" },
    { key: "created_at", label: "Created At", defaultValue: "DB default" }
];

const DT_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "dt_used_id", label: "DT Used ID", defaultValue: "DB default" },
    { key: "enrollment_id", label: "Enrollment ID" },
    { key: "dt_master_id", label: "DT Master ID" },
    { key: "dt_date", label: "DT Date" },
    { key: "score", label: "Score" },
    { key: "used_time", label: "Time" },
    { key: "starting_worksheet_master_id", label: "Starting Worksheet ID" },
    { key: "starting_level_code", label: "Starting Level" },
    { key: "starting_worksheet_no", label: "Starting WS No." },
    { key: "subject_code", label: "Subject" },
    { key: "dt_test_level", label: "DT Level" },
    { key: "source_max_score", label: "CSV MaxScore" },
    { key: "master_max_score", label: "Master MaxScore" },
    { key: "source_max_time", label: "CSV MaxTime" },
    { key: "master_max_time", label: "Master MaxTime" },
    { key: "csv_row", label: "CSV Row" },
    { key: "duplicate_count", label: "Duplicate Count" },
    { key: "issue_summary", label: "Issues" }
];

const AT_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "at_used_id", label: "AT Used ID", defaultValue: "DB default" },
    { key: "enrollment_id", label: "Enrollment ID" },
    { key: "at_master_id", label: "AT Master ID" },
    { key: "at_date", label: "AT Date" },
    { key: "score", label: "Score" },
    { key: "used_time", label: "Time" },
    { key: "at_group", label: "Group" },
    { key: "is_pass", label: "Pass" },
    { key: "subject_code", label: "Subject" },
    { key: "level_master_id", label: "Level ID" },
    { key: "level_code", label: "Level" },
    { key: "source_max_score", label: "CSV MaxScore" },
    { key: "master_max_score", label: "Master MaxScore" },
    { key: "source_max_time", label: "CSV MaxTime" },
    { key: "master_max_time", label: "Master MaxTime" },
    { key: "source_cpat", label: "CSV CPAT" },
    { key: "csv_row", label: "CSV Row" },
    { key: "duplicate_count", label: "Duplicate Count" },
    { key: "issue_summary", label: "Issues" },
    { key: "created_at", label: "Created At", defaultValue: "DB default" }
];

function baseValidationItems(counts) {
    return [
        validationItem("Enrollment FK", 0, counts.warningCounts.enrollment),
        validationItem("Master Lookup", 0, counts.warningCounts.master),
        validationItem("Date", counts.errorCounts.date),
        validationItem("Required ID", counts.errorCounts.required),
        validationItem("Number Fields", counts.errorCounts.number),
        validationItem("Boolean Fields", counts.errorCounts.boolean),
        validationItem("Existing Target Rows", 0, counts.warningCounts.existing),
        validationItem("Exact Duplicate", 0, counts.warningCounts.duplicate),
        validationItem("Audit Fields", 0, counts.warningCounts.audit)
    ];
}

function cdSummaryDetails(counts, masters) {
    return [
        { label: "Missing Enrollment", value: counts.infoCounts.missingEnrollment },
        {
            label: "Missing Master",
            value: counts.infoCounts.missingMaster + counts.warningCounts.master
        },
        { label: "Existing", value: counts.warningCounts.existing },
        { label: "Exact Duplicates", value: counts.infoCounts.duplicate },
        { label: "Audit Warnings", value: counts.warningCounts.audit },
        { label: "Enrollment Rows", value: masters.enrollmentCount }
    ];
}

function cdValidationItems(counts) {
    return [
        validationItem("Enrollment FK", 0),
        {
            label: "CD Master Lookup",
            status: counts.warningCounts.master > 0 ? "WARNING" : "READY",
            errors: 0,
            warnings: counts.warningCounts.master,
            skipped: counts.infoCounts.missingMaster
        },
        validationItem("Date", counts.errorCounts.date),
        validationItem("Required ID", counts.errorCounts.required),
        validationItem("Number Fields", counts.errorCounts.number),
        validationItem("Boolean Fields", counts.errorCounts.boolean),
        validationItem("Existing Target Rows", 0, counts.warningCounts.existing),
        {
            label: "Exact Duplicate",
            status: "READY",
            errors: 0,
            skipped: counts.infoCounts.duplicate
        },
        validationItem("Audit Fields", 0, counts.warningCounts.audit)
    ];
}

function dtSummaryDetails(counts, masters) {
    return [
        { label: "Missing Enrollment", value: counts.infoCounts.missingEnrollment },
        {
            label: "Missing Master",
            value: counts.infoCounts.missingMaster + counts.warningCounts.master
        },
        { label: "Existing", value: counts.warningCounts.existing },
        { label: "Exact Duplicates", value: counts.infoCounts.duplicate },
        { label: "Time Defaulted", value: counts.infoCounts.timeDefaulted },
        { label: "Audit Warnings", value: counts.warningCounts.audit },
        { label: "Enrollment Rows", value: masters.enrollmentCount }
    ];
}

function dtValidationItems(counts) {
    return [
        validationItem("Enrollment FK", 0),
        {
            label: "Starting Worksheet",
            status: "READY",
            errors: 0,
            skipped: counts.infoCounts.missingMaster
        },
        validationItem("DT Master Lookup", 0, counts.warningCounts.master),
        validationItem("Date", counts.errorCounts.date),
        validationItem("Required ID", counts.errorCounts.required),
        validationItem("Number Fields", counts.errorCounts.number),
        validationItem("Boolean Fields", counts.errorCounts.boolean),
        validationItem("Existing Target Rows", 0, counts.warningCounts.existing),
        {
            label: "Exact Duplicate",
            status: "READY",
            errors: 0,
            skipped: counts.infoCounts.duplicate
        },
        {
            label: "Blank Time Default",
            status: "READY",
            errors: 0,
            defaulted: counts.infoCounts.timeDefaulted
        },
        validationItem("Audit Fields", 0, counts.warningCounts.audit)
    ];
}

function atSummaryDetails(counts, masters) {
    return [
        { label: "Missing Enrollment", value: counts.infoCounts.missingEnrollment },
        { label: "Legacy Excluded", value: counts.infoCounts.legacyExcluded },
        { label: "Missing Master", value: counts.warningCounts.master },
        { label: "Existing", value: counts.warningCounts.existing },
        { label: "Exact Duplicates", value: counts.warningCounts.duplicate },
        { label: "Audit Warnings", value: counts.warningCounts.audit },
        { label: "Enrollment Rows", value: masters.enrollmentCount }
    ];
}

function atValidationItems(counts) {
    return [
        validationItem("Enrollment FK", 0),
        {
            label: "Legacy Excluded",
            status: "READY",
            errors: 0,
            skipped: counts.infoCounts.legacyExcluded
        },
        validationItem("Master Lookup", 0, counts.warningCounts.master),
        validationItem("Date", counts.errorCounts.date),
        validationItem("Required ID", counts.errorCounts.required),
        validationItem("Number Fields", counts.errorCounts.number),
        validationItem("Boolean Fields", counts.errorCounts.boolean),
        validationItem("Existing Target Rows", 0, counts.warningCounts.existing),
        validationItem("Exact Duplicate", 0, counts.warningCounts.duplicate),
        validationItem("Audit Fields", 0, counts.warningCounts.audit)
    ];
}

export async function previewCd() {
    return buildActivityPreview({
        module: "cd",
        title: "CD",
        csvPath: csvPaths.cd,
        buildRow: buildCdRow,
        columns: CD_COLUMNS,
        validation: cdValidationItems,
        summaryDetails: cdSummaryDetails,
        newOnlyOptions: { duplicateAsInfo: true }
    });
}

export async function previewDt() {
    return buildActivityPreview({
        module: "dt",
        title: "DT",
        csvPath: csvPaths.dt,
        buildRow: buildDtRow,
        columns: DT_COLUMNS,
        validation: dtValidationItems,
        summaryDetails: dtSummaryDetails,
        newOnlyOptions: { duplicateAsInfo: true }
    });
}

export async function previewAt() {
    return buildActivityPreview({
        module: "at",
        title: "AT",
        csvPath: csvPaths.at,
        buildRow: buildAtRow,
        columns: AT_COLUMNS,
        validation: atValidationItems,
        summaryDetails: atSummaryDetails
    });
}

async function importActivity({
    module,
    title,
    preview,
    tableName,
    columns,
    values
}) {
    const previewResult = await preview();
    const rows = previewResult.rows || [];
    const skipped = summaryValue(previewResult, "Skipped");
    const errors = summaryValue(previewResult, "Errors");

    if (hasBlockingPreviewError(previewResult)) {
        return emptyImportResult({
            module,
            title: `${title} Import`,
            message: `${title} import stopped because preview validation has blocking errors.`,
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
            tableName,
            columns,
            rows,
            values,
            chunkSize: 1000
        });

        await client.query("COMMIT");

        const importRows = rows.slice(0, 1000).map((row, index) => ({
            row_number: index + 1,
            action: "INSERT",
            enrollment_id: row.enrollment_id,
            master_id: row[columns.find((column) => column.endsWith("_master_id"))],
            used_date: row[columns.find((column) => column.endsWith("_date"))],
            message: `Inserted ${tableName} row.`
        }));

        return {
            module,
            title: `${title} Import`,
            status: "READY",
            summary: [
                { label: "Inserted", value: insertedCount },
                { label: "Skipped", value: skipped },
                { label: "Errors", value: 0 },
                { label: "Preview Rows", value: rows.length },
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
                { key: "master_id", label: "Master ID" },
                { key: "used_date", label: "Date" },
                { key: "message", label: "Message" }
            ],
            rows: importRows,
            pagination: buildPagination(importRows),
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

export function importCd() {
    return importActivity({
        module: "cd",
        title: "CD",
        preview: previewCd,
        tableName: "cd_used",
        columns: [
            "enrollment_id",
            "cd_master_id",
            "cd_date",
            "cd_month",
            "cd_year",
            "cpcd",
            "is_stock_processed"
        ],
        values: (row) => [
            row.enrollment_id,
            row.cd_master_id,
            row.cd_date,
            row.cd_month,
            row.cd_year,
            row.cpcd,
            row.is_stock_processed
        ]
    });
}

export function importDt() {
    return importActivity({
        module: "dt",
        title: "DT",
        preview: previewDt,
        tableName: "dt_used",
        columns: [
            "enrollment_id",
            "dt_master_id",
            "dt_date",
            "score",
            "used_time",
            "starting_worksheet_master_id"
        ],
        values: (row) => [
            row.enrollment_id,
            row.dt_master_id,
            row.dt_date,
            row.score,
            row.used_time,
            row.starting_worksheet_master_id
        ]
    });
}

export function importAt() {
    return importActivity({
        module: "at",
        title: "AT",
        preview: previewAt,
        tableName: "at_used",
        columns: [
            "enrollment_id",
            "at_master_id",
            "at_date",
            "score",
            "used_time",
            "at_group",
            "is_pass"
        ],
        values: (row) => [
            row.enrollment_id,
            row.at_master_id,
            row.at_date,
            row.score,
            row.used_time,
            row.at_group,
            row.is_pass
        ]
    });
}
