import pool from "../config/db.js";

const TABLE_SCHEMA = "kumon";
const ACTIVE_STATUS_CODES = ["N", "EO", "IT", "R", "C"];
const DEFAULT_HISTORY_LIMIT = 20;
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

function formatStudentName(row) {
    const firstName = row.first_name || "";
    const lastName = row.last_name || "";
    const nickname = row.nickname ? ` (${row.nickname})` : "";

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
            END AS can_complete_zun_level
    `, [
        enrollment.enrollmentId,
        enrollment.currentLevelMasterId,
        enrollment.currentZunLevelMasterId
    ]);

    return {
        canCompleteWsLevel: Boolean(result.rows[0]?.can_complete_ws_level),
        canCompleteZunLevel: Boolean(result.rows[0]?.can_complete_zun_level)
    };
}

async function getCdState(enrollment) {
    const result = await pool.query(`
        SELECT
            EXISTS (
                SELECT 1
                FROM ${TABLE_SCHEMA}.cd_master
                WHERE level_master_id = $1
            ) AS has_cd_master,
            EXISTS (
                SELECT 1
                FROM ${TABLE_SCHEMA}.cd_used cd
                JOIN ${TABLE_SCHEMA}.cd_master master
                    ON master.cd_master_id = cd.cd_master_id
                WHERE cd.enrollment_id = $2
                  AND master.level_master_id = $1
            ) AS has_received_cd
    `, [
        enrollment.currentLevelMasterId,
        enrollment.enrollmentId
    ]);

    return {
        hasCdMaster: Boolean(result.rows[0]?.has_cd_master),
        hasReceivedCd: Boolean(result.rows[0]?.has_received_cd)
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
        defaultReceiveDate,
        completionState,
        cdState
    ] = await Promise.all([
        getActiveStudentEnrollments(enrollment.studentId),
        getWorksheetOptions(enrollment.currentLevelMasterId),
        getWorksheetOptions(enrollment.currentZunLevelMasterId),
        getHistory(enrollment.enrollmentId, historyLimit),
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
        const completionState = await getLevelCompletionState(enrollment);

        return {
            success: true,
            records: savedRecords,
            nextReceiveDate: addDays(latestSavedDate, 1),
            completionState
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
