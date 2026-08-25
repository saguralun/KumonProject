import pool from "../config/db.js";

const TABLE_SCHEMA = "kumon";
const ACTIVE_STATUS_CODES = ["N", "EO", "IT", "R", "C"];
const FREE_COMPLETION_LEVEL_CODES = ["6A", "5A"];
const COMPLETER_LEVEL_BY_SUBJECT = new Map([
    ["ME", "O"],
    ["EFL", "O"],
    ["TRP", "III"]
]);
const DEFAULT_HISTORY_LIMIT = 30;
const MAX_HISTORY_LIMIT = 100;

export const WORKSHEET_PATTERNS = [
    {
        code: "daily20",
        label: "วันละ 20 แผ่น",
        shortLabel: "20/วัน",
        manualCount: 2,
        dayOffsets: [0, 0],
        suffixes: null
    },
    {
        code: "daily10",
        label: "วันละ 10 แผ่น",
        shortLabel: "10/วัน",
        manualCount: 1,
        dayOffsets: [0],
        suffixes: [1]
    },
    {
        code: "twoDays10",
        label: "2 วัน 10 แผ่น",
        shortLabel: "2 วัน",
        manualCount: 1,
        dayOffsets: [0, 1],
        suffixes: [1, 6]
    },
    {
        code: "threeDays10",
        label: "3 วัน 10 แผ่น",
        shortLabel: "3 วัน",
        manualCount: 1,
        dayOffsets: [0, 1, 2],
        suffixes: [1, 5, 8]
    },
    {
        code: "fourDays10",
        label: "4 วัน 10 แผ่น",
        shortLabel: "4 วัน",
        manualCount: 1,
        dayOffsets: [0, 1, 2, 3],
        suffixes: [1, 4, 7, 9]
    },
    {
        code: "fiveDays10",
        label: "5 วัน 10 แผ่น",
        shortLabel: "5 วัน",
        manualCount: 1,
        dayOffsets: [0, 1, 2, 3, 4],
        suffixes: [1, 3, 5, 7, 9]
    }
];

const DEFAULT_PATTERN_CODE = WORKSHEET_PATTERNS[1].code;
const PATTERNS_BY_CODE = new Map(
    WORKSHEET_PATTERNS.map((pattern) => [pattern.code, pattern])
);

function httpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;

    return error;
}

function isCompleterLevel(subjectCode, levelCode) {
    return COMPLETER_LEVEL_BY_SUBJECT.get(subjectCode) === levelCode;
}

function normalizeHistoryLimit(value) {
    const limit = Number(value);

    if (!Number.isInteger(limit) || limit < 1) {
        return DEFAULT_HISTORY_LIMIT;
    }

    return Math.min(limit, MAX_HISTORY_LIMIT);
}

function normalizeSubjectCode(value) {
    const subjectCode = String(value || "ALL").trim().toUpperCase();

    if (["ALL", "ME", "EFL", "TRP"].includes(subjectCode)) {
        return subjectCode;
    }

    return "ALL";
}

function normalizeSearchMode(value) {
    return String(value || "id").toLowerCase() === "name"
        ? "name"
        : "id";
}

function normalizeDate(value) {
    if (value instanceof Date) {
        const year = value.getFullYear();
        const month = String(value.getMonth() + 1).padStart(2, "0");
        const day = String(value.getDate()).padStart(2, "0");

        return `${year}-${month}-${day}`;
    }

    if (typeof value === "string") {
        return value.slice(0, 10);
    }

    return "";
}

function assertIsoDate(value, label) {
    const dateText = normalizeDate(value);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        throw httpError(400, `${label} ไม่ถูกต้อง`);
    }

    return dateText;
}

function addDays(dateText, days) {
    const [year, month, day] = dateText.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    date.setDate(date.getDate() + days);
    const nextYear = date.getFullYear();
    const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
    const nextDay = String(date.getDate()).padStart(2, "0");

    return `${nextYear}-${nextMonth}-${nextDay}`;
}

function dateParts(dateText) {
    const [year, month] = dateText.split("-").map(Number);

    return {
        month,
        year
    };
}

function monthsDaysBetween(startDateText, endDateText) {
    if (!startDateText || !endDateText) {
        return {
            months: 0,
            days: 0,
            label: ""
        };
    }

    const [startYear, startMonth, startDay] = startDateText.split("-").map(Number);
    const [endYear, endMonth, endDay] = endDateText.split("-").map(Number);
    let months = ((endYear - startYear) * 12) + (endMonth - startMonth);
    let anchor = new Date(startYear, startMonth - 1 + months, startDay);
    const endDate = new Date(endYear, endMonth - 1, endDay);

    if (anchor > endDate) {
        months -= 1;
        anchor = new Date(startYear, startMonth - 1 + months, startDay);
    }

    const days = Math.max(0, Math.round((endDate - anchor) / 86400000));
    const parts = [];

    if (months) {
        parts.push(`${months} ${months === 1 ? "month" : "months"}`);
    }

    if (days || !parts.length) {
        parts.push(`${days} ${days === 1 ? "day" : "days"}`);
    }

    return {
        months,
        days,
        label: parts.join(" ")
    };
}

function formatStudentName(row) {
    const firstName = row.first_name || "";
    const lastName = row.last_name || "";
    const nickname = row.nickname ? ` (น้อง${row.nickname})` : "";

    return `${firstName} ${lastName}${nickname}`.trim();
}

function normalizeWorksheetNo(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const numberValue = Number(value);

    if (!Number.isInteger(numberValue) || numberValue < 1) {
        return null;
    }

    return numberValue;
}

function worksheetBaseNo(startNo) {
    return Math.floor((startNo - 1) / 10) * 10;
}

function actualNoFromSuffix(startNo, suffix) {
    return worksheetBaseNo(startNo) + suffix;
}

function patternFromCode(code) {
    return PATTERNS_BY_CODE.get(code) || PATTERNS_BY_CODE.get(DEFAULT_PATTERN_CODE);
}

function mapEnrollment(row) {
    return {
        enrollmentId: row.enrollment_id,
        studentId: row.student_id,
        studentName: formatStudentName(row),
        firstName: row.first_name,
        lastName: row.last_name,
        nickname: row.nickname,
        subjectId: row.subject_id,
        subjectCode: row.subject_code,
        subjectName: row.subject_name,
        currentLevelMasterId: row.current_level_master_id,
        currentLevelCode: row.current_level_code,
        currentZunLevelMasterId: row.current_zun_level_master_id,
        currentZunLevelCode: row.current_zun_level_code,
        startingWorksheetMasterId: row.starting_worksheet_master_id,
        startingWorksheetNo: row.starting_worksheet_no,
        isKumonConnect: row.is_kumon_connect === true,
        statusCode: row.status_code,
        statusName: row.status_name
    };
}

function mapHistoryRow(row) {
    return {
        worksheetUsedId: row.worksheet_used_id,
        enrollmentId: row.enrollment_id,
        worksheetMasterId: row.worksheet_master_id,
        levelMasterId: row.level_master_id,
        levelCode: row.level_code,
        levelType: row.level_type,
        worksheetType: Number(row.level_type) === 2 ? "ZUN" : "WS",
        packetWorksheetNo: row.packet_worksheet_no,
        actualWorksheetNo: row.actual_worksheet_no,
        worksheetLabel: `${row.level_code}${row.actual_worksheet_no}`,
        worksheetDate: normalizeDate(row.worksheet_date),
        worksheetMonth: row.worksheet_month,
        worksheetYear: row.worksheet_year,
        cpws: row.cpws,
        isStockProcessed: row.is_stock_processed,
        createdAt: row.created_at
    };
}

function mapAtAttempt(row) {
    if (!row) {
        return null;
    }

    return {
        atUsedId: row.at_used_id,
        enrollmentId: row.enrollment_id,
        atMasterId: row.at_master_id,
        levelMasterId: row.level_master_id,
        levelCode: row.level_code,
        nextLevelMasterId: row.next_level_master_id,
        nextLevelCode: row.next_level_code,
        atDate: normalizeDate(row.at_date),
        score: row.score,
        usedTime: row.used_time,
        atGroup: row.at_group,
        isPass: row.is_pass,
        maxScore: row.max_score,
        maxTime: row.max_time,
        createdAt: row.created_at
    };
}

async function getEnrollmentRow(enrollmentId, { activeOnly = true } = {}) {
    const activeSql = activeOnly
        ? "AND status.status_code = ANY($2::text[])"
        : "";
    const params = activeOnly
        ? [enrollmentId, ACTIVE_STATUS_CODES]
        : [enrollmentId];
    const result = await pool.query(`
        SELECT
            e.enrollment_id,
            e.student_id,
            e.subject_id,
            e.current_level_master_id,
            e.current_zun_level_master_id,
            e.starting_worksheet_master_id,
            student.first_name,
            student.last_name,
            student.nickname,
            subject.subject_code,
            subject.subject_name,
            current_level.level_code AS current_level_code,
            current_zun.level_code AS current_zun_level_code,
            start_ws.worksheet_no AS starting_worksheet_no,
            COALESCE((to_jsonb(e)->>'is_kumon_connect')::boolean, FALSE) AS is_kumon_connect,
            status.status_code,
            status.status_name
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.student student
            ON student.student_id = e.student_id
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.level_master current_level
            ON current_level.level_master_id = e.current_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.level_master current_zun
            ON current_zun.level_master_id = e.current_zun_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.worksheet_master start_ws
            ON start_ws.worksheet_master_id = e.starting_worksheet_master_id
        JOIN ${TABLE_SCHEMA}.status_master status
            ON status.status_id = e.current_status_group1_id
        WHERE e.enrollment_id = $1
          ${activeSql}
    `, params);

    return result.rows[0] || null;
}

export async function searchEnrollments({
    query = "",
    mode = "id",
    subject = "ALL",
    limit = 20
}) {
    const trimmedQuery = String(query || "").trim();
    const searchMode = normalizeSearchMode(mode);
    const subjectCode = normalizeSubjectCode(subject);
    const pageSize = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const params = [
        ACTIVE_STATUS_CODES
    ];
    const where = [
        "status.status_code = ANY($1::text[])"
    ];

    if (subjectCode !== "ALL") {
        params.push(subjectCode);
        where.push(`subject.subject_code = $${params.length}`);
    }

    if (trimmedQuery) {
        if (searchMode === "id") {
            params.push(`${trimmedQuery}%`);
            where.push(`e.enrollment_id::text LIKE $${params.length}`);
        } else {
            params.push(`%${trimmedQuery}%`);
            where.push(`(
                student.first_name ILIKE $${params.length}
                OR student.last_name ILIKE $${params.length}
                OR COALESCE(student.nickname, '') ILIKE $${params.length}
                OR CONCAT(student.first_name, ' ', student.last_name) ILIKE $${params.length}
            )`);
        }
    }

    params.push(searchMode);
    const modeParamIndex = params.length;
    params.push(pageSize);
    const limitParamIndex = params.length;

    const result = await pool.query(`
        SELECT
            e.enrollment_id,
            e.student_id,
            e.subject_id,
            e.current_level_master_id,
            e.current_zun_level_master_id,
            e.starting_worksheet_master_id,
            student.first_name,
            student.last_name,
            student.nickname,
            subject.subject_code,
            subject.subject_name,
            current_level.level_code AS current_level_code,
            current_zun.level_code AS current_zun_level_code,
            start_ws.worksheet_no AS starting_worksheet_no,
            COALESCE((to_jsonb(e)->>'is_kumon_connect')::boolean, FALSE) AS is_kumon_connect,
            status.status_code,
            status.status_name
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.student student
            ON student.student_id = e.student_id
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.level_master current_level
            ON current_level.level_master_id = e.current_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.level_master current_zun
            ON current_zun.level_master_id = e.current_zun_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.worksheet_master start_ws
            ON start_ws.worksheet_master_id = e.starting_worksheet_master_id
        JOIN ${TABLE_SCHEMA}.status_master status
            ON status.status_id = e.current_status_group1_id
        WHERE ${where.join("\n          AND ")}
        ORDER BY
            CASE WHEN $${modeParamIndex} = 'id' THEN e.enrollment_id END,
            student.first_name,
            student.last_name,
            subject.subject_id
        LIMIT $${limitParamIndex}
    `, params);

    return result.rows.map(mapEnrollment);
}

