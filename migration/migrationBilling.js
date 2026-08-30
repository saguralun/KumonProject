import path from "path";
import { fileURLToPath } from "url";
import pool from "../config/db.js";
import {
    buildPagination,
    statusFromIssueCounts
} from "./migrationPreviewCommon.js";
import {
    emptyImportResult,
    hasBlockingPreviewError,
    readSourceRecords,
    summaryValue,
    tableRows
} from "./migrationImportCommon.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const csvPath = path.join(__dirname, "tblKumonPaid.txt");

// tblKumonPaid.txt has no header row (Access "Export - Text File" export) —
// this is the column order from the original tblKumonPaid.csv header.
const SOURCE_COLUMNS = [
    "IDPaid",
    "ID",
    "Prefix",
    "FirstName",
    "LastName",
    "NickName",
    "Sex",
    "School",
    "Class",
    "Money",
    "HalfMonth",
    "FreeStudy",
    "FreeEnrolment",
    "Discount",
    "FullExemption",
    "Payment",
    "Telephone",
    "Subject1",
    "Level",
    "LevelZ",
    "Status",
    "DatePaid",
    "MonthPaid",
    "YearPaid",
    "No1",
    "BookNo"
];

const ISSUE_SAMPLE_COUNT = 5;
const ZUN_FALLBACK_SUBJECT_CODE = "ME";
const DRAFT_LEVEL_FALLBACK_CODE_BY_SUBJECT = new Map([
    ["me", "6A"],
    ["efl", "7A"],
    ["trp", "7A"]
]);

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

function parseDateToAd(value, label) {
    const text = clean(value);

    if (!text) {
        return {
            value: null,
            error: `${label} is required.`
        };
    }

    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);

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

    if (parsed.value < 1900 || parsed.value > 2500) {
        return {
            value: parsed.value,
            error: `${label} is outside expected range: ${parsed.value}`
        };
    }

    return parsed;
}