export async function getIncompleteWorksheetStudents() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth() + 1;
    const cutoffDate = `${year}-${String(month).padStart(2, "0")}-21`;
    const result = await pool.query(`
        WITH latest_ws AS (
            SELECT DISTINCT ON (wu.enrollment_id)
                wu.enrollment_id,
                wu.worksheet_date,
                wu.actual_worksheet_no,
                wm.worksheet_no AS packet_worksheet_no,
                level.level_code
            FROM ${TABLE_SCHEMA}.worksheet_used wu
            JOIN ${TABLE_SCHEMA}.worksheet_master wm
                ON wm.worksheet_master_id = wu.worksheet_master_id
            JOIN ${TABLE_SCHEMA}.level_master level
                ON level.level_master_id = wm.level_master_id
            WHERE level.level_type = 1
            ORDER BY wu.enrollment_id, wu.worksheet_date DESC, wu.worksheet_used_id DESC
        )
        SELECT
            e.enrollment_id,
            COUNT(*) OVER()::int AS total_rows,
            e.student_id,
            student.first_name,
            student.last_name,
            student.nickname,
            subject.subject_code,
            COALESCE((to_jsonb(e)->>'is_kumon_connect')::boolean, FALSE) AS is_kumon_connect,
            current_level.level_code AS current_level_code,
            latest_ws.worksheet_date AS latest_worksheet_date,
            latest_ws.level_code AS latest_level_code,
            latest_ws.actual_worksheet_no AS latest_actual_worksheet_no,
            latest_ws.packet_worksheet_no AS latest_packet_worksheet_no
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.student student
            ON student.student_id = e.student_id
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.level_master current_level
            ON current_level.level_master_id = e.current_level_master_id
        JOIN ${TABLE_SCHEMA}.status_master status
            ON status.status_id = e.current_status_group1_id
        LEFT JOIN latest_ws
            ON latest_ws.enrollment_id = e.enrollment_id
        WHERE status.status_code = ANY($1::text[])
          AND (
              latest_ws.worksheet_date IS NULL
              OR latest_ws.worksheet_date < $2::date
          )
        ORDER BY
            latest_ws.worksheet_date NULLS FIRST,
            student.first_name,
            student.last_name,
            subject.subject_id
        LIMIT 30
    `, [ACTIVE_STATUS_CODES, cutoffDate]);

    return {
        cutoffDate,
        totalRows: Number(result.rows[0]?.total_rows || 0),
        returnedRows: result.rows.length,
        rows: result.rows.map((row) => ({
            enrollmentId: row.enrollment_id,
            studentId: row.student_id,
            studentName: formatStudentName(row),
            subjectCode: row.subject_code,
            currentLevelCode: row.current_level_code,
            isKumonConnect: row.is_kumon_connect === true,
            latestWorksheetDate: normalizeDate(row.latest_worksheet_date),
            latestWorksheetLabel: row.latest_level_code && row.latest_actual_worksheet_no
                ? `${row.latest_level_code}${row.latest_actual_worksheet_no}`
                : "",
            latestPacketWorksheetNo: row.latest_packet_worksheet_no || null
        }))
    };
}

export async function getActiveStudentEnrollments(studentId) {
    const result = await pool.query(`
        SELECT
            e.enrollment_id,
            e.student_id,
            e.subject_id,
            e.current_level_master_id,
            e.current_zun_level_master_id,
            e.starting_worksheet_master_id,
            student.first_name,
            student.last_name,
            student.nickname,
            subject.subject_code,
            subject.subject_name,
            current_level.level_code AS current_level_code,
            current_zun.level_code AS current_zun_level_code,
            start_ws.worksheet_no AS starting_worksheet_no,
            COALESCE((to_jsonb(e)->>'is_kumon_connect')::boolean, FALSE) AS is_kumon_connect,
            status.status_code,
            status.status_name
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.student student
            ON student.student_id = e.student_id
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.level_master current_level
            ON current_level.level_master_id = e.current_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.level_master current_zun
            ON current_zun.level_master_id = e.current_zun_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.worksheet_master start_ws
            ON start_ws.worksheet_master_id = e.starting_worksheet_master_id
        JOIN ${TABLE_SCHEMA}.status_master status
            ON status.status_id = e.current_status_group1_id
        WHERE e.student_id = $1
          AND status.status_code = ANY($2::text[])
        ORDER BY subject.subject_id
    `, [studentId, ACTIVE_STATUS_CODES]);

    return result.rows.map(mapEnrollment);
}

export async function getWorksheetOptions(levelMasterId) {
    if (!levelMasterId) {
        return [];
    }

    const result = await pool.query(`
        SELECT
            worksheet_master_id,
            level_master_id,
            worksheet_no,
            next_worksheet_master_id
        FROM ${TABLE_SCHEMA}.worksheet_master
        WHERE level_master_id = $1
        ORDER BY worksheet_no
    `, [levelMasterId]);

    return result.rows.map((row) => ({
        worksheetMasterId: row.worksheet_master_id,
        levelMasterId: row.level_master_id,
        worksheetNo: row.worksheet_no,
        nextWorksheetMasterId: row.next_worksheet_master_id
    }));
}

async function getDefaultReceiveDate(enrollmentId) {
    const result = await pool.query(`
        SELECT COALESCE(
            (
                SELECT worksheet_date + INTERVAL '1 day'
                FROM ${TABLE_SCHEMA}.worksheet_used
                WHERE enrollment_id = $1
                ORDER BY worksheet_date DESC, worksheet_used_id DESC
                LIMIT 1
            ),
            CURRENT_DATE
        )::date AS default_receive_date
    `, [enrollmentId]);

    return normalizeDate(result.rows[0].default_receive_date);
}

async function getLatestWorksheetNoForLevel(enrollmentId, levelMasterId) {
    if (!levelMasterId) {
        return null;
    }

    const result = await pool.query(`
        SELECT wm.worksheet_no
        FROM ${TABLE_SCHEMA}.worksheet_used wu
        JOIN ${TABLE_SCHEMA}.worksheet_master wm
            ON wm.worksheet_master_id = wu.worksheet_master_id
        WHERE wu.enrollment_id = $1
          AND wm.level_master_id = $2
        ORDER BY wu.worksheet_date DESC, wu.worksheet_used_id DESC
        LIMIT 1
    `, [enrollmentId, levelMasterId]);

    return result.rows[0]?.worksheet_no || null;
}

async function getDefaultWorksheetNo({
    enrollment,
    levelMasterId,
    options
}) {
    const latestWorksheetNo = await getLatestWorksheetNoForLevel(
        enrollment.enrollmentId,
        levelMasterId
    );
    const optionNumbers = new Set(options.map((option) => option.worksheetNo));

    if (optionNumbers.has(latestWorksheetNo)) {
        return latestWorksheetNo;
    }

    if (
        Number(enrollment.currentLevelMasterId) === Number(levelMasterId)
        && optionNumbers.has(enrollment.startingWorksheetNo)
    ) {
        return enrollment.startingWorksheetNo;
    }

    return options[0]?.worksheetNo || null;
}

export async function getHistory(enrollmentId, limit = DEFAULT_HISTORY_LIMIT) {
    const pageSize = normalizeHistoryLimit(limit);
    const result = await pool.query(`
        SELECT
            wu.worksheet_used_id,
            wu.enrollment_id,
            wu.worksheet_master_id,
            wu.actual_worksheet_no,
            wu.worksheet_date,
            wu.worksheet_month,
            wu.worksheet_year,
            wu.cpws,
            wu.is_stock_processed,
            wu.created_at,
            wm.level_master_id,
            wm.worksheet_no AS packet_worksheet_no,
            lm.level_code,
            lm.level_type
        FROM ${TABLE_SCHEMA}.worksheet_used wu
        JOIN ${TABLE_SCHEMA}.worksheet_master wm
            ON wm.worksheet_master_id = wu.worksheet_master_id
        JOIN ${TABLE_SCHEMA}.level_master lm
            ON lm.level_master_id = wm.level_master_id
        WHERE wu.enrollment_id = $1
        ORDER BY wu.worksheet_date DESC, wu.worksheet_used_id DESC
        LIMIT $2
    `, [enrollmentId, pageSize]);

    return result.rows.map(mapHistoryRow);
}

async function getWorksheetPacketSummaryForLevel({
    enrollment,
    levelMasterId,
    levelCode,
    maxWorksheetNo
}) {
    if (!enrollment?.enrollmentId || !levelMasterId) {
        return {
            levelMasterId: levelMasterId || null,
            levelCode: levelCode || "-",
            maxWorksheetNo,
            rows: [],
            totalRecords: 0
        };
    }

    const result = await pool.query(`
        WITH level_rows AS (
            SELECT
                wu.worksheet_date,
                wm.worksheet_no AS packet_worksheet_no
            FROM ${TABLE_SCHEMA}.worksheet_used wu
            JOIN ${TABLE_SCHEMA}.worksheet_master wm
                ON wm.worksheet_master_id = wu.worksheet_master_id
            WHERE wu.enrollment_id = $1
              AND wm.level_master_id = $2
              AND wu.cpws = TRUE
        ),
        bounds AS (
            SELECT MAX(worksheet_date) AS latest_worksheet_date
            FROM level_rows
        ),
        ranged AS (
            SELECT level_rows.*
            FROM level_rows
            CROSS JOIN bounds
            WHERE bounds.latest_worksheet_date IS NOT NULL
              AND level_rows.worksheet_date > bounds.latest_worksheet_date - INTERVAL '1 year'
              AND level_rows.worksheet_date <= bounds.latest_worksheet_date
        ),
        range_bounds AS (
            SELECT
                MIN(worksheet_date) AS first_worksheet_date,
                MAX(worksheet_date) AS latest_worksheet_date
            FROM ranged
        )
        SELECT
            ranged.packet_worksheet_no,
            COUNT(*)::int AS record_count,
            range_bounds.first_worksheet_date,
            range_bounds.latest_worksheet_date
        FROM ranged
        CROSS JOIN range_bounds
        GROUP BY
            ranged.packet_worksheet_no,
            range_bounds.first_worksheet_date,
            range_bounds.latest_worksheet_date
        ORDER BY ranged.packet_worksheet_no
    `, [
        enrollment.enrollmentId,
        levelMasterId
    ]);
    const firstWorksheetDate = normalizeDate(result.rows[0]?.first_worksheet_date);
    const latestWorksheetDate = normalizeDate(result.rows[0]?.latest_worksheet_date);
    const period = monthsDaysBetween(firstWorksheetDate, latestWorksheetDate);
    const rows = result.rows.map((row) => ({
        packetWorksheetNo: Number(row.packet_worksheet_no),
        count: Number(row.record_count)
    }));

    return {
        levelMasterId,
        levelCode: levelCode || "-",
        maxWorksheetNo,
        firstWorksheetDate,
        latestWorksheetDate,
        period,
        rows,
        totalRecords: rows.reduce((sum, row) => sum + row.count, 0)
    };
}