function parseMoney(value, label, options = {}) {
    const text = clean(value).replace(/,/g, "");

    if (!text) {
        if (options.blankAsZero) {
            return {
                value: 0,
                error: null
            };
        }

        return {
            value: null,
            error: `${label} is required.`
        };
    }

    if (!/^-?\d+(\.\d+)?$/.test(text)) {
        return {
            value: null,
            error: `${label} must be numeric: ${clean(value)}`
        };
    }

    return {
        value: Number(text),
        error: null
    };
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

function normalizeStatusName(value) {
    const status = clean(value);

    if (lookupKey(status) === "enroling in other subject") {
        return "Enrolling in Other Subject";
    }

    if (/^paid month \d{1,2}$/i.test(status)) {
        return "Continue";
    }

    if (lookupKey(status) === "free study") {
        return "Continue";
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
            receipt: row.receipt_key,
            source_id: nullable(row.source_enrollment_id),
            subject: nullable(row.source_subject_code),
            status: nullable(row.source_status),
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

function addError(issues, category, value, row, message) {
    row.errors.push(message);
    addIssue(issues[category], value, row, message);
}

function addWarning(warnings, category, value, row, message) {
    row.warnings.push(message);
    addIssue(warnings[category], value, row, message);
}

function addInfo(info, category, value, row, message) {
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

function paymentMethodForFlag(paymentFlag, masters) {
    if (paymentFlag === true) {
        return masters.paymentMethodsByCode.get("ca") || { payment_method_id: 1 };
    }

    return masters.paymentMethodsByCode.get("tr") || { payment_method_id: 2 };
}

function group2StatusId(flags, statusName) {
    if (flags.halfMonth && flags.freeStudy) {
        return 13;
    }

    if (flags.fullExemption) {
        return 9;
    }

    if (flags.freeEnrolment) {
        return 14;
    }

    if (flags.freeStudy || lookupKey(statusName) === "free study") {
        return 12;
    }

    if (flags.halfMonth) {
        return 11;
    }

    return null;
}

function additionalFeeFromNet(netAmount) {
    if (netAmount === 1600 || netAmount === 1800) {
        return 100;
    }

    if (netAmount === 800 || netAmount === 900) {
        return 50;
    }

    return 0;
}

function draftFallbackLevelBySubject(levelRows) {
    const fallbackLevels = new Map();
    const minLevels = new Map();

    for (const level of levelRows) {
        const preferredCode = DRAFT_LEVEL_FALLBACK_CODE_BY_SUBJECT.get(
            lookupKey(level.subject_code)
        );

        if (
            preferredCode &&
            lookupKey(level.level_code) === lookupKey(preferredCode)
        ) {
            fallbackLevels.set(level.subject_id, level);
        }

        const existing = minLevels.get(level.subject_id);

        if (
            !existing ||
            Number(level.level_master_id) < Number(existing.level_master_id)
        ) {
            minLevels.set(level.subject_id, level);
        }
    }

    for (const [subjectId, level] of minLevels.entries()) {
        if (!fallbackLevels.has(subjectId)) {
            fallbackLevels.set(subjectId, level);
        }
    }

    return fallbackLevels;
}

async function loadMasterData(db = pool) {
    const [
        subjectResult,
        levelResult,
        statusResult,
        paymentMethodResult,
        enrollmentResult,
        billingResult
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
            SELECT status_id, status_code, status_name, status_group
            FROM status_master
            ORDER BY status_id
        `),
        db.query(`
            SELECT payment_method_id, payment_method_code, payment_method_name
            FROM payment_method_master
            ORDER BY payment_method_id
        `),
        db.query(`
            SELECT enrollment_id, student_id, subject_id
            FROM enrollment
            ORDER BY enrollment_id
        `),
        db.query(`
            SELECT billing_id, receipt_book, receipt_no
            FROM billing
            ORDER BY billing_id
        `)
    ]);

    const levelsBySubjectId = new Map();
    const zunLevelsBySubjectId = new Map();

    for (const level of levelResult.rows) {
        if (!levelsBySubjectId.has(level.subject_id)) {
            levelsBySubjectId.set(level.subject_id, []);
        }

        levelsBySubjectId.get(level.subject_id).push(level);

        if (Number(level.level_type) === 2) {
            if (!zunLevelsBySubjectId.has(level.subject_id)) {
                zunLevelsBySubjectId.set(level.subject_id, []);
            }

            zunLevelsBySubjectId.get(level.subject_id).push(level);
        }
    }

    return {
        subjectsByCode: new Map(
            subjectResult.rows.map((subject) => [
                lookupKey(subject.subject_code),
                subject
            ])
        ),
        levelsBySubjectAndCode: new Map(
            levelResult.rows.map((level) => [
                masterKey(level.subject_id, level.level_code),
                level
            ])
        ),
        fallbackLevelBySubjectId: draftFallbackLevelBySubject(levelResult.rows),
        levelCodesBySubjectId: new Map(
            [...levelsBySubjectId.entries()].map(([subjectId, levels]) => [
                subjectId,
                sortedLevelCodes(levels)
            ])
        ),
        zunLevelCodesBySubjectId: new Map(
            [...zunLevelsBySubjectId.entries()].map(([subjectId, levels]) => [
                subjectId,
                sortedLevelCodes(levels)
            ])
        ),
        fallbackZunSubject: subjectResult.rows.find(
            (subject) => subject.subject_code === ZUN_FALLBACK_SUBJECT_CODE
        ),
        statusesByName: new Map(
            statusResult.rows.map((status) => [
                lookupKey(status.status_name),
                status
            ])
        ),
        statusesById: new Map(
            statusResult.rows.map((status) => [
                Number(status.status_id),
                status
            ])
        ),
        paymentMethodsByCode: new Map(
            paymentMethodResult.rows.map((method) => [
                lookupKey(method.payment_method_code),
                method
            ])
        ),
        enrollmentsById: new Map(
            enrollmentResult.rows.map((enrollment) => [
                Number(enrollment.enrollment_id),
                enrollment
            ])
        ),
        existingBillingByReceipt: new Map(
            billingResult.rows.map((billing) => [
                masterKey(billing.receipt_book, billing.receipt_no),
                billing
            ])
        ),
        enrollmentCount: enrollmentResult.rows.length
    };
}

function buildSourceRow(record, csvRow) {
    const receiptBook = parsePositiveInteger(record.BookNo, "receipt_book");
    const receiptNo = parsePositiveInteger(record.No1, "receipt_no");

    return {
        csv_row: csvRow,
        record,
        receipt_book: receiptBook.value,
        receipt_no: receiptNo.value,
        receipt_key: receiptBook.value && receiptNo.value
            ? masterKey(receiptBook.value, receiptNo.value)
            : `invalid-${csvRow}`,
        source_id_paid: nullable(record.IDPaid),
        source_enrollment_id: nullable(record.ID),
        source_subject_code: nullable(record.Subject1),
        source_level: nullable(record.Level),
        source_status: nullable(record.Status),
        errors: [],
        warnings: [],
        info: [],
        receiptBookError: receiptBook.error,
        receiptNoError: receiptNo.error
    };
}

function parseSourceRow(row, issues) {
    const record = row.record;
    const parsed = {
        enrollmentId: parsePositiveInteger(record.ID, "enrollment_id"),
        billingDate: parseDateToAd(record.DatePaid, "DatePaid"),
        billingMonth: parseMonth(record.MonthPaid, "billing_month"),
        billingYear: parseYear(record.YearPaid, "billing_year"),
        money: parseMoney(record.Money, "Money"),
        discount: parseMoney(record.Discount, "Discount", { blankAsZero: true }),
        payment: parseBoolean(record.Payment, "Payment"),
        halfMonth: parseBoolean(record.HalfMonth, "HalfMonth"),
        freeStudy: parseBoolean(record.FreeStudy, "FreeStudy"),
        freeEnrolment: parseBoolean(record.FreeEnrolment, "FreeEnrolment"),
        fullExemption: parseBoolean(record.FullExemption, "FullExemption")
    };

    if (row.receiptBookError) {
        addError(issues, "required", record.BookNo, row, row.receiptBookError);
    }

    if (row.receiptNoError) {
        addError(issues, "required", record.No1, row, row.receiptNoError);
    }

    for (const [key, item] of Object.entries(parsed)) {
        if (!item.error) {
            continue;
        }

        const category = key === "billingDate"
            ? "date"
            : ["payment", "halfMonth", "freeStudy", "freeEnrolment", "fullExemption"].includes(key)
                ? "boolean"
                : ["money", "discount"].includes(key)
                    ? "money"
                    : "required";
        const sourceValueByKey = {
            enrollmentId: record.ID,
            billingDate: record.DatePaid,
            billingMonth: record.MonthPaid,
            billingYear: record.YearPaid,
            money: record.Money,
            discount: record.Discount,
            payment: record.Payment,
            halfMonth: record.HalfMonth,
            freeStudy: record.FreeStudy,
            freeEnrolment: record.FreeEnrolment,
            fullExemption: record.FullExemption
        };

        addError(issues, category, sourceValueByKey[key], row, item.error);
    }

    row.parsed = {
        enrollment_id: parsed.enrollmentId.value,
        billing_date: parsed.billingDate.value,
        billing_month: parsed.billingMonth.value,
        billing_year: parsed.billingYear.value,
        money: parsed.money.value,
        discount: parsed.discount.value,
        payment: parsed.payment.value,
        half_month: parsed.halfMonth.value,
        free_study: parsed.freeStudy.value,
        free_enrolment: parsed.freeEnrolment.value,
        full_exemption: parsed.fullExemption.value
    };

    return row;
}

function isRegisterRow(row) {
    return lookupKey(row.record.Status) === "paid for register";
}

function isSubjectRow(row) {
    return clean(row.record.Subject1) && !isRegisterRow(row);
}

function consistentValue(rows, getter) {
    const values = [...new Set(rows
        .map(getter)
        .filter((value) => value !== null && value !== undefined && value !== ""))];

    return {
        value: values[0] ?? null,
        consistent: values.length <= 1,
        values
    };
}

function resolveSubject(row, masters, info) {
    const subject = masters.subjectsByCode.get(lookupKey(row.record.Subject1));

    if (!subject) {
        addInfo(
            info,
            "missingMaster",
            row.record.Subject1,
            row,
            "No matching subject_master.subject_code; receipt skipped."
        );
    }

    return subject || null;
}

function resolveCurrentLevel(row, subject, masters, info) {
    if (!subject) {
        return null;
    }

    const candidateCodes = masters.levelCodesBySubjectId.get(subject.subject_id) || [];
    const parsed = parseLevelCode(row.record.Level, candidateCodes);

    if (parsed.error) {
        const fallbackLevel = masters.fallbackLevelBySubjectId.get(subject.subject_id);

        if (fallbackLevel) {
            addInfo(
                info,
                "draftLevelFallback",
                `${subject.subject_code} / ${clean(row.record.Level) || "(blank)"}`,
                row,
                `${parsed.error}; draft fallback level applied.`
            );

            return {
                ...fallbackLevel,
                level_resolution: "DRAFT FALLBACK"
            };
        }

        addInfo(
            info,
            "missingMaster",
            `${subject.subject_code} / ${clean(row.record.Level)}`,
            row,
            `${parsed.error}; receipt skipped.`
        );

        return null;
    }

    const level = masters.levelsBySubjectAndCode.get(
        masterKey(subject.subject_id, parsed.levelCode)
    );

    if (!level) {
        const fallbackLevel = masters.fallbackLevelBySubjectId.get(subject.subject_id);

        if (fallbackLevel) {
            addInfo(
                info,
                "draftLevelFallback",
                `${subject.subject_code} / ${parsed.levelCode}`,
                row,
                "No matching level_master row; draft fallback level applied."
            );

            return {
                ...fallbackLevel,
                level_resolution: "DRAFT FALLBACK"
            };
        }

        addInfo(
            info,
            "missingMaster",
            `${subject.subject_code} / ${parsed.levelCode}`,
            row,
            "No matching level_master row; receipt skipped."
        );
    }

    return level
        ? {
            ...level,
            level_resolution: "MATCHED"
        }
        : null;
}

function resolveZunLevel(row, subject, masters, info) {
    const rawLevelZ = clean(row.record.LevelZ);

    if (!rawLevelZ || !subject || !masters.fallbackZunSubject) {
        return {
            id: null,
            code: null
        };
    }

    const subjectCandidateCodes =
        masters.zunLevelCodesBySubjectId.get(subject.subject_id) || [];
    let parsed = parseLevelCode(rawLevelZ, subjectCandidateCodes, "ZUN level");
    let level = null;
    let resolvedSubject = subject;

    if (!parsed.error) {
        level = masters.levelsBySubjectAndCode.get(
            masterKey(subject.subject_id, parsed.levelCode)
        );
    }

    if (!level) {
        const fallbackSubject = masters.fallbackZunSubject;
        const fallbackCandidateCodes =
            masters.zunLevelCodesBySubjectId.get(fallbackSubject.subject_id) || [];

        parsed = parseLevelCode(rawLevelZ, fallbackCandidateCodes, "ZUN level");
        resolvedSubject = fallbackSubject;

        if (!parsed.error) {
            level = masters.levelsBySubjectAndCode.get(
                masterKey(fallbackSubject.subject_id, parsed.levelCode)
            );
        }
    }

    if (!level) {
        addInfo(
            info,
            "zunFallback",
            `${subject.subject_code} / ${rawLevelZ}`,
            row,
            "No matching ZUN level_master row; current_zun_level_master_id will be null."
        );

        return {
            id: null,
            code: null
        };
    }

    if (resolvedSubject.subject_id !== subject.subject_id) {
        addInfo(
            info,
            "zunFallback",
            `${subject.subject_code} / ${rawLevelZ}`,
            row,
            `ZUN level resolved through ${resolvedSubject.subject_code}.`
        );
    }

    return {
        id: level.level_master_id,
        code: level.level_code
    };
}

function resolveStatusGroup1(row, masters, issues) {
    const statusName = normalizeStatusName(row.record.Status);
    const status = masters.statusesByName.get(lookupKey(statusName));

    if (!status || Number(status.status_group) !== 1) {
        addError(
            issues,
            "status",
            row.record.Status,
            row,
            "No matching status_master group 1 row."
        );

        return null;
    }

    return status;
}

function noteFlagConflict(row, info, flags) {
    const activeFlags = [
        flags.halfMonth ? "HalfMonth" : null,
        flags.freeStudy ? "FreeStudy" : null,
        flags.freeEnrolment ? "FreeEnrolment" : null,
        flags.fullExemption ? "FullExemption" : null
    ].filter(Boolean);

    if (activeFlags.length <= 1 || (activeFlags.length === 2 && flags.halfMonth && flags.freeStudy)) {
        return;
    }

    addInfo(
        info,
        "conflictingFlags",
        activeFlags.join("+"),
        row,
        "Multiple status flags found; one group 2 status selected by priority."
    );
}

function buildDetailCandidate(row, masters, issues, info) {
    const enrollment = masters.enrollmentsById.get(row.parsed.enrollment_id);

    if (!enrollment) {
        addInfo(
            info,
            "missingEnrollment",
            row.parsed.enrollment_id,
            row,
            "CSV ID has no matching enrollment.enrollment_id; receipt skipped."
        );

        return null;
    }

    const subject = resolveSubject(row, masters, info);
    const currentLevel = resolveCurrentLevel(row, subject, masters, info);
    const currentZunLevel = resolveZunLevel(row, subject, masters, info);
    const statusGroup1 = resolveStatusGroup1(row, masters, issues);

    if (!subject || !currentLevel || !statusGroup1) {
        return null;
    }

    const flags = {
        halfMonth: row.parsed.half_month,
        freeStudy: row.parsed.free_study,
        freeEnrolment: row.parsed.free_enrolment,
        fullExemption: row.parsed.full_exemption
    };
    const statusGroup2Id = group2StatusId(flags, row.record.Status);
    const statusGroup2 = statusGroup2Id
        ? masters.statusesById.get(statusGroup2Id)
        : null;
    const additionalFee = additionalFeeFromNet(row.parsed.money);
    const grossSubjectFee = row.parsed.money + row.parsed.discount;

    noteFlagConflict(row, info, flags);

    return {
        sourceRow: row,
        enrollment,
        enrollment_id: row.parsed.enrollment_id,
        subject_id: subject.subject_id,
        subject_code: subject.subject_code,
        current_level_master_id: currentLevel.level_master_id,
        current_level_code: currentLevel.level_code,
        current_level_resolution: currentLevel.level_resolution,
        source_level: row.source_level,
        current_zun_level_master_id: currentZunLevel.id,
        current_zun_level_code: currentZunLevel.code,
        status_group1_id: statusGroup1.status_id,
        status_group1_name: statusGroup1.status_name,
        status_group2_id: statusGroup2Id,
        status_group2_name: statusGroup2?.status_name || null,
        tuition_fee: grossSubjectFee - additionalFee,
        registration_fee: 0,
        additional_fee: additionalFee,
        discount_amount: row.parsed.discount,
        net_amount: row.parsed.money,
        source_money: row.parsed.money,
        source_discount: row.parsed.discount,
        attached_registration_rows: 0,
        duplicate_count: 0,
        issue_summary: null,
        info: [...row.info],
        warnings: [...row.warnings],
        errors: [...row.errors]
    };
}

function applyRegistrationRows(receipt, detailByEnrollmentId, info) {
    for (const row of receipt.registerRows) {
        const detail = detailByEnrollmentId.get(row.parsed.enrollment_id);

        if (!detail) {
            addInfo(
                info,
                "registrationWithoutDetail",
                row.parsed.enrollment_id,
                row,
                "Registration row has no matching subject detail in the same receipt; row skipped."
            );
            receipt.skippedSourceRows++;
            continue;
        }

        detail.registration_fee += row.parsed.money + row.parsed.discount;
        detail.discount_amount += row.parsed.discount;
        detail.net_amount += row.parsed.money;
        detail.attached_registration_rows++;
        receipt.attachedRegistrationRows++;
    }
}

function finalizeDetail(detail) {
    return {
        ...detail,
        tuition_fee: Number(detail.tuition_fee.toFixed(2)),
        registration_fee: Number(detail.registration_fee.toFixed(2)),
        additional_fee: Number(detail.additional_fee.toFixed(2)),
        discount_amount: Number(detail.discount_amount.toFixed(2)),
        net_amount: Number(detail.net_amount.toFixed(2)),
        source_money: Number(detail.source_money.toFixed(2)),
        source_discount: Number(detail.source_discount.toFixed(2)),
        issue_summary: [
            ...detail.errors,
            ...detail.warnings,
            ...detail.info
        ].join(" | ") || null
    };
}

function buildReceiptPreview(receipt, masters, issues, warnings, info) {
    const firstRow = receipt.rows[0];
    const existingBilling = masters.existingBillingByReceipt.get(receipt.key);

    receipt.skippedSourceRows = 0;
    receipt.attachedRegistrationRows = 0;

    if (receipt.rows.some((row) => row.errors.length > 0)) {
        receipt.error = true;
        receipt.skippedSourceRows += receipt.rows.length;
        return [];
    }

    if (existingBilling) {
        addInfo(
            info,
            "existing",
            receipt.key,
            firstRow,
            "Billing receipt already exists; receipt skipped."
        );
        receipt.skippedSourceRows += receipt.rows.length;
        receipt.skipped = true;
        return [];
    }

    const overSubjectLimit = receipt.subjectRows.length > 3;

    if (overSubjectLimit) {
        addInfo(
            info,
            "overSubjectLimit",
            receipt.key,
            firstRow,
            "Receipt has more than 3 subject rows; receipt skipped."
        );
    }

    const headerChecks = [
        ["DatePaid", (row) => row.parsed.billing_date],
        ["MonthPaid", (row) => row.parsed.billing_month],
        ["YearPaid", (row) => row.parsed.billing_year],
        ["Payment", (row) => row.parsed.payment]
    ];

    for (const [label, getter] of headerChecks) {
        const check = consistentValue(receipt.rows, getter);

        if (!check.consistent) {
            addInfo(
                info,
                "receiptConsistency",
                `${receipt.key} / ${label}`,
                firstRow,
                `Inconsistent ${label} inside receipt; receipt skipped.`
            );
            receipt.skippedSourceRows += receipt.rows.length;
            receipt.skipped = true;
            return [];
        }
    }

    if (overSubjectLimit) {
        receipt.skippedSourceRows += receipt.rows.length;
        receipt.skipped = true;
        return [];
    }

    const enrollments = receipt.rows
        .map((row) => masters.enrollmentsById.get(row.parsed.enrollment_id))
        .filter(Boolean);
    const missingEnrollmentRows = receipt.rows.filter((row) =>
        !masters.enrollmentsById.has(row.parsed.enrollment_id)
    );

    if (missingEnrollmentRows.length > 0) {
        for (const row of missingEnrollmentRows) {
            addInfo(
                info,
                "missingEnrollment",
                row.parsed.enrollment_id,
                row,
                "CSV ID has no matching enrollment.enrollment_id; receipt skipped."
            );
        }

        receipt.skippedSourceRows += receipt.rows.length;
        receipt.skipped = true;
        return [];
    }

    const studentIds = [...new Set(enrollments.map((enrollment) => Number(enrollment.student_id)))];

    if (studentIds.length !== 1) {
        addInfo(
            info,
            "inconsistentStudent",
            receipt.key,
            firstRow,
            "Enrollment IDs in receipt resolve to different student_id values; receipt skipped."
        );
        receipt.skippedSourceRows += receipt.rows.length;
        receipt.skipped = true;
        return [];
    }

    const detailByEnrollmentId = new Map();
    const sourceSubjectKeys = new Set();
    const duplicateRows = [];
    let fatalDetailIssue = false;

    for (const row of receipt.subjectRows) {
        const duplicateKey = masterKey(
            row.parsed.enrollment_id,
            row.record.Subject1,
            row.record.Level,
            row.record.LevelZ,
            row.record.Status,
            row.parsed.money,
            row.parsed.discount
        );

        if (sourceSubjectKeys.has(duplicateKey)) {
            duplicateRows.push(row);
            continue;
        }

        sourceSubjectKeys.add(duplicateKey);

        if (detailByEnrollmentId.has(row.parsed.enrollment_id)) {
            addInfo(
                info,
                "duplicateDetail",
                `${receipt.key} / ${row.parsed.enrollment_id}`,
                row,
                "Multiple non-identical subject rows for the same enrollment in receipt; receipt skipped."
            );
            fatalDetailIssue = true;
            continue;
        }

        const beforeInfoCount = Object.values(info)
            .reduce((sum, issueMap) => sum + issueCount(issueMap), 0);
        const candidate = buildDetailCandidate(row, masters, issues, info);
        const afterInfoCount = Object.values(info)
            .reduce((sum, issueMap) => sum + issueCount(issueMap), 0);

        if (!candidate || afterInfoCount > beforeInfoCount && !candidate) {
            fatalDetailIssue = true;
            continue;
        }

        detailByEnrollmentId.set(row.parsed.enrollment_id, candidate);
    }

    for (const row of duplicateRows) {
        addInfo(
            info,
            "duplicate",
            `${receipt.key} / ${row.parsed.enrollment_id}`,
            row,
            "Exact duplicate subject row in receipt; duplicate skipped."
        );
        receipt.skippedSourceRows++;
    }

    if (fatalDetailIssue || detailByEnrollmentId.size === 0) {
        receipt.skippedSourceRows += receipt.rows.length - receipt.skippedSourceRows;
        receipt.skipped = true;
        return [];
    }

    applyRegistrationRows(receipt, detailByEnrollmentId, info);

    const paymentMethod = paymentMethodForFlag(firstRow.parsed.payment, masters);
    const previewNetAmount = [...detailByEnrollmentId.values()]
        .reduce((sum, detail) => sum + detail.net_amount, 0);
    const previewDiscountAmount = [...detailByEnrollmentId.values()]
        .reduce((sum, detail) => sum + detail.discount_amount, 0);
    const sourceNetAmount = receipt.rows
        .reduce((sum, row) => sum + row.parsed.money, 0);
    const sourceDiscountAmount = receipt.rows
        .reduce((sum, row) => sum + row.parsed.discount, 0);

    if (
        Number(previewNetAmount.toFixed(2)) !== Number(sourceNetAmount.toFixed(2)) ||
        Number(previewDiscountAmount.toFixed(2)) !== Number(sourceDiscountAmount.toFixed(2))
    ) {
        addInfo(
            info,
            "totalsReconciliation",
            receipt.key,
            firstRow,
            "Preview totals differ from raw receipt source totals due to skipped source rows."
        );
    }

    receipt.newBill = true;

    return [...detailByEnrollmentId.values()].map((detail) => finalizeDetail({
        row_number: null,
        module: "billing",
        preview_status: "READY",
        billing_action: "INSERT",
        detail_action: "INSERT",
        billing_id: null,
        billing_detail_id: null,
        receipt_book: receipt.receipt_book,
        receipt_no: receipt.receipt_no,
        receipt_key: receipt.key,
        student_id: studentIds[0],
        billing_date: firstRow.parsed.billing_date,
        payment_method_id: paymentMethod.payment_method_id,
        payment_method_code: paymentMethod.payment_method_code || (firstRow.parsed.payment ? "CA" : "TR"),
        payment_method_name: paymentMethod.payment_method_name || null,
        total_amount: Number((previewNetAmount + previewDiscountAmount).toFixed(2)),
        billing_discount_amount: Number(previewDiscountAmount.toFixed(2)),
        billing_net_amount: Number(previewNetAmount.toFixed(2)),
        source_receipt_net_amount: Number(sourceNetAmount.toFixed(2)),
        source_receipt_discount_amount: Number(sourceDiscountAmount.toFixed(2)),
        billing_month: firstRow.parsed.billing_month,
        billing_year: firstRow.parsed.billing_year,
        created_at: null,
        csv_row: detail.sourceRow.csv_row,
        source_id_paid: detail.sourceRow.source_id_paid,
        source_status: detail.sourceRow.source_status,
        source_subject_code: detail.sourceRow.source_subject_code,
        ...detail
    }));
}

function buildGroups(rows) {
    const groups = new Map();

    for (const row of rows) {
        if (!groups.has(row.receipt_key)) {
            groups.set(row.receipt_key, {
                key: row.receipt_key,
                receipt_book: row.receipt_book,
                receipt_no: row.receipt_no,
                rows: [],
                subjectRows: [],
                registerRows: [],
                otherRows: [],
                newBill: false,
                skipped: false,
                error: false,
                skippedSourceRows: 0,
                attachedRegistrationRows: 0
            });
        }

        const group = groups.get(row.receipt_key);

        group.rows.push(row);

        if (isRegisterRow(row)) {
            group.registerRows.push(row);
        } else if (isSubjectRow(row)) {
            group.subjectRows.push(row);
        } else {
            group.otherRows.push(row);
        }
    }

    return groups;
}

function countIssueMaps(issueMaps) {
    return Object.fromEntries(
        Object.entries(issueMaps).map(([key, value]) => [key, issueCount(value)])
    );
}

const BILLING_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "billing_action", label: "Billing Action" },
    { key: "detail_action", label: "Detail Action" },
    { key: "billing_id", label: "Billing ID", defaultValue: "DB default" },
    { key: "billing_detail_id", label: "Billing Detail ID", defaultValue: "DB default" },
    { key: "receipt_book", label: "Receipt Book" },
    { key: "receipt_no", label: "Receipt No." },
    { key: "student_id", label: "Student ID" },
    { key: "billing_date", label: "Billing Date" },
    { key: "payment_method_id", label: "Payment Method ID" },
    { key: "payment_method_code", label: "Payment Method" },
    { key: "billing_month", label: "Month" },
    { key: "billing_year", label: "Year" },
    { key: "total_amount", label: "Billing Total" },
    { key: "billing_discount_amount", label: "Billing Discount" },
    { key: "billing_net_amount", label: "Billing Net" },
    { key: "enrollment_id", label: "Enrollment ID" },
    { key: "subject_code", label: "Subject" },
    { key: "current_level_master_id", label: "Level ID" },
    { key: "current_level_code", label: "Level" },
    { key: "source_level", label: "CSV Level" },
    { key: "current_level_resolution", label: "Level Resolution" },
    { key: "current_zun_level_master_id", label: "ZUN Level ID" },
    { key: "status_group1_id", label: "Status 1 ID" },
    { key: "status_group1_name", label: "Status 1" },
    { key: "status_group2_id", label: "Status 2 ID" },
    { key: "tuition_fee", label: "Tuition" },
    { key: "registration_fee", label: "Registration" },
    { key: "additional_fee", label: "Additional" },
    { key: "discount_amount", label: "Detail Discount" },
    { key: "net_amount", label: "Detail Net" },
    { key: "attached_registration_rows", label: "Attached Register Rows" },
    { key: "csv_row", label: "CSV Row" },
    { key: "issue_summary", label: "Issues" },
    { key: "created_at", label: "Created At", defaultValue: "DB default" }
];

const BILLING_HEADER_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "preview_status", label: "Preview Status" },
    { key: "billing_action", label: "Billing Action" },
    { key: "billing_id", label: "Billing ID", defaultValue: "DB default" },
    { key: "receipt_book", label: "Receipt Book" },
    { key: "receipt_no", label: "Receipt No." },
    { key: "student_id", label: "Student ID" },
    { key: "billing_date", label: "Billing Date" },
    { key: "payment_method_id", label: "Payment Method ID" },
    { key: "payment_method_name", label: "Payment Method" },
    { key: "total_amount", label: "Total Amount" },
    { key: "discount_amount", label: "Discount Amount" },
    { key: "net_amount", label: "Net Amount" },
    { key: "billing_month", label: "Month" },
    { key: "billing_year", label: "Year" },
    { key: "source_row_count", label: "Source Rows" },
    { key: "detail_count", label: "Detail Count" },
    { key: "created_at", label: "Created At", defaultValue: "DB default" }
];

const BILLING_DETAIL_COLUMNS = [
    { key: "row_number", label: "#" },
    { key: "preview_status", label: "Preview Status" },
    { key: "detail_action", label: "Detail Action" },
    { key: "billing_detail_id", label: "Billing Detail ID", defaultValue: "DB default" },
    { key: "receipt_book", label: "Receipt Book" },
    { key: "receipt_no", label: "Receipt No." },
    { key: "billing_id", label: "Billing ID", defaultValue: "DB default / pending" },
    { key: "enrollment_id", label: "Enrollment ID" },
    { key: "current_level_master_id", label: "Level ID" },
    { key: "current_level_code", label: "Level" },
    { key: "source_level", label: "CSV Level" },
    { key: "current_level_resolution", label: "Level Resolution" },
    { key: "current_zun_level_master_id", label: "ZUN Level ID" },
    { key: "current_zun_level_code", label: "ZUN Level" },
    { key: "status_group1_id", label: "Status 1 ID" },
    { key: "status_group1_name", label: "Status 1" },
    { key: "status_group2_id", label: "Status 2 ID" },
    { key: "status_group2_name", label: "Status 2" },
    { key: "tuition_fee", label: "Tuition Fee" },
    { key: "registration_fee", label: "Registration Fee" },
    { key: "additional_fee", label: "Additional Fee" },
    { key: "discount_amount", label: "Discount Amount" },
    { key: "net_amount", label: "Net Amount" },
    { key: "issue_summary", label: "Issues" }
];

function buildBillingHeaderRows(detailRows, receipts) {
    const detailRowsByReceipt = new Map();

    for (const row of detailRows) {
        if (!detailRowsByReceipt.has(row.receipt_key)) {
            detailRowsByReceipt.set(row.receipt_key, []);
        }

        detailRowsByReceipt.get(row.receipt_key).push(row);
    }

    return receipts
        .filter((receipt) => receipt.newBill)
        .map((receipt, index) => {
            const receiptDetails = detailRowsByReceipt.get(receipt.key) || [];
            const firstDetail = receiptDetails[0];

            return {
                row_number: index + 1,
                preview_status: "READY",
                billing_action: "INSERT",
                billing_id: null,
                receipt_book: receipt.receipt_book,
                receipt_no: receipt.receipt_no,
                student_id: firstDetail?.student_id || null,
                billing_date: firstDetail?.billing_date || null,
                payment_method_id: firstDetail?.payment_method_id || null,
                payment_method_name: firstDetail?.payment_method_name || null,
                total_amount: firstDetail?.total_amount ?? null,
                discount_amount: firstDetail?.billing_discount_amount ?? null,
                net_amount: firstDetail?.billing_net_amount ?? null,
                billing_month: firstDetail?.billing_month || null,
                billing_year: firstDetail?.billing_year || null,
                source_row_count: receipt.rows.length,
                detail_count: receiptDetails.length,
                created_at: null
            };
        });
}

export async function previewBilling() {
    const records = readSourceRecords(csvPath, SOURCE_COLUMNS);
    const masters = await loadMasterData();
    const issues = {
        required: new Map(),
        date: new Map(),
        money: new Map(),
        boolean: new Map(),
        status: new Map()
    };
    const warnings = {
        receiptConsistency: new Map(),
        duplicateDetail: new Map()
    };
    const info = {
        existing: new Map(),
        missingEnrollment: new Map(),
        inconsistentStudent: new Map(),
        missingMaster: new Map(),
        duplicate: new Map(),
        registrationWithoutDetail: new Map(),
        conflictingFlags: new Map(),
        totalsReconciliation: new Map(),
        zunFallback: new Map(),
        receiptConsistency: new Map(),
        duplicateDetail: new Map(),
        overSubjectLimit: new Map(),
        draftLevelFallback: new Map()
    };

    const sourceRows = records.map((record, index) =>
        parseSourceRow(buildSourceRow(record, index + 2), issues)
    );
    const groups = buildGroups(sourceRows);
    const previewRows = [];

    for (const receipt of groups.values()) {
        previewRows.push(
            ...buildReceiptPreview(receipt, masters, issues, warnings, info)
        );
    }

    const rows = previewRows.map((row, index) => ({
        ...row,
        row_number: index + 1
    }));
    const errorCounts = countIssueMaps(issues);
    const warningCounts = countIssueMaps(warnings);
    const infoCounts = countIssueMaps(info);
    const errorTotal = Object.values(errorCounts)
        .reduce((sum, count) => sum + count, 0);
    const warningTotal = Object.values(warningCounts)
        .reduce((sum, count) => sum + count, 0);
    const receipts = [...groups.values()];
    const skippedSourceRows = receipts
        .reduce((sum, receipt) => sum + receipt.skippedSourceRows, 0);
    const newBills = receipts.filter((receipt) => receipt.newBill).length;
    const attachedRegistrationRows = receipts
        .reduce((sum, receipt) => sum + receipt.attachedRegistrationRows, 0);
    const headerRows = buildBillingHeaderRows(rows, receipts);
    const detailRows = rows.map((row, index) => ({
        row_number: index + 1,
        preview_status: row.preview_status,
        detail_action: row.detail_action,
        billing_detail_id: row.billing_detail_id,
        receipt_book: row.receipt_book,
        receipt_no: row.receipt_no,
        billing_id: row.billing_id,
        enrollment_id: row.enrollment_id,
        current_level_master_id: row.current_level_master_id,
        current_level_code: row.current_level_code,
        source_level: row.source_level,
        current_level_resolution: row.current_level_resolution,
        current_zun_level_master_id: row.current_zun_level_master_id,
        current_zun_level_code: row.current_zun_level_code,
        status_group1_id: row.status_group1_id,
        status_group1_name: row.status_group1_name,
        status_group2_id: row.status_group2_id,
        status_group2_name: row.status_group2_name,
        tuition_fee: row.tuition_fee,
        registration_fee: row.registration_fee,
        additional_fee: row.additional_fee,
        discount_amount: row.discount_amount,
        net_amount: row.net_amount,
        issue_summary: row.issue_summary
    }));

    return {
        module: "billing",
        title: "Billing",
        status: statusFromIssueCounts(errorTotal, warningTotal),
        summary: [
            { label: "Records", value: records.length },
            { label: "Receipt Groups", value: groups.size },
            { label: "New Bills", value: newBills },
            { label: "New Details", value: rows.length },
            { label: "Skipped", value: skippedSourceRows },
            { label: "Errors", value: errorTotal },
            { label: "Warnings", value: warningTotal },
            { label: "Missing Enrollment", value: infoCounts.missingEnrollment },
            { label: "Missing Master", value: infoCounts.missingMaster },
            { label: "Draft Level Fallback", value: infoCounts.draftLevelFallback },
            { label: "Existing Receipts", value: infoCounts.existing },
            { label: "Exact Duplicates", value: infoCounts.duplicate },
            { label: "Register Attached", value: attachedRegistrationRows },
            { label: "Register Without Detail", value: infoCounts.registrationWithoutDetail },
            { label: "Inconsistent Student", value: infoCounts.inconsistentStudent },
            { label: "Receipt Consistency", value: infoCounts.receiptConsistency },
            { label: "Conflicting Flags", value: infoCounts.conflictingFlags },
            { label: "Receipts > 3 Subjects", value: infoCounts.overSubjectLimit },
            { label: "Totals Reconciliation", value: infoCounts.totalsReconciliation },
            { label: "ZUN Info", value: infoCounts.zunFallback }
        ],
        validation: [
            validationItem("Required Fields", errorCounts.required),
            validationItem("Billing Date", errorCounts.date),
            validationItem("Money Fields", errorCounts.money),
            validationItem("Boolean Fields", errorCounts.boolean),
            validationItem("Status Master", errorCounts.status),
            {
                label: "Draft Level Fallback",
                status: "READY",
                errors: 0,
                defaulted: infoCounts.draftLevelFallback
            },
            {
                label: "Receipt Consistency",
                status: "READY",
                errors: 0,
                skipped: infoCounts.receiptConsistency
            },
            {
                label: "Duplicate Detail Conflict",
                status: "READY",
                errors: 0,
                skipped: infoCounts.duplicateDetail
            },
            {
                label: "Receipts > 3 Subjects",
                status: "READY",
                errors: 0,
                skipped: infoCounts.overSubjectLimit
            },
            {
                label: "Clean Skips",
                status: "READY",
                errors: 0,
                skipped: skippedSourceRows
            }
        ],
        columns: BILLING_COLUMNS,
        rows,
        pagination: buildPagination(rows),
        tables: [
            {
                id: "billing_headers",
                title: "Billing Headers",
                columns: BILLING_HEADER_COLUMNS,
                rows: headerRows,
                pagination: buildPagination(headerRows)
            },
            {
                id: "billing_details",
                title: "Billing Details",
                columns: BILLING_DETAIL_COLUMNS,
                rows: detailRows,
                pagination: buildPagination(detailRows)
            }
        ],
        csvRecords: records.length,
        receiptGroups: groups.size,
        newBills,
        newDetails: rows.length,
        skippedSourceRows,
        lookupErrors: errorCounts,
        lookupWarnings: warningCounts,
        lookupInfo: infoCounts,
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

export async function importBilling() {
    const previewResult = await previewBilling();
    const headerRows = tableRows(previewResult, "billing_headers");
    const detailRows = tableRows(previewResult, "billing_details");
    const skipped = summaryValue(previewResult, "Skipped");
    const errors = summaryValue(previewResult, "Errors");

    if (hasBlockingPreviewError(previewResult)) {
        return emptyImportResult({
            module: "billing",
            title: "Billing Import",
            message: "Billing import stopped because preview validation has blocking errors.",
            previewResult,
            errorCount: errors || 1,
            summary: [
                { label: "Inserted Bills", value: 0 },
                { label: "Inserted Details", value: 0 },
                { label: "Skipped", value: skipped },
                { label: "Errors", value: errors || 1 },
                { label: "Preview Bills", value: headerRows.length },
                { label: "Preview Details", value: detailRows.length }
            ]
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const billingIdByReceipt = new Map();
        const importRows = [];
        let insertedBillCount = 0;
        let insertedDetailCount = 0;
        let skippedBillCount = 0;
        let skippedDetailCount = 0;

        for (const header of headerRows) {
            const receiptKey = masterKey(header.receipt_book, header.receipt_no);
            const insertHeader = await client.query(
                `
                    INSERT INTO billing (
                        receipt_book,
                        receipt_no,
                        student_id,
                        billing_date,
                        payment_method_id,
                        total_amount,
                        discount_amount,
                        net_amount,
                        billing_month,
                        billing_year
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                    ON CONFLICT (receipt_book, receipt_no) DO NOTHING
                    RETURNING billing_id
                `,
                [
                    header.receipt_book,
                    header.receipt_no,
                    header.student_id,
                    header.billing_date,
                    header.payment_method_id,
                    header.total_amount,
                    header.discount_amount,
                    header.net_amount,
                    header.billing_month,
                    header.billing_year
                ]
            );

            if (insertHeader.rowCount === 0) {
                skippedBillCount++;
                continue;
            }

            const billingId = insertHeader.rows[0].billing_id;

            billingIdByReceipt.set(receiptKey, billingId);
            insertedBillCount++;

            if (importRows.length < 1000) {
                importRows.push({
                    row_number: importRows.length + 1,
                    action: "INSERT BILL",
                    billing_id: billingId,
                    receipt_book: header.receipt_book,
                    receipt_no: header.receipt_no,
                    enrollment_id: null,
                    message: "Inserted billing header."
                });
            }
        }

        for (const detail of detailRows) {
            const billingId = billingIdByReceipt.get(
                masterKey(detail.receipt_book, detail.receipt_no)
            );

            if (!billingId) {
                skippedDetailCount++;
                continue;
            }

            const insertDetail = await client.query(
                `
                    INSERT INTO billing_detail (
                        billing_id,
                        enrollment_id,
                        current_level_master_id,
                        current_zun_level_master_id,
                        status_group1_id,
                        status_group2_id,
                        tuition_fee,
                        registration_fee,
                        additional_fee,
                        discount_amount,
                        net_amount
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    ON CONFLICT (billing_id, enrollment_id) DO NOTHING
                    RETURNING billing_detail_id
                `,
                [
                    billingId,
                    detail.enrollment_id,
                    detail.current_level_master_id,
                    detail.current_zun_level_master_id,
                    detail.status_group1_id,
                    detail.status_group2_id,
                    detail.tuition_fee,
                    detail.registration_fee,
                    detail.additional_fee,
                    detail.discount_amount,
                    detail.net_amount
                ]
            );

            if (insertDetail.rowCount === 0) {
                skippedDetailCount++;
                continue;
            }

            insertedDetailCount++;

            if (importRows.length < 1000) {
                importRows.push({
                    row_number: importRows.length + 1,
                    action: "INSERT DETAIL",
                    billing_id: billingId,
                    billing_detail_id: insertDetail.rows[0].billing_detail_id,
                    receipt_book: detail.receipt_book,
                    receipt_no: detail.receipt_no,
                    enrollment_id: detail.enrollment_id,
                    message: "Inserted billing_detail row."
                });
            }
        }

        await client.query("COMMIT");

        return {
            module: "billing",
            title: "Billing Import",
            status: "READY",
            summary: [
                { label: "Inserted Bills", value: insertedBillCount },
                { label: "Inserted Details", value: insertedDetailCount },
                { label: "Skipped", value: skipped + skippedBillCount + skippedDetailCount },
                { label: "Errors", value: 0 },
                { label: "Preview Bills", value: headerRows.length },
                { label: "Preview Details", value: detailRows.length },
                { label: "Draft Level Fallback", value: summaryValue(previewResult, "Draft Level Fallback") },
                { label: "Missing Enrollment", value: summaryValue(previewResult, "Missing Enrollment") },
                { label: "Missing Master", value: summaryValue(previewResult, "Missing Master") },
                { label: "Existing Receipts", value: summaryValue(previewResult, "Existing Receipts") }
            ],
            validation: [
                { label: "Preview Validation", status: "READY", errors: 0 },
                { label: "Transaction", status: "READY", errors: 0 }
            ],
            columns: [
                { key: "row_number", label: "#" },
                { key: "action", label: "Action" },
                { key: "billing_id", label: "Billing ID" },
                { key: "billing_detail_id", label: "Billing Detail ID" },
                { key: "receipt_book", label: "Receipt Book" },
                { key: "receipt_no", label: "Receipt No." },
                { key: "enrollment_id", label: "Enrollment ID" },
                { key: "message", label: "Message" }
            ],
            rows: importRows,
            pagination: buildPagination(importRows),
            insertedBillCount,
            insertedDetailCount,
            skippedCount: skipped + skippedBillCount + skippedDetailCount,
            errorCount: 0
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