async function getWorksheetPacketSummary(enrollment) {
    const [main, zun] = await Promise.all([
        getWorksheetPacketSummaryForLevel({
            enrollment,
            levelMasterId: enrollment.currentLevelMasterId,
            levelCode: enrollment.currentLevelCode,
            maxWorksheetNo: 200
        }),
        getWorksheetPacketSummaryForLevel({
            enrollment,
            levelMasterId: enrollment.currentZunLevelMasterId,
            levelCode: enrollment.currentZunLevelCode,
            maxWorksheetNo: 100
        })
    ]);

    return {
        active: "main",
        ...main,
        main,
        zun: enrollment.currentZunLevelMasterId ? zun : null
    };
}

export async function getWorksheetMonthSummary({
    enrollmentId,
    billingDate,
    billingMonth,
    billingYear
}) {
    const normalizedEnrollmentId = Number(enrollmentId);

    if (!Number.isInteger(normalizedEnrollmentId) || normalizedEnrollmentId < 1) {
        throw httpError(400, "Enrollment ID ไม่ถูกต้อง");
    }

    const period = normalizeBillingPeriod({
        billingDate: billingDate || normalizeDate(new Date()),
        billingMonth,
        billingYear
    });
    const result = await pool.query(`
        SELECT
            COUNT(*)::int AS total_records,
            COUNT(DISTINCT worksheet_date)::int AS used_days,
            COUNT(*) FILTER (WHERE cpws = TRUE)::int AS cpws_records
        FROM ${TABLE_SCHEMA}.worksheet_used
        WHERE enrollment_id = $1
          AND EXTRACT(MONTH FROM (
                CASE
                    WHEN EXTRACT(DAY FROM worksheet_date) > 20
                    THEN worksheet_date + INTERVAL '1 month'
                    ELSE worksheet_date
                END
              ))::int = $2
          AND EXTRACT(YEAR FROM (
                CASE
                    WHEN EXTRACT(DAY FROM worksheet_date) > 20
                    THEN worksheet_date + INTERVAL '1 month'
                    ELSE worksheet_date
                END
              ))::int = $3
    `, [
        normalizedEnrollmentId,
        period.billingMonth,
        period.billingYear
    ]);
    const row = result.rows[0] || {};

    return {
        billingMonth: period.billingMonth,
        billingYear: period.billingYear,
        totalRecords: Number(row.total_records || 0),
        usedDays: Number(row.used_days || 0),
        cpwsRecords: Number(row.cpws_records || 0)
    };
}

async function getWorksheetProgressForLevel({
    enrollment,
    levelMasterId,
    levelCode,
    maxWorksheetNo
}) {
    if (!enrollment?.enrollmentId || !levelMasterId) {
        return {
            levelCode: levelCode || "-",
            actualWorksheetNo: null,
            displayWorksheetNo: 0,
            maxWorksheetNo,
            percent: 0
        };
    }

    const result = await pool.query(`
        WITH level_cpws AS (
            SELECT
                wu.actual_worksheet_no,
                wu.worksheet_date
            FROM ${TABLE_SCHEMA}.worksheet_used wu
            JOIN ${TABLE_SCHEMA}.worksheet_master wm
                ON wm.worksheet_master_id = wu.worksheet_master_id
            WHERE wu.enrollment_id = $1
              AND wm.level_master_id = $2
              AND wu.cpws = TRUE
        ),
        latest AS (
            SELECT MAX(worksheet_date) AS latest_worksheet_date
            FROM level_cpws
        )
        SELECT MAX(level_cpws.actual_worksheet_no)::int AS max_actual_worksheet_no
        FROM level_cpws
        CROSS JOIN latest
        WHERE level_cpws.worksheet_date >= latest.latest_worksheet_date - INTERVAL '12 months'
    `, [
        enrollment.enrollmentId,
        levelMasterId
    ]);
    const actualWorksheetNo = result.rows[0]?.max_actual_worksheet_no || null;
    const displayWorksheetNo = actualWorksheetNo
        ? Math.min(maxWorksheetNo, Number(actualWorksheetNo) + 9)
        : 0;

    return {
        levelCode: levelCode || "-",
        actualWorksheetNo,
        displayWorksheetNo,
        maxWorksheetNo,
        percent: Math.round((displayWorksheetNo / maxWorksheetNo) * 100)
    };
}

async function getWorksheetProgress(enrollment) {
    const [main, zun] = await Promise.all([
        getWorksheetProgressForLevel({
            enrollment,
            levelMasterId: enrollment.currentLevelMasterId,
            levelCode: enrollment.currentLevelCode,
            maxWorksheetNo: 200
        }),
        getWorksheetProgressForLevel({
            enrollment,
            levelMasterId: enrollment.currentZunLevelMasterId,
            levelCode: enrollment.currentZunLevelCode,
            maxWorksheetNo: 100
        })
    ]);

    return {
        active: enrollment.currentZunLevelMasterId ? "main" : "main",
        main,
        zun: enrollment.currentZunLevelMasterId ? zun : null
    };
}

async function getLevelCompletionState(enrollment) {
    const result = await pool.query(`
        SELECT
            EXISTS (
                SELECT 1
                FROM ${TABLE_SCHEMA}.worksheet_used wu
                JOIN ${TABLE_SCHEMA}.worksheet_master wm
                    ON wm.worksheet_master_id = wu.worksheet_master_id
                WHERE wu.enrollment_id = $1
                  AND wm.level_master_id = $2
                  AND wm.worksheet_no = 191
                  AND wu.cpws = TRUE
            ) AS can_complete_ws_level,
            CASE
                WHEN $3::smallint IS NULL THEN FALSE
                ELSE EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.worksheet_used wu
                    JOIN ${TABLE_SCHEMA}.worksheet_master wm
                        ON wm.worksheet_master_id = wu.worksheet_master_id
                    WHERE wu.enrollment_id = $1
                      AND wm.level_master_id = $3
                      AND wm.worksheet_no = 91
                      AND wu.cpws = TRUE
                )
            END AS can_complete_zun_level,
            at_master.at_master_id,
            at_master.max_score,
            at_master.max_time,
            current_level.level_code AS current_level_code,
            current_level.next_level_master_id,
            next_level.level_code AS next_level_code
        FROM ${TABLE_SCHEMA}.level_master current_level
        LEFT JOIN ${TABLE_SCHEMA}.level_master next_level
            ON next_level.level_master_id = current_level.next_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.at_master at_master
            ON at_master.subject_id = $4
           AND at_master.level_master_id = current_level.level_master_id
        WHERE current_level.level_master_id = $2
    `, [
        enrollment.enrollmentId,
        enrollment.currentLevelMasterId,
        enrollment.currentZunLevelMasterId,
        enrollment.subjectId
    ]);
    const row = result.rows[0] || {};
    const atMasterId = row.at_master_id || null;
    let attemptCount = 0;
    let hasPassed = false;
    let latestAttempt = null;
    let zunCompletion = {
        canComplete: Boolean(row.can_complete_zun_level),
        currentZunLevelMasterId: enrollment.currentZunLevelMasterId,
        currentZunLevelCode: enrollment.currentZunLevelCode,
        nextZunLevelMasterId: null,
        nextZunLevelCode: null,
        isFinal: false
    };

    if (atMasterId) {
        const attemptResult = await pool.query(`
            SELECT
                COUNT(*)::int AS attempt_count,
                COALESCE(BOOL_OR(is_pass), FALSE) AS has_passed
            FROM ${TABLE_SCHEMA}.at_used
            WHERE enrollment_id = $1
              AND at_master_id = $2
        `, [enrollment.enrollmentId, atMasterId]);
        const latestResult = await pool.query(`
            SELECT
                at_used.at_used_id,
                at_used.enrollment_id,
                at_used.at_master_id,
                at_used.at_date,
                at_used.score,
                at_used.used_time,
                at_used.at_group,
                at_used.is_pass,
                at_used.created_at,
                at_master.level_master_id,
                level.level_code,
                level.next_level_master_id,
                next_level.level_code AS next_level_code,
                at_master.max_score,
                at_master.max_time
            FROM ${TABLE_SCHEMA}.at_used at_used
            JOIN ${TABLE_SCHEMA}.at_master at_master
                ON at_master.at_master_id = at_used.at_master_id
            JOIN ${TABLE_SCHEMA}.level_master level
                ON level.level_master_id = at_master.level_master_id
            LEFT JOIN ${TABLE_SCHEMA}.level_master next_level
                ON next_level.level_master_id = level.next_level_master_id
            WHERE at_used.enrollment_id = $1
              AND at_used.at_master_id = $2
            ORDER BY at_used.created_at DESC, at_used.at_used_id DESC
            LIMIT 1
        `, [enrollment.enrollmentId, atMasterId]);

        attemptCount = Number(attemptResult.rows[0]?.attempt_count || 0);
        hasPassed = Boolean(attemptResult.rows[0]?.has_passed);
        latestAttempt = mapAtAttempt(latestResult.rows[0]);
    }

    if (enrollment.currentZunLevelMasterId) {
        const zunResult = await pool.query(`
            SELECT
                current_zun.next_level_master_id,
                next_zun.level_code AS next_level_code
            FROM ${TABLE_SCHEMA}.level_master current_zun
            LEFT JOIN ${TABLE_SCHEMA}.level_master next_zun
                ON next_zun.level_master_id = current_zun.next_level_master_id
            WHERE current_zun.level_master_id = $1
        `, [enrollment.currentZunLevelMasterId]);
        const zunRow = zunResult.rows[0] || {};

        zunCompletion = {
            ...zunCompletion,
            nextZunLevelMasterId: zunRow.next_level_master_id ?? null,
            nextZunLevelCode: zunRow.next_level_code ?? null,
            isFinal: !zunRow.next_level_master_id
        };
    }

    const latestAnyAt = await getLatestAtAttempt(enrollment.enrollmentId);
    const hasWorksheet191 = Boolean(row.can_complete_ws_level);
    const nextLevelMasterId = row.next_level_master_id ?? null;
    const canCompleteWithoutAt = Boolean(
        hasWorksheet191
        && !atMasterId
        && nextLevelMasterId
        && FREE_COMPLETION_LEVEL_CODES.includes(row.current_level_code)
    );
    const canCompleteWsLevel = Boolean(
        (hasWorksheet191 || enrollment.isKumonConnect)
        && atMasterId
        && !hasPassed
    );

    return {
        canCompleteWsLevel,
        canCompleteZunLevel: Boolean(row.can_complete_zun_level),
        atCompletion: {
            canComplete: canCompleteWsLevel,
            hasWorksheet191,
            bypassWorksheet191: Boolean(enrollment.isKumonConnect && !hasWorksheet191),
            hasAtMaster: Boolean(atMasterId),
            hasPassed,
            atMasterId,
            maxScore: row.max_score ?? null,
            maxTime: row.max_time ?? null,
            nextLevelMasterId,
            nextLevelCode: row.next_level_code ?? null,
            attemptCount,
            nextAttemptNo: attemptCount + 1,
            latestAttempt
        },
        freeLevelCompletion: {
            canComplete: canCompleteWithoutAt,
            hasWorksheet191,
            currentLevelMasterId: enrollment.currentLevelMasterId,
            currentLevelCode: row.current_level_code ?? enrollment.currentLevelCode,
            nextLevelMasterId,
            nextLevelCode: row.next_level_code ?? null
        },
        zunCompletion,
        latestAtCompletion: latestAnyAt
    };
}

async function getLatestAtAttempt(enrollmentId) {
    const result = await pool.query(`
        SELECT
            at_used.at_used_id,
            at_used.enrollment_id,
            at_used.at_master_id,
            at_used.at_date,
            at_used.score,
            at_used.used_time,
            at_used.at_group,
            at_used.is_pass,
            at_used.created_at,
            at_master.level_master_id,
            level.level_code,
            level.next_level_master_id,
            next_level.level_code AS next_level_code,
            at_master.max_score,
            at_master.max_time
        FROM ${TABLE_SCHEMA}.at_used at_used
        JOIN ${TABLE_SCHEMA}.at_master at_master
            ON at_master.at_master_id = at_used.at_master_id
        JOIN ${TABLE_SCHEMA}.level_master level
            ON level.level_master_id = at_master.level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.level_master next_level
            ON next_level.level_master_id = level.next_level_master_id
        WHERE at_used.enrollment_id = $1
        ORDER BY at_used.created_at DESC, at_used.at_used_id DESC
        LIMIT 1
    `, [enrollmentId]);

    return mapAtAttempt(result.rows[0]);
}

async function getCdState(enrollment) {
    const mastersResult = await pool.query(`
        SELECT
            cd_master_id,
            level_master_id,
            cd_no
        FROM ${TABLE_SCHEMA}.cd_master
        WHERE level_master_id = $1
        ORDER BY cd_no
    `, [enrollment.currentLevelMasterId]);
    const receivedResult = await pool.query(`
        SELECT
            cd.cd_used_id,
            cd.cd_master_id,
            cd.cd_date,
            cd.cpcd,
            cd.is_stock_processed,
            master.cd_no
        FROM ${TABLE_SCHEMA}.cd_used cd
        JOIN ${TABLE_SCHEMA}.cd_master master
            ON master.cd_master_id = cd.cd_master_id
        WHERE cd.enrollment_id = $1
          AND master.level_master_id = $2
        ORDER BY master.cd_no, cd.cd_date DESC, cd.cd_used_id DESC
    `, [
        enrollment.enrollmentId,
        enrollment.currentLevelMasterId
    ]);
    const receivedCdMasterIds = [
        ...new Set(receivedResult.rows.map((row) => Number(row.cd_master_id)))
    ];

    return {
        hasCdMaster: mastersResult.rows.length > 0,
        hasReceivedCd: receivedCdMasterIds.length > 0,
        availableCds: mastersResult.rows.map((row) => ({
            cdMasterId: row.cd_master_id,
            levelMasterId: row.level_master_id,
            cdNo: row.cd_no
        })),
        receivedCdMasterIds,
        receivedCds: receivedResult.rows.map((row) => ({
            cdUsedId: row.cd_used_id,
            cdMasterId: row.cd_master_id,
            cdNo: row.cd_no,
            cdDate: normalizeDate(row.cd_date),
            cpcd: row.cpcd,
            isStockProcessed: row.is_stock_processed
        }))
    };
}

export async function getEnrollmentContext(enrollmentId, historyLimit) {
    const rawEnrollment = await getEnrollmentRow(enrollmentId);

    if (!rawEnrollment) {
        throw httpError(404, "ไม่พบ enrollment ที่ยังใช้งานอยู่");
    }

    const enrollment = mapEnrollment(rawEnrollment);
    const [
        studentEnrollments,
        mainWorksheetOptions,
        zunWorksheetOptions,
        history,
        worksheetPacketSummary,
        worksheetMonthSummary,
        worksheetProgress,
        defaultReceiveDate,
        completionState,
        cdState
    ] = await Promise.all([
        getActiveStudentEnrollments(enrollment.studentId),
        getWorksheetOptions(enrollment.currentLevelMasterId),
        getWorksheetOptions(enrollment.currentZunLevelMasterId),
        getHistory(enrollment.enrollmentId, historyLimit),
        getWorksheetPacketSummary(enrollment),
        getWorksheetMonthSummary({
            enrollmentId: enrollment.enrollmentId
        }),
        getWorksheetProgress(enrollment),
        getDefaultReceiveDate(enrollment.enrollmentId),
        getLevelCompletionState(enrollment),
        getCdState(enrollment)
    ]);
    const defaultMainWorksheetNo = await getDefaultWorksheetNo({
        enrollment,
        levelMasterId: enrollment.currentLevelMasterId,
        options: mainWorksheetOptions
    });
    const defaultZunWorksheetNo = await getDefaultWorksheetNo({
        enrollment,
        levelMasterId: enrollment.currentZunLevelMasterId,
        options: zunWorksheetOptions
    });

    return {
        enrollment,
        studentEnrollments,
        patterns: WORKSHEET_PATTERNS,
        defaults: {
            receiveDate: defaultReceiveDate,
            patternCode: DEFAULT_PATTERN_CODE,
            mainWorksheetNo: defaultMainWorksheetNo,
            zunWorksheetNo: defaultZunWorksheetNo
        },
        worksheetOptions: {
            main: mainWorksheetOptions,
            zun: zunWorksheetOptions
        },
        history,
        worksheetPacketSummary,
        worksheetMonthSummary,
        worksheetProgress,
        completionState,
        cdState
    };
}

function validateWorksheetNo({
    value,
    optionsByNo,
    label
}) {
    const worksheetNo = normalizeWorksheetNo(value);

    if (!worksheetNo || !optionsByNo.has(worksheetNo)) {
        throw httpError(400, `${label} ต้องเลือกจาก worksheet master เท่านั้น`);
    }

    return worksheetNo;
}

function normalizeWorksheetInputs(values) {
    return Array.isArray(values)
        ? values.map(normalizeWorksheetNo)
        : [];
}

function buildWorksheetRecords({
    enrollmentId,
    receiveDate,
    pattern,
    kind,
    levelMasterId,
    levelCode,
    options,
    worksheetNos,
    required
}) {
    const optionsByNo = new Map(
        options.map((option) => [option.worksheetNo, option])
    );
    const normalizedNos = normalizeWorksheetInputs(worksheetNos);
    const records = [];

    if (pattern.code === "daily20") {
        const expectedCount = 2;
        const selectedNos = normalizedNos.slice(0, expectedCount);
        const hasAnyValue = selectedNos.some(Boolean);

        if (required && selectedNos.filter(Boolean).length < expectedCount) {
            throw httpError(400, `${kind} วันละ 20 แผ่นต้องกรอก 2 ช่อง`);
        }

        if (!required && !hasAnyValue) {
            return records;
        }

        for (let index = 0; index < expectedCount; index += 1) {
            const label = `${kind} ช่อง ${index + 1}`;
            const worksheetNo = validateWorksheetNo({
                value: selectedNos[index],
                optionsByNo,
                label
            });
            const worksheet = optionsByNo.get(worksheetNo);
            const worksheetDate = receiveDate;
            const { month, year } = dateParts(worksheetDate);

            records.push({
                enrollmentId,
                worksheetMasterId: worksheet.worksheetMasterId,
                levelMasterId,
                levelCode,
                actualWorksheetNo: worksheetNo,
                packetWorksheetNo: worksheetNo,
                worksheetDate,
                worksheetMonth: month,
                worksheetYear: year,
                cpws: true,
                isStockProcessed: false
            });
        }

        return records;
    }

    const firstNo = normalizedNos[0];

    if (!firstNo && !required) {
        return records;
    }

    const startNo = validateWorksheetNo({
        value: firstNo,
        optionsByNo,
        label: kind
    });
    const startWorksheet = optionsByNo.get(startNo);

    pattern.suffixes.forEach((suffix, index) => {
        const worksheetDate = addDays(receiveDate, pattern.dayOffsets[index]);
        const actualWorksheetNo = actualNoFromSuffix(startNo, suffix);
        const { month, year } = dateParts(worksheetDate);

        records.push({
            enrollmentId,
            worksheetMasterId: startWorksheet.worksheetMasterId,
            levelMasterId,
            levelCode,
            actualWorksheetNo,
            packetWorksheetNo: startNo,
            worksheetDate,
            worksheetMonth: month,
            worksheetYear: year,
            cpws: index === 0,
            isStockProcessed: false
        });
    });

    return records;
}

function buildReturningQuery() {
    return `
        SELECT
            inserted.worksheet_used_id,
            inserted.enrollment_id,
            inserted.worksheet_master_id,
            inserted.actual_worksheet_no,
            inserted.worksheet_date,
            inserted.worksheet_month,
            inserted.worksheet_year,
            inserted.cpws,
            inserted.is_stock_processed,
            inserted.created_at,
            wm.level_master_id,
            wm.worksheet_no AS packet_worksheet_no,
            lm.level_code,
            lm.level_type
        FROM inserted
        JOIN ${TABLE_SCHEMA}.worksheet_master wm
            ON wm.worksheet_master_id = inserted.worksheet_master_id
        JOIN ${TABLE_SCHEMA}.level_master lm
            ON lm.level_master_id = wm.level_master_id
        ORDER BY inserted.worksheet_date DESC, inserted.worksheet_used_id DESC
    `;
}

async function insertWorksheetRecords(client, records) {
    const columns = [
        "enrollment_id",
        "worksheet_master_id",
        "actual_worksheet_no",
        "worksheet_date",
        "worksheet_month",
        "worksheet_year",
        "cpws",
        "is_stock_processed"
    ];
    const values = [];
    const placeholders = records.map((record) => {
        const rowValues = [
            record.enrollmentId,
            record.worksheetMasterId,
            record.actualWorksheetNo,
            record.worksheetDate,
            record.worksheetMonth,
            record.worksheetYear,
            record.cpws,
            record.isStockProcessed
        ];

        const rowPlaceholders = rowValues.map((value) => {
            values.push(value);

            return `$${values.length}`;
        });

        return `(${rowPlaceholders.join(", ")})`;
    });

    const result = await client.query(`
        WITH inserted AS (
            INSERT INTO ${TABLE_SCHEMA}.worksheet_used (
                ${columns.join(", ")}
            )
            VALUES ${placeholders.join(", ")}
            RETURNING *
        )
        ${buildReturningQuery()}
    `, values);

    return result.rows.map(mapHistoryRow);
}

export async function saveWorksheetEntries(payload) {
    const enrollmentId = Number(payload?.enrollmentId);

    if (!Number.isInteger(enrollmentId) || enrollmentId < 1) {
        throw httpError(400, "Enrollment ID ไม่ถูกต้อง");
    }

    const rawEnrollment = await getEnrollmentRow(enrollmentId);

    if (!rawEnrollment) {
        throw httpError(404, "ไม่พบ enrollment ที่ยังใช้งานอยู่");
    }

    const enrollment = mapEnrollment(rawEnrollment);
    const receiveDate = assertIsoDate(payload.receiveDate, "Receive date");
    const pattern = patternFromCode(payload.patternCode);
    const [mainOptions, zunOptions] = await Promise.all([
        getWorksheetOptions(enrollment.currentLevelMasterId),
        getWorksheetOptions(enrollment.currentZunLevelMasterId)
    ]);
    const mainRecords = buildWorksheetRecords({
        enrollmentId,
        receiveDate,
        pattern,
        kind: "Main WS",
        levelMasterId: enrollment.currentLevelMasterId,
        levelCode: enrollment.currentLevelCode,
        options: mainOptions,
        worksheetNos: payload.mainWorksheetNos,
        required: true
    });
    const zunRecords = enrollment.currentZunLevelMasterId
        ? buildWorksheetRecords({
            enrollmentId,
            receiveDate,
            pattern,
            kind: "Zun",
            levelMasterId: enrollment.currentZunLevelMasterId,
            levelCode: enrollment.currentZunLevelCode,
            options: zunOptions,
            worksheetNos: payload.zunWorksheetNos,
            required: false
        })
        : [];
    const records = [...mainRecords, ...zunRecords];

    if (records.length === 0) {
        throw httpError(400, "ไม่มีรายการ worksheet ให้บันทึก");
    }

    if (enrollment.isKumonConnect) {
        records.forEach((record) => {
            record.cpws = false;
            record.isStockProcessed = false;
        });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const savedRecords = await insertWorksheetRecords(client, records);

        await client.query("COMMIT");

        const latestSavedDate = savedRecords.reduce((latestDate, record) => (
            record.worksheetDate > latestDate
                ? record.worksheetDate
                : latestDate
        ), receiveDate);
        const [completionState, worksheetProgress, worksheetPacketSummary] = await Promise.all([
            getLevelCompletionState(enrollment),
            getWorksheetProgress(enrollment),
            getWorksheetPacketSummary(enrollment)
        ]);

        return {
            success: true,
            records: savedRecords,
            nextReceiveDate: addDays(latestSavedDate, 1),
            completionState,
            worksheetProgress,
            worksheetPacketSummary
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

function normalizeSmallInt(value, label, { min = 0, max = 32767 } = {}) {
    const numberValue = Number(value);

    if (!Number.isInteger(numberValue) || numberValue < min || numberValue > max) {
        throw httpError(400, `${label} ไม่ถูกต้อง`);
    }

    return numberValue;
}

function normalizeBoolean(value, label) {
    if (typeof value === "boolean") {
        return value;
    }

    if (value === "true" || value === "TRUE" || value === "1") {
        return true;
    }

    if (value === "false" || value === "FALSE" || value === "0") {
        return false;
    }

    throw httpError(400, `${label} ไม่ถูกต้อง`);
}

function money(value) {
    return Number(Number(value || 0).toFixed(2));
}

function kumonMonthYearFromDate(dateText) {
    const [year, month, day] = dateText.split("-").map(Number);
    const nextMonth = day > 20 ? month + 1 : month;

    if (nextMonth > 12) {
        return {
            billingMonth: 1,
            billingYear: year + 1
        };
    }

    return {
        billingMonth: nextMonth,
        billingYear: year
    };
}

function normalizeBillingPeriod({
    billingDate,
    billingMonth,
    billingYear
}) {
    const dateText = assertIsoDate(billingDate || normalizeDate(new Date()), "Billing date");
    const parsedMonth = Number(billingMonth);
    const parsedYear = Number(billingYear);

    if (Number.isInteger(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) {
        if (!Number.isInteger(parsedYear) || parsedYear < 2000 || parsedYear > 2600) {
            throw httpError(400, "ปีค่าเรียนไม่ถูกต้อง");
        }

        return {
            billingDate: dateText,
            billingMonth: parsedMonth,
            billingYear: parsedYear
        };
    }

    return {
        billingDate: dateText,
        ...kumonMonthYearFromDate(dateText)
    };
}

function formatBillingPeriod({
    billingMonth,
    billingYear
}) {
    return `${billingMonth}/${billingYear}`;
}

async function insertPaymentEnrollmentStatusHistory(client, receipt) {
    let inserted = 0;

    const paymentDetails = receipt.receiptDetails || receipt.details;

    for (const detail of paymentDetails) {
        const statusCode = String(detail.statusGroup1Code || "").toUpperCase();

        if (!detail.statusGroup1Id || ["C", "CP"].includes(statusCode)) {
            continue;
        }

        const result = await client.query(`
            INSERT INTO ${TABLE_SCHEMA}.enrollment_status (
                enrollment_id,
                status_id,
                status_month,
                status_year
            )
            SELECT $1, $2, $3, $4
            WHERE NOT EXISTS (
                SELECT 1
                FROM ${TABLE_SCHEMA}.enrollment_status existing
                WHERE existing.enrollment_id = $1
                  AND existing.status_id = $2
                  AND existing.status_month = $3
                  AND existing.status_year = $4
            )
            RETURNING enrollment_status_id
        `, [
            detail.enrollmentId,
            detail.statusGroup1Id,
            receipt.billingMonth,
            receipt.billingYear
        ]);

        if (result.rows[0]) {
            inserted += 1;
        }
    }

    return inserted;
}

async function normalizeEnrollmentStatusesAfterPayment(client, receipt) {
    const paymentDetails = receipt.receiptDetails || receipt.details;
    const enrollmentIds = [
        ...new Set(paymentDetails.map((detail) => Number(detail.enrollmentId)).filter(Number.isInteger))
    ];

    if (!enrollmentIds.length) {
        return 0;
    }

    const continueResult = await client.query(`
        SELECT status_id
        FROM ${TABLE_SCHEMA}.status_master
        WHERE status_code = 'C'
          AND status_group = 1
        LIMIT 1
    `);
    const continueStatusId = continueResult.rows[0]?.status_id;

    if (!continueStatusId) {
        throw httpError(500, "ไม่พบ status C");
    }

    const result = await client.query(`
        UPDATE ${TABLE_SCHEMA}.enrollment
        SET current_status_group1_id = $2,
            current_status_group2_id = CASE
                WHEN current_status_group2_id IN (
                    SELECT status_id
                    FROM ${TABLE_SCHEMA}.status_master
                    WHERE status_code = 'F'
                      AND status_group = 2
                )
                THEN current_status_group2_id
                ELSE NULL
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE enrollment_id = ANY($1::int[])
    `, [
        enrollmentIds,
        continueStatusId
    ]);

    return result.rowCount;
}

function calculateReceiptDetailFee({
    center,
    enrollment
}) {
    const fullTuition = money(center.full_tuition);
    const fullRegistrationFee = money(center.registration_fee);
    const fullAdditionalFee = enrollment.additionFee
        ? money(center.addition_full_tuition)
        : 0;
    const statusGroup1Code = enrollment.statusGroup1Code || null;
    const statusGroup2Code = enrollment.statusGroup2Code || null;
    const isFree = ["F", "FS", "FSH"].includes(statusGroup2Code);
    const isHalfMonth = ["H", "FSH"].includes(statusGroup2Code);
    const isNewEnrollment = statusGroup1Code === "N";
    const isFreeRegistration = statusGroup2Code === "FRG";
    const registrationFee = isNewEnrollment ? fullRegistrationFee : 0;
    const registrationDiscount = isNewEnrollment && isFreeRegistration ? fullRegistrationFee : 0;

    if (isFree) {
        return {
            tuitionFee: 0,
            registrationFee,
            additionalFee: 0,
            discountAmount: registrationDiscount,
            netAmount: money(registrationFee - registrationDiscount)
        };
    }

    const tuitionFee = isHalfMonth
        ? money(fullTuition / 2)
        : fullTuition;
    const additionalFee = isHalfMonth
        ? money(fullAdditionalFee / 2)
        : fullAdditionalFee;
    const discountAmount = registrationDiscount;
    const netAmount = money(tuitionFee + registrationFee + additionalFee - discountAmount);

    return {
        tuitionFee,
        registrationFee,
        additionalFee,
        discountAmount,
        netAmount
    };
}

async function getNextReceiptNo({
    billingMonth,
    billingYear,
    client = pool
}) {
    const periodResult = await client.query(`
        SELECT receipt_book
        FROM ${TABLE_SCHEMA}.billing
        WHERE billing_month = $1
          AND billing_year = $2
        ORDER BY receipt_book DESC
        LIMIT 1
    `, [billingMonth, billingYear]);

    if (periodResult.rows[0]) {
        const receiptBook = Number(periodResult.rows[0].receipt_book);
        const receiptNoResult = await client.query(`
            SELECT COALESCE(MAX(receipt_no), 0)::int + 1 AS next_receipt_no
            FROM ${TABLE_SCHEMA}.billing
            WHERE receipt_book = $1
              AND billing_month = $2
              AND billing_year = $3
        `, [receiptBook, billingMonth, billingYear]);

        return {
            receiptBook,
            receiptNo: Number(receiptNoResult.rows[0]?.next_receipt_no || 1)
        };
    }

    const nextBookResult = await client.query(`
        SELECT COALESCE(MAX(receipt_book), 0)::int + 1 AS next_receipt_book
        FROM ${TABLE_SCHEMA}.billing
    `);

    return {
        receiptBook: Number(nextBookResult.rows[0]?.next_receipt_book || 1),
        receiptNo: 1
    };
}

async function buildReceiptPreview({
    enrollmentId,
    billingDate,
    billingMonth,
    billingYear,
    paymentMethodId,
    existingBillingId = null,
    selectedEnrollmentIds = null,
    client = pool
}) {
    const normalizedEnrollmentId = Number(enrollmentId);

    if (!Number.isInteger(normalizedEnrollmentId) || normalizedEnrollmentId < 1) {
        throw httpError(400, "Enrollment ID ไม่ถูกต้อง");
    }

    const period = normalizeBillingPeriod({
        billingDate,
        billingMonth,
        billingYear
    });
    const currentEnrollment = await getEnrollmentRow(normalizedEnrollmentId);

    if (!currentEnrollment) {
        throw httpError(404, "ไม่พบ enrollment ที่ยังใช้งานอยู่");
    }

    const centerResult = await client.query(`
        SELECT *
        FROM ${TABLE_SCHEMA}.center_master
        ORDER BY center_id
        LIMIT 1
    `);
    const center = centerResult.rows[0];

    if (!center) {
        throw httpError(500, "ไม่พบ center master");
    }

    const normalizedPaymentMethodId = paymentMethodId ? Number(paymentMethodId) : null;
    const paymentResult = await client.query(`
        SELECT payment_method_id, payment_method_code, payment_method_name
        FROM ${TABLE_SCHEMA}.payment_method_master
        WHERE ($1::smallint IS NULL AND payment_method_code = 'CA')
           OR payment_method_id = $1::smallint
        LIMIT 1
    `, [Number.isInteger(normalizedPaymentMethodId) ? normalizedPaymentMethodId : null]);
    const paymentMethod = paymentResult.rows[0];

    if (!paymentMethod) {
        throw httpError(400, "Payment method ไม่ถูกต้อง");
    }

    // A student can have more than one billing record in the same period
    // (e.g. each subject paid on a different day via separate receipts).
    // When the caller names a specific billing (the normal case — every
    // row in the Payment Center carries its own billingId), look that
    // exact record up rather than always fetching "the latest for this
    // student+period" and hoping it happens to match: with two+ billings,
    // only the newest one could ever match that way, so any older bill's
    // row would wrongly fall through to the fresh-receipt code path
    // instead of reprint/cancel mode.
    const normalizedExistingBillingId = Number.isInteger(Number(existingBillingId)) && Number(existingBillingId) > 0
        ? Number(existingBillingId)
        : null;
    const existingBillingQuery = `
        SELECT
            billing.billing_id,
            billing.receipt_book,
            billing.receipt_no,
            billing.billing_date,
            billing.payment_method_id,
            billing.total_amount,
            billing.discount_amount,
            billing.net_amount,
            billing.billing_month,
            billing.billing_year,
            payment.payment_method_code,
            payment.payment_method_name
        FROM ${TABLE_SCHEMA}.billing
        JOIN ${TABLE_SCHEMA}.payment_method_master payment
            ON payment.payment_method_id = billing.payment_method_id
        WHERE billing.student_id = $1
    `;
    const existingBillingResult = normalizedExistingBillingId
        ? await client.query(`${existingBillingQuery} AND billing.billing_id = $2`, [
            currentEnrollment.student_id,
            normalizedExistingBillingId
        ])
        : existingBillingId === true
            ? await client.query(`
                ${existingBillingQuery}
                  AND billing.billing_month = $2
                  AND billing.billing_year = $3
                ORDER BY billing.billing_date DESC, billing.billing_id DESC
                LIMIT 1
            `, [currentEnrollment.student_id, period.billingMonth, period.billingYear])
            : { rows: [] };
    const existingBilling = existingBillingResult.rows[0] || null;
    const useExistingBilling = Boolean(existingBilling);

    // Separate from the specific-billing lookup above: a cheap hint for
    // "is there *a* billing for this student+period at all" (regardless of
    // which one, if any, the caller actually requested), used by callers to
    // retry with a concrete existingBillingId once they learn everything is
    // already paid. Not used to decide useExistingBilling itself.
    const latestBillingIdResult = await client.query(`
        SELECT billing_id
        FROM ${TABLE_SCHEMA}.billing
        WHERE student_id = $1
          AND billing_month = $2
          AND billing_year = $3
        ORDER BY billing_date DESC, billing_id DESC
        LIMIT 1
    `, [currentEnrollment.student_id, period.billingMonth, period.billingYear]);
    const latestBillingIdForPeriod = latestBillingIdResult.rows[0]?.billing_id || null;

    const paidDetailsByEnrollmentId = new Map();
    const reprintDetailsByEnrollmentId = new Map();

    const paidDetailsResult = await client.query(`
        SELECT DISTINCT ON (detail.enrollment_id)
            detail.enrollment_id,
            billing.billing_id,
            billing.receipt_book,
            billing.receipt_no,
            detail.tuition_fee,
            detail.registration_fee,
            detail.additional_fee,
            detail.discount_amount,
            detail.net_amount
        FROM ${TABLE_SCHEMA}.billing billing
        JOIN ${TABLE_SCHEMA}.billing_detail detail
            ON detail.billing_id = billing.billing_id
        WHERE billing.student_id = $1
          AND billing.billing_month = $2
          AND billing.billing_year = $3
        ORDER BY detail.enrollment_id, billing.billing_date DESC, billing.billing_id DESC
    `, [
        currentEnrollment.student_id,
        period.billingMonth,
        period.billingYear
    ]);

    paidDetailsResult.rows.forEach((row) => {
        paidDetailsByEnrollmentId.set(Number(row.enrollment_id), row);
    });

    if (useExistingBilling) {
        const reprintDetailsResult = await client.query(`
            SELECT
                enrollment_id,
                tuition_fee,
                registration_fee,
                additional_fee,
                discount_amount,
                net_amount
            FROM ${TABLE_SCHEMA}.billing_detail
            WHERE billing_id = $1
        `, [existingBilling.billing_id]);

        reprintDetailsResult.rows.forEach((row) => {
            reprintDetailsByEnrollmentId.set(Number(row.enrollment_id), row);
        });
    }
    const receiptNo = useExistingBilling
        ? {
            receiptBook: existingBilling.receipt_book,
            receiptNo: existingBilling.receipt_no
        }
        : await getNextReceiptNo({
            billingMonth: period.billingMonth,
            billingYear: period.billingYear,
            client
        });
    const enrollmentsResult = await client.query(`
        SELECT
            e.enrollment_id,
            e.student_id,
            e.current_level_master_id,
            e.current_zun_level_master_id,
            e.current_status_group1_id,
            e.current_status_group2_id,
            student.first_name,
            student.last_name,
            student.nickname,
            student.school_grade_id,
            grade.addition_fee,
            subject.subject_code,
            subject.subject_name,
            current_level.level_code AS current_level_code,
            current_zun.level_code AS current_zun_level_code,
            status1.status_code AS status_group1_code,
            status1.status_name AS status_group1_name,
            status2.status_code AS status_group2_code,
            status2.status_name AS status_group2_name
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.student student
            ON student.student_id = e.student_id
        LEFT JOIN ${TABLE_SCHEMA}.school_grade_master grade
            ON grade.school_grade_id = student.school_grade_id
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.level_master current_level
            ON current_level.level_master_id = e.current_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.level_master current_zun
            ON current_zun.level_master_id = e.current_zun_level_master_id
        JOIN ${TABLE_SCHEMA}.status_master status1
            ON status1.status_id = e.current_status_group1_id
        LEFT JOIN ${TABLE_SCHEMA}.status_master status2
            ON status2.status_id = e.current_status_group2_id
        WHERE e.student_id = $1
          AND status1.status_code = ANY($2::text[])
        ORDER BY subject.subject_id, e.enrollment_id
    `, [
        currentEnrollment.student_id,
        ACTIVE_STATUS_CODES
    ]);
    const requestedSelection = Array.isArray(selectedEnrollmentIds)
        ? new Set(selectedEnrollmentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))
        : null;
    const detailRows = enrollmentsResult.rows.map((row) => {
        const fee = calculateReceiptDetailFee({
            center,
            enrollment: {
                additionFee: row.addition_fee,
                statusGroup1Code: row.status_group1_code,
                statusGroup2Code: row.status_group2_code
            }
        });

        const enrollmentKey = Number(row.enrollment_id);
        const paidDetail = paidDetailsByEnrollmentId.get(enrollmentKey);
        const reprintDetail = reprintDetailsByEnrollmentId.get(enrollmentKey);
        const isPaid = Boolean(paidDetail);
        const isReprintDetail = Boolean(reprintDetail);
        const selected = useExistingBilling
            ? isReprintDetail
            : requestedSelection
                ? requestedSelection.has(enrollmentKey) && !isPaid
                : !isPaid;
        const displayDetail = reprintDetail || paidDetail;

        return {
            enrollmentId: row.enrollment_id,
            isPaid,
            isSelected: selected,
            isLocked: isPaid || useExistingBilling,
            paidBillingId: paidDetail?.billing_id || null,
            paidReceiptBook: paidDetail?.receipt_book || null,
            paidReceiptNo: paidDetail?.receipt_no || null,
            subjectCode: row.subject_code,
            subjectName: row.subject_name,
            currentLevelMasterId: row.current_level_master_id,
            currentLevelCode: row.current_level_code,
            currentZunLevelMasterId: row.current_zun_level_master_id,
            currentZunLevelCode: row.current_zun_level_code,
            statusGroup1Id: row.current_status_group1_id,
            statusGroup1Code: row.status_group1_code,
            statusGroup1Name: row.status_group1_name,
            statusGroup2Id: row.current_status_group2_id,
            statusGroup2Code: row.status_group2_code,
            statusGroup2Name: row.status_group2_name,
            ...(displayDetail ? {
                tuitionFee: money(displayDetail.tuition_fee),
                registrationFee: money(displayDetail.registration_fee),
                additionalFee: money(displayDetail.additional_fee),
                discountAmount: money(displayDetail.discount_amount),
                netAmount: money(displayDetail.net_amount)
            } : fee)
        };
    });

    if (!detailRows.length) {
        throw httpError(400, "ไม่มี enrollment ที่รับเงินได้");
    }

    const receiptDetails = detailRows.filter((row) => row.isSelected);

    const computedDiscountAmount = money(receiptDetails.reduce((sum, row) => sum + row.discountAmount, 0));
    const computedNetAmount = money(receiptDetails.reduce((sum, row) => sum + row.netAmount, 0));
    const computedTotalAmount = money(computedNetAmount + computedDiscountAmount);
    const discountAmount = useExistingBilling
        ? money(existingBilling.discount_amount)
        : computedDiscountAmount;
    const netAmount = useExistingBilling
        ? money(existingBilling.net_amount)
        : computedNetAmount;
    const totalAmount = useExistingBilling
        ? money(existingBilling.total_amount)
        : computedTotalAmount;

    return {
        billingId: useExistingBilling ? existingBilling.billing_id : null,
        alreadyPaid: detailRows.every((row) => row.isPaid),
        partiallyPaid: detailRows.some((row) => row.isPaid) && detailRows.some((row) => !row.isPaid),
        existingBillingId: latestBillingIdForPeriod,
        receiptBook: receiptNo.receiptBook,
        receiptNo: receiptNo.receiptNo,
        studentId: currentEnrollment.student_id,
        sourceEnrollmentId: normalizedEnrollmentId,
        studentName: formatStudentName(currentEnrollment),
        billingDate: useExistingBilling
            ? normalizeDate(existingBilling.billing_date)
            : period.billingDate,
        paymentMethodId: useExistingBilling ? existingBilling.payment_method_id : paymentMethod.payment_method_id,
        paymentMethodCode: useExistingBilling ? existingBilling.payment_method_code : paymentMethod.payment_method_code,
        paymentMethodName: useExistingBilling ? existingBilling.payment_method_name : paymentMethod.payment_method_name,
        totalAmount,
        discountAmount,
        netAmount,
        billingMonth: period.billingMonth,
        billingYear: period.billingYear,
        center: {
            centerId: center.center_id,
            centerName: center.center_name,
            instructor: center.instructor
        },
        details: detailRows,
        receiptDetails
    };
}

export async function previewReceipt(payload) {
    const receipt = await buildReceiptPreview({
        enrollmentId: payload?.enrollmentId,
        billingDate: payload?.billingDate,
        billingMonth: payload?.billingMonth,
        billingYear: payload?.billingYear,
        paymentMethodId: payload?.paymentMethodId,
        existingBillingId: payload?.existingBillingId,
        selectedEnrollmentIds: payload?.selectedEnrollmentIds
    });
    const paymentMethodsResult = await pool.query(`
        SELECT payment_method_id, payment_method_code, payment_method_name
        FROM ${TABLE_SCHEMA}.payment_method_master
        ORDER BY payment_method_id
    `);

    return {
        success: true,
        receipt,
        paymentMethods: paymentMethodsResult.rows.map((row) => ({
            paymentMethodId: row.payment_method_id,
            paymentMethodCode: row.payment_method_code,
            paymentMethodName: row.payment_method_name
        }))
    };
}

export async function receiveReceiptPayment(payload) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const receipt = await buildReceiptPreview({
            enrollmentId: payload?.enrollmentId,
            billingDate: payload?.billingDate,
            billingMonth: payload?.billingMonth,
            billingYear: payload?.billingYear,
            paymentMethodId: payload?.paymentMethodId,
            selectedEnrollmentIds: payload?.selectedEnrollmentIds,
            client
        });

        if (!receipt.receiptDetails.length) {
            throw httpError(
                409,
                `น้องคนนี้จ่ายเงินค่าเรียนเดือน ${formatBillingPeriod(receipt)} ครบแล้ว`
            );
        }
        const insertBilling = await client.query(`
            INSERT INTO ${TABLE_SCHEMA}.billing (
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
            RETURNING billing_id
        `, [
            receipt.receiptBook,
            receipt.receiptNo,
            receipt.studentId,
            receipt.billingDate,
            receipt.paymentMethodId,
            receipt.totalAmount,
            receipt.discountAmount,
            receipt.netAmount,
            receipt.billingMonth,
            receipt.billingYear
        ]);
        const billingId = insertBilling.rows[0].billing_id;

        for (const detail of receipt.receiptDetails) {
            await client.query(`
                INSERT INTO ${TABLE_SCHEMA}.billing_detail (
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
            `, [
                billingId,
                detail.enrollmentId,
                detail.currentLevelMasterId,
                detail.currentZunLevelMasterId,
                detail.statusGroup1Id,
                detail.statusGroup2Id,
                detail.tuitionFee,
                detail.registrationFee,
                detail.additionalFee,
                detail.discountAmount,
                detail.netAmount
            ]);
        }
        const enrollmentStatusHistoryInserted = await insertPaymentEnrollmentStatusHistory(client, receipt);
        const enrollmentStatusesUpdated = await normalizeEnrollmentStatusesAfterPayment(client, receipt);

        await client.query("COMMIT");

        return {
            success: true,
            billingId,
            enrollmentStatusHistoryInserted,
            enrollmentStatusesUpdated,
            receipt: {
                ...receipt,
                billingId
            }
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function cancelReceiptPayment(payload) {
    const billingId = Number(payload?.billingId);

    if (!Number.isInteger(billingId) || billingId < 1) {
        throw httpError(400, "Billing ID ไม่ถูกต้อง");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const billingResult = await client.query(`
            SELECT
                billing_id,
                receipt_book,
                receipt_no,
                student_id,
                billing_month,
                billing_year
            FROM ${TABLE_SCHEMA}.billing
            WHERE billing_id = $1
            FOR UPDATE
        `, [billingId]);
        const billing = billingResult.rows[0];

        if (!billing) {
            throw httpError(404, "ไม่พบใบเสร็จนี้");
        }

        const detailsResult = await client.query(`
            SELECT
                detail.billing_detail_id,
                detail.enrollment_id,
                detail.status_group1_id,
                detail.status_group2_id,
                status1.status_code AS status_group1_code,
                status1.status_name AS status_group1_name,
                status2.status_code AS status_group2_code,
                status2.status_name AS status_group2_name
            FROM ${TABLE_SCHEMA}.billing_detail detail
            JOIN ${TABLE_SCHEMA}.status_master status1
                ON status1.status_id = detail.status_group1_id
            LEFT JOIN ${TABLE_SCHEMA}.status_master status2
                ON status2.status_id = detail.status_group2_id
            WHERE detail.billing_id = $1
            ORDER BY detail.billing_detail_id
            FOR UPDATE OF detail
        `, [billingId]);
        const details = detailsResult.rows;

        if (!details.length) {
            throw httpError(409, "ใบเสร็จนี้ไม่มีรายละเอียดให้ยกเลิก");
        }

        let deletedStatusHistory = 0;

        for (const detail of details) {
            const deleteHistoryResult = await client.query(`
                DELETE FROM ${TABLE_SCHEMA}.enrollment_status
                WHERE enrollment_id = $1
                  AND status_month = $2
                  AND status_year = $3
            `, [
                detail.enrollment_id,
                billing.billing_month,
                billing.billing_year
            ]);

            deletedStatusHistory += deleteHistoryResult.rowCount;

            await client.query(`
                UPDATE ${TABLE_SCHEMA}.enrollment
                SET current_status_group1_id = $1,
                    current_status_group2_id = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE enrollment_id = $3
            `, [
                detail.status_group1_id,
                detail.status_group2_id,
                detail.enrollment_id
            ]);
        }

        await client.query(`
            DELETE FROM ${TABLE_SCHEMA}.billing_detail
            WHERE billing_id = $1
        `, [billingId]);
        await client.query(`
            DELETE FROM ${TABLE_SCHEMA}.billing
            WHERE billing_id = $1
        `, [billingId]);

        await client.query("COMMIT");

        return {
            success: true,
            billingId,
            receiptBook: billing.receipt_book,
            receiptNo: billing.receipt_no,
            billingMonth: billing.billing_month,
            billingYear: billing.billing_year,
            restoredEnrollments: details.length,
            deletedStatusHistory
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function receiveCd(payload) {
    const enrollmentId = Number(payload?.enrollmentId);
    const cdMasterId = Number(payload?.cdMasterId);
    const cpcd = payload?.cpcd === false ? false : true;

    if (!Number.isInteger(enrollmentId) || enrollmentId < 1) {
        throw httpError(400, "Enrollment ID ไม่ถูกต้อง");
    }

    if (!Number.isInteger(cdMasterId) || cdMasterId < 1) {
        throw httpError(400, "CD ไม่ถูกต้อง");
    }

    const cdDate = assertIsoDate(payload?.cdDate || normalizeDate(new Date()), "CD date");
    const { month, year } = dateParts(cdDate);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const masterResult = await client.query(`
            SELECT
                e.enrollment_id,
                e.current_level_master_id,
                cd_master.cd_master_id,
                cd_master.cd_no
            FROM ${TABLE_SCHEMA}.enrollment e
            JOIN ${TABLE_SCHEMA}.status_master status
                ON status.status_id = e.current_status_group1_id
            JOIN ${TABLE_SCHEMA}.cd_master cd_master
                ON cd_master.level_master_id = e.current_level_master_id
               AND cd_master.cd_master_id = $2
            WHERE e.enrollment_id = $1
              AND status.status_code = ANY($3::text[])
            FOR UPDATE OF e
        `, [
            enrollmentId,
            cdMasterId,
            ACTIVE_STATUS_CODES
        ]);
        const master = masterResult.rows[0];

        if (!master) {
            throw httpError(400, "CD นี้ไม่ตรงกับ level ปัจจุบัน");
        }

        const existingResult = await client.query(`
            SELECT cd_used_id, cpcd
            FROM ${TABLE_SCHEMA}.cd_used
            WHERE enrollment_id = $1
              AND cd_master_id = $2
            ORDER BY cd_used_id DESC
            LIMIT 1
        `, [enrollmentId, cdMasterId]);

        if (existingResult.rows[0]) {
            await client.query("COMMIT");

            return {
                success: true,
                inserted: false,
                cdUsedId: existingResult.rows[0].cd_used_id,
                cdMasterId,
                cdNo: master.cd_no,
                cpcd: existingResult.rows[0].cpcd
            };
        }

        const insertResult = await client.query(`
            INSERT INTO ${TABLE_SCHEMA}.cd_used (
                enrollment_id,
                cd_master_id,
                cd_date,
                cd_month,
                cd_year,
                cpcd,
                is_stock_processed
            )
            VALUES ($1, $2, $3, $4, $5, $6, FALSE)
            RETURNING cd_used_id
        `, [
            enrollmentId,
            cdMasterId,
            cdDate,
            month,
            year,
            cpcd
        ]);

        await client.query("COMMIT");

        return {
            success: true,
            inserted: true,
            cdUsedId: insertResult.rows[0].cd_used_id,
            cdMasterId,
            cdNo: master.cd_no,
            cpcd
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function getCurrentAtMaster(client, enrollmentId) {
    const result = await client.query(`
        SELECT
            e.enrollment_id,
            e.current_level_master_id,
            subject.subject_code,
            at_master.at_master_id,
            at_master.max_score,
            at_master.max_time,
            level.level_code,
            level.next_level_master_id,
            next_level.level_code AS next_level_code
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.level_master level
            ON level.level_master_id = e.current_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.level_master next_level
            ON next_level.level_master_id = level.next_level_master_id
        JOIN ${TABLE_SCHEMA}.at_master at_master
            ON at_master.subject_id = e.subject_id
           AND at_master.level_master_id = e.current_level_master_id
        WHERE e.enrollment_id = $1
        FOR UPDATE OF e
    `, [enrollmentId]);

    return result.rows[0] || null;
}

async function getEditableAtAttempt(client, {
    enrollmentId,
    atUsedId
}) {
    const result = await client.query(`
        SELECT
            at_used.at_used_id,
            at_used.enrollment_id,
            at_used.at_master_id,
            at_used.at_date,
            at_used.score,
            at_used.used_time,
            at_used.at_group,
            at_used.is_pass,
            at_master.level_master_id,
            at_master.max_score,
            at_master.max_time,
            level.level_code,
            level.next_level_master_id,
            next_level.level_code AS next_level_code,
            enrollment.current_level_master_id
        FROM ${TABLE_SCHEMA}.at_used at_used
        JOIN ${TABLE_SCHEMA}.at_master at_master
            ON at_master.at_master_id = at_used.at_master_id
        JOIN ${TABLE_SCHEMA}.level_master level
            ON level.level_master_id = at_master.level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.level_master next_level
            ON next_level.level_master_id = level.next_level_master_id
        JOIN ${TABLE_SCHEMA}.enrollment enrollment
            ON enrollment.enrollment_id = at_used.enrollment_id
        WHERE at_used.at_used_id = $1
          AND at_used.enrollment_id = $2
        FOR UPDATE OF at_used, enrollment
    `, [atUsedId, enrollmentId]);

    return result.rows[0] || null;
}

function validateAtValues({
    score,
    usedTime,
    atGroup,
    maxScore,
    maxTime
}) {
    if (score <= 0) {
        throw httpError(400, "Score ต้องมากกว่า 0");
    }

    if (score > Number(maxScore)) {
        throw httpError(400, `Score ต้องไม่เกิน ${maxScore}`);
    }

    if (usedTime <= 0) {
        throw httpError(400, "Time ต้องมากกว่า 0");
    }

    if (usedTime > Number(maxTime)) {
        throw httpError(400, `Time ต้องไม่เกิน ${maxTime}`);
    }

    if (atGroup < 1 || atGroup > 5) {
        throw httpError(400, "Group ต้องอยู่ระหว่าง 1-5");
    }
}

export async function saveAtCompletion(payload) {
    const enrollmentId = Number(payload?.enrollmentId);
    const atUsedId = payload?.atUsedId ? Number(payload.atUsedId) : null;

    if (!Number.isInteger(enrollmentId) || enrollmentId < 1) {
        throw httpError(400, "Enrollment ID ไม่ถูกต้อง");
    }

    if (atUsedId !== null && (!Number.isInteger(atUsedId) || atUsedId < 1)) {
        throw httpError(400, "AT record ไม่ถูกต้อง");
    }

    const atDate = assertIsoDate(payload.atDate, "Date AT");
    const score = normalizeSmallInt(payload.score, "Score", { min: 0 });
    const usedTime = normalizeSmallInt(payload.usedTime, "Time", { min: 0 });
    const atGroup = normalizeSmallInt(payload.atGroup, "Group", { min: 1, max: 5 });
    const isPass = normalizeBoolean(payload.isPass, "Pass");
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        let savedAtUsedId = atUsedId;
        let levelMasterId = null;
        let nextLevelMasterId = null;

        if (atUsedId) {
            const attempt = await getEditableAtAttempt(client, {
                enrollmentId,
                atUsedId
            });

            if (!attempt) {
                throw httpError(404, "ไม่พบ AT record ของ enrollment นี้");
            }

            validateAtValues({
                score,
                usedTime,
                atGroup,
                maxScore: attempt.max_score,
                maxTime: attempt.max_time
            });

            await client.query(`
                UPDATE ${TABLE_SCHEMA}.at_used
                SET
                    at_date = $1,
                    score = $2,
                    used_time = $3,
                    at_group = $4,
                    is_pass = $5
                WHERE at_used_id = $6
                  AND enrollment_id = $7
            `, [
                atDate,
                score,
                usedTime,
                atGroup,
                isPass,
                atUsedId,
                enrollmentId
            ]);

            levelMasterId = Number(attempt.level_master_id);
            nextLevelMasterId = attempt.next_level_master_id
                ? Number(attempt.next_level_master_id)
                : null;

            if (isPass && nextLevelMasterId) {
                await client.query(`
                    UPDATE ${TABLE_SCHEMA}.enrollment
                    SET
                        current_level_master_id = $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE enrollment_id = $2
                      AND current_level_master_id = $3
                `, [nextLevelMasterId, enrollmentId, levelMasterId]);
            }

            if (!isPass && nextLevelMasterId && attempt.is_pass) {
                await client.query(`
                    UPDATE ${TABLE_SCHEMA}.enrollment
                    SET
                        current_level_master_id = $1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE enrollment_id = $2
                      AND current_level_master_id = $3
                `, [levelMasterId, enrollmentId, nextLevelMasterId]);
            }
        } else {
            const atMaster = await getCurrentAtMaster(client, enrollmentId);

            if (!atMaster) {
                throw httpError(400, "Level ปัจจุบันไม่มี AT master");
            }

            validateAtValues({
                score,
                usedTime,
                atGroup,
                maxScore: atMaster.max_score,
                maxTime: atMaster.max_time
            });

            const insertResult = await client.query(`
                INSERT INTO ${TABLE_SCHEMA}.at_used (
                    enrollment_id,
                    at_master_id,
                    at_date,
                    score,
                    used_time,
                    at_group,
                    is_pass
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING at_used_id
            `, [
                enrollmentId,
                atMaster.at_master_id,
                atDate,
                score,
                usedTime,
                atGroup,
                isPass
            ]);

            savedAtUsedId = insertResult.rows[0].at_used_id;
            levelMasterId = Number(atMaster.current_level_master_id);
            nextLevelMasterId = atMaster.next_level_master_id
                ? Number(atMaster.next_level_master_id)
                : null;

            if (isPass) {
                if (!nextLevelMasterId) {
                    if (!isCompleterLevel(atMaster.subject_code, atMaster.level_code)) {
                        throw httpError(400, "Level นี้ไม่มี next level ให้เลื่อน");
                    }
                } else {
                    await client.query(`
                        UPDATE ${TABLE_SCHEMA}.enrollment
                        SET
                            current_level_master_id = $1,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE enrollment_id = $2
                          AND current_level_master_id = $3
                    `, [nextLevelMasterId, enrollmentId, levelMasterId]);
                }
            }
        }

        await client.query("COMMIT");

        return {
            success: true,
            atUsedId: savedAtUsedId,
            enrollmentId,
            levelMasterId,
            nextLevelMasterId,
            isPass
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function completeWorksheetLevelWithoutAt(payload) {
    const enrollmentId = Number(payload?.enrollmentId);

    if (!Number.isInteger(enrollmentId) || enrollmentId < 1) {
        throw httpError(400, "Enrollment ID ไม่ถูกต้อง");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(`
            SELECT
                e.enrollment_id,
                e.current_level_master_id,
                current_level.level_code AS current_level_code,
                current_level.next_level_master_id,
                next_level.level_code AS next_level_code,
                EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.worksheet_used wu
                    JOIN ${TABLE_SCHEMA}.worksheet_master wm
                        ON wm.worksheet_master_id = wu.worksheet_master_id
                    WHERE wu.enrollment_id = e.enrollment_id
                      AND wm.level_master_id = e.current_level_master_id
                      AND wm.worksheet_no = 191
                      AND wu.cpws = TRUE
                ) AS has_worksheet_191,
                EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.at_master at_master
                    WHERE at_master.subject_id = e.subject_id
                      AND at_master.level_master_id = e.current_level_master_id
                ) AS has_at_master
            FROM ${TABLE_SCHEMA}.enrollment e
            JOIN ${TABLE_SCHEMA}.status_master status
                ON status.status_id = e.current_status_group1_id
            JOIN ${TABLE_SCHEMA}.level_master current_level
                ON current_level.level_master_id = e.current_level_master_id
            LEFT JOIN ${TABLE_SCHEMA}.level_master next_level
                ON next_level.level_master_id = current_level.next_level_master_id
            WHERE e.enrollment_id = $1
              AND status.status_code = ANY($2::text[])
            FOR UPDATE OF e
        `, [enrollmentId, ACTIVE_STATUS_CODES]);
        const row = result.rows[0];

        if (!row) {
            throw httpError(404, "ไม่พบ enrollment ที่ยังใช้งานอยู่");
        }

        if (!FREE_COMPLETION_LEVEL_CODES.includes(row.current_level_code)) {
            throw httpError(400, "Level นี้ต้องสอบ AT ตามปกติ");
        }

        if (row.has_at_master) {
            throw httpError(400, "Level นี้มี AT master ต้องสอบ AT ตามปกติ");
        }

        if (!row.has_worksheet_191) {
            throw httpError(400, "ยังจบ Level ไม่ได้ ต้องมีชุด 191 ก่อน");
        }

        if (!row.next_level_master_id) {
            throw httpError(400, "Level นี้ไม่มี next level ให้เลื่อน");
        }

        await client.query(`
            UPDATE ${TABLE_SCHEMA}.enrollment
            SET
                current_level_master_id = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE enrollment_id = $2
              AND current_level_master_id = $3
        `, [
            row.next_level_master_id,
            enrollmentId,
            row.current_level_master_id
        ]);

        await client.query("COMMIT");

        return {
            success: true,
            enrollmentId,
            previousLevelMasterId: row.current_level_master_id,
            previousLevelCode: row.current_level_code,
            nextLevelMasterId: row.next_level_master_id,
            nextLevelCode: row.next_level_code
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function completeZunLevel(payload) {
    const enrollmentId = Number(payload?.enrollmentId);

    if (!Number.isInteger(enrollmentId) || enrollmentId < 1) {
        throw httpError(400, "Enrollment ID ไม่ถูกต้อง");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(`
            SELECT
                e.enrollment_id,
                e.current_zun_level_master_id,
                current_zun.level_code AS current_zun_level_code,
                current_zun.next_level_master_id,
                next_zun.level_code AS next_zun_level_code,
                EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.worksheet_used wu
                    JOIN ${TABLE_SCHEMA}.worksheet_master wm
                        ON wm.worksheet_master_id = wu.worksheet_master_id
                    WHERE wu.enrollment_id = e.enrollment_id
                      AND wm.level_master_id = e.current_zun_level_master_id
                      AND wm.worksheet_no = 91
                      AND wu.cpws = TRUE
                ) AS can_complete_zun_level
            FROM ${TABLE_SCHEMA}.enrollment e
            JOIN ${TABLE_SCHEMA}.status_master status
                ON status.status_id = e.current_status_group1_id
            LEFT JOIN ${TABLE_SCHEMA}.level_master current_zun
                ON current_zun.level_master_id = e.current_zun_level_master_id
            LEFT JOIN ${TABLE_SCHEMA}.level_master next_zun
                ON next_zun.level_master_id = current_zun.next_level_master_id
            WHERE e.enrollment_id = $1
              AND status.status_code = ANY($2::text[])
            FOR UPDATE OF e
        `, [enrollmentId, ACTIVE_STATUS_CODES]);
        const row = result.rows[0];

        if (!row) {
            throw httpError(404, "ไม่พบ enrollment ที่ยังใช้งานอยู่");
        }

        if (!row.current_zun_level_master_id) {
            throw httpError(400, "Enrollment นี้ไม่มี Zun level ให้จบ");
        }

        if (!row.can_complete_zun_level) {
            throw httpError(400, "ยังจบ Zun Level ไม่ได้ ต้องมีชุด 91 ก่อน");
        }

        const nextZunLevelMasterId = row.next_level_master_id || null;

        await client.query(`
            UPDATE ${TABLE_SCHEMA}.enrollment
            SET
                current_zun_level_master_id = $1,
                updated_at = CURRENT_TIMESTAMP
            WHERE enrollment_id = $2
        `, [nextZunLevelMasterId, enrollmentId]);

        await client.query("COMMIT");

        return {
            success: true,
            enrollmentId,
            previousZunLevelMasterId: row.current_zun_level_master_id,
            previousZunLevelCode: row.current_zun_level_code,
            nextZunLevelMasterId,
            nextZunLevelCode: row.next_zun_level_code || null,
            isFinal: !nextZunLevelMasterId
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function deleteWorksheetEntry({
    enrollmentId,
    worksheetUsedId
}) {
    const normalizedEnrollmentId = Number(enrollmentId);
    const normalizedWorksheetUsedId = Number(worksheetUsedId);

    if (!Number.isInteger(normalizedEnrollmentId) || normalizedEnrollmentId < 1) {
        throw httpError(400, "Enrollment ID ไม่ถูกต้อง");
    }

    if (!Number.isInteger(normalizedWorksheetUsedId) || normalizedWorksheetUsedId < 1) {
        throw httpError(400, "Worksheet record ไม่ถูกต้อง");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(`
            SELECT
                worksheet_used_id,
                enrollment_id,
                is_stock_processed
            FROM ${TABLE_SCHEMA}.worksheet_used
            WHERE worksheet_used_id = $1
            FOR UPDATE
        `, [normalizedWorksheetUsedId]);
        const row = result.rows[0];

        if (!row || Number(row.enrollment_id) !== normalizedEnrollmentId) {
            throw httpError(404, "ไม่พบ worksheet record ของ enrollment นี้");
        }

        if (row.is_stock_processed) {
            throw httpError(409, "ลบไม่ได้ เพราะ record นี้ตัด stock แล้ว");
        }

        await client.query(`
            DELETE FROM ${TABLE_SCHEMA}.worksheet_used
            WHERE worksheet_used_id = $1
              AND enrollment_id = $2
              AND is_stock_processed = FALSE
        `, [normalizedWorksheetUsedId, normalizedEnrollmentId]);

        await client.query("COMMIT");
        const rawEnrollment = await getEnrollmentRow(normalizedEnrollmentId);
        const refreshedEnrollment = rawEnrollment ? mapEnrollment(rawEnrollment) : null;
        const [completionState, worksheetProgress, worksheetPacketSummary] = refreshedEnrollment
            ? await Promise.all([
                getLevelCompletionState(refreshedEnrollment),
                getWorksheetProgress(refreshedEnrollment),
                getWorksheetPacketSummary(refreshedEnrollment)
            ])
            : [null, null, null];

        return {
            success: true,
            worksheetUsedId: normalizedWorksheetUsedId,
            completionState,
            worksheetProgress,
            worksheetPacketSummary
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
