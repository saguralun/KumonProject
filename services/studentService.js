import pool from "../config/db.js";

const TABLE_SCHEMA = "kumon";
const ACTIVE_STATUS_CODES = ["N", "EO", "IT", "R", "C"];
const HISTORY_LIMIT = 80;
const COMPLETER_LEVEL_BY_SUBJECT = new Map([
    ["ME", "O"],
    ["EFL", "O"],
    ["TRP", "III"]
]);

function httpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
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

function nullableText(value) {
    const text = String(value ?? "").trim();
    return text || null;
}

function normalizeMobile(value) {
    const text = String(value ?? "").trim();

    if (!text) {
        return null;
    }

    const digits = text.replace(/\D/g, "");

    if (digits.length !== 10) {
        throw httpError(400, "เบอร์โทรต้องเป็น 10 หลัก เช่น 000-000-0000");
    }

    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function normalizeZipcode(value) {
    const text = String(value ?? "").trim();

    if (!text) {
        return null;
    }

    if (!/^\d{5}$/.test(text)) {
        throw httpError(400, "รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก");
    }

    return text;
}

function nullableInt(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const numberValue = Number(value);
    return Number.isInteger(numberValue) ? numberValue : null;
}

function normalizeBoolean(value) {
    return value === true || value === "true" || value === "on" || value === "1";
}

function requiredInt(value, label) {
    const numberValue = Number(value);

    if (!Number.isInteger(numberValue) || numberValue < 1) {
        throw httpError(400, `${label} ไม่ถูกต้อง`);
    }

    return numberValue;
}

function requiredNonNegativeInt(value, label) {
    const numberValue = Number(value);

    if (!Number.isInteger(numberValue) || numberValue < 0) {
        throw httpError(400, `${label} ไม่ถูกต้อง`);
    }

    return numberValue;
}

function optionalPositiveInt(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }

    const numberValue = Number(value);
    return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function requiredDate(value, label) {
    const dateText = normalizeDate(value);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
        throw httpError(400, `${label} ไม่ถูกต้อง`);
    }

    return dateText;
}

function periodFromDate(dateText) {
    const [yearText, monthText] = String(dateText).slice(0, 10).split("-");

    return {
        month: Number(monthText),
        year: Number(yearText)
    };
}

function kumonPeriodFromDate(dateText) {
    const [yearText, monthText, dayText] = String(dateText).slice(0, 10).split("-");
    const period = {
        month: Number(monthText),
        year: Number(yearText)
    };

    return Number(dayText) >= 21 ? nextPeriod(period) : period;
}

function isHalfMonthDate(dateText) {
    const day = Number(String(dateText).slice(8, 10));

    return day >= 11 && day <= 20;
}

function currentKumonPeriod() {
    const date = new Date();
    const month = date.getMonth() + 1;
    const year = date.getFullYear();

    if (date.getDate() >= 21) {
        return month === 12
            ? { month: 1, year: year + 1 }
            : { month: month + 1, year };
    }

    return { month, year };
}

function nextPeriod(period) {
    return Number(period.month) === 12
        ? { month: 1, year: Number(period.year) + 1 }
        : { month: Number(period.month) + 1, year: Number(period.year) };
}

function monthIndex(period) {
    return Number(period.year) * 12 + Number(period.month);
}

function formatStudentName(row) {
    const nickname = row.nickname ? ` (น้อง${row.nickname})` : "";
    return `${row.first_name || ""} ${row.last_name || ""}${nickname}`.trim();
}

function isCompleterLevel(subjectCode, levelCode) {
    return COMPLETER_LEVEL_BY_SUBJECT.get(subjectCode) === levelCode;
}

function mapStudent(row) {
    return {
        studentId: row.student_id,
        prefixId: row.prefix_id,
        prefixName: row.prefix_name,
        firstName: row.first_name,
        lastName: row.last_name,
        nickname: row.nickname,
        displayName: formatStudentName(row),
        genderId: row.gender_id,
        birthDate: normalizeDate(row.birth_date),
        schoolGradeId: row.school_grade_id,
        schoolClass: row.school_class,
        schoolName: row.school_name,
        mobile: row.mobile,
        email: row.email,
        addressNumber: row.address_number,
        addressVillage: row.address_village,
        addressAlley: row.address_alley,
        addressRoad: row.address_road,
        addressSubdistrict: row.address_subdistrict,
        addressDistrict: row.address_district,
        addressProvince: row.address_province,
        addressZipcode: row.address_zipcode,
        remark: row.remark
    };
}

function mapEnrollment(row) {
    return {
        enrollmentId: row.enrollment_id,
        studentId: row.student_id,
        subjectId: row.subject_id,
        subjectCode: row.subject_code,
        subjectName: row.subject_name,
        kumonStudentId: row.kumon_student_id,
        currentLevelMasterId: row.current_level_master_id,
        currentLevelCode: row.current_level_code,
        currentZunLevelMasterId: row.current_zun_level_master_id,
        currentZunLevelCode: row.current_zun_level_code,
        startingWorksheetMasterId: row.starting_worksheet_master_id,
        startingWorksheetNo: row.starting_worksheet_no,
        enStartDate: normalizeDate(row.en_start_date),
        openingScheduleId1: row.opening_schedule_id1,
        openingScheduleLabel1: row.opening_schedule_label1,
        openingScheduleId2: row.opening_schedule_id2,
        openingScheduleLabel2: row.opening_schedule_label2,
        currentStatusGroup1Id: row.current_status_group1_id,
        statusGroup1Code: row.status_group1_code,
        statusGroup1Name: row.status_group1_name,
        currentStatusGroup2Id: row.current_status_group2_id,
        statusGroup2Code: row.status_group2_code,
        statusGroup2Name: row.status_group2_name,
        canComplete: isCompleterLevel(row.subject_code, row.current_level_code)
            && row.status_group1_code !== "CP"
            && row.has_passed_current_level_at === true,
        canDeleteEnrollment: row.has_delete_blocker !== true,
        isKumonConnect: row.is_kumon_connect === true,
        remark: row.remark
    };
}

function studentPayload(payload) {
    return {
        prefixId: requiredInt(payload.prefixId, "คำนำหน้า"),
        firstName: nullableText(payload.firstName),
        lastName: nullableText(payload.lastName),
        nickname: nullableText(payload.nickname),
        genderId: nullableInt(payload.genderId),
        birthDate: payload.birthDate ? requiredDate(payload.birthDate, "วันเกิด") : null,
        schoolGradeId: nullableInt(payload.schoolGradeId),
        schoolName: nullableText(payload.schoolName),
        mobile: normalizeMobile(payload.mobile),
        email: nullableText(payload.email),
        addressNumber: nullableText(payload.addressNumber),
        addressVillage: nullableText(payload.addressVillage),
        addressAlley: nullableText(payload.addressAlley),
        addressRoad: nullableText(payload.addressRoad),
        addressSubdistrict: nullableText(payload.addressSubdistrict),
        addressDistrict: nullableText(payload.addressDistrict),
        addressProvince: nullableText(payload.addressProvince),
        addressZipcode: normalizeZipcode(payload.addressZipcode),
        remark: nullableText(payload.remark)
    };
}

function requireStudentCreateFields(data) {
    const requiredFields = [
        ["firstName", "ชื่อ"],
        ["lastName", "นามสกุล"],
        ["nickname", "ชื่อเล่น"],
        ["genderId", "เพศ"],
        ["birthDate", "วันเกิด"],
        ["schoolGradeId", "ชั้น"],
        ["schoolName", "โรงเรียน"],
        ["mobile", "เบอร์โทร"],
        ["addressZipcode", "รหัสไปรษณีย์"],
        ["addressProvince", "จังหวัด"],
        ["addressDistrict", "อำเภอ"],
        ["addressSubdistrict", "ตำบล"]
    ];
    const missing = requiredFields.find(([fieldName]) => !data[fieldName]);

    if (missing) {
        throw httpError(400, `กรุณากรอก${missing[1]}`);
    }

    const birthDate = new Date(`${data.birthDate}T00:00:00`);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age -= 1;
    }

    if (age <= 2) {
        throw httpError(400, "อายุต้องมากกว่า 2 ปี");
    }
}

function enrollmentPayload(payload) {
    return {
        subjectId: requiredInt(payload.subjectId, "วิชา"),
        kumonStudentId: nullableText(payload.kumonStudentId),
        isKumonConnect: normalizeBoolean(payload.isKumonConnect),
        currentLevelMasterId: optionalPositiveInt(payload.currentLevelMasterId),
        currentZunLevelMasterId: nullableInt(payload.currentZunLevelMasterId),
        startingWorksheetMasterId: requiredInt(payload.startingWorksheetMasterId, "ชุดเริ่มต้น"),
        enStartDate: requiredDate(payload.enStartDate, "วันที่เริ่มเรียน"),
        openingScheduleId1: nullableInt(payload.openingScheduleId1),
        openingScheduleId2: nullableInt(payload.openingScheduleId2),
        currentStatusGroup1Id: requiredInt(payload.currentStatusGroup1Id, "สถานะ"),
        currentStatusGroup2Id: nullableInt(payload.currentStatusGroup2Id),
        remark: nullableText(payload.remark)
    };
}

function dtPayload(payload = {}) {
    const dtMasterId = optionalPositiveInt(payload.dtMasterId);
    const hasDt = Boolean(
        dtMasterId
        || payload.dtDate
        || payload.score
        || payload.usedTime
    );

    if (!hasDt) {
        return null;
    }

    return {
        dtMasterId: requiredInt(payload.dtMasterId, "DT test"),
        dtDate: requiredDate(payload.dtDate, "วันที่ DT"),
        score: requiredNonNegativeInt(payload.score, "Score"),
        usedTime: requiredInt(payload.usedTime, "Time")
    };
}

async function assertEnrollmentMasters(client, data) {
    const result = await client.query(`
        SELECT
            level.subject_id AS current_level_subject_id,
            level.level_type AS current_level_type,
            zun.subject_id AS zun_subject_id,
            zun.level_type AS zun_level_type,
            ws.level_master_id AS starting_level_master_id,
            start_level.subject_id AS starting_level_subject_id,
            start_level.level_type AS starting_level_type,
            status1.status_group AS status1_group,
            status2.status_group AS status2_group
        FROM ${TABLE_SCHEMA}.level_master level
        JOIN ${TABLE_SCHEMA}.worksheet_master ws
            ON ws.worksheet_master_id = $3
        JOIN ${TABLE_SCHEMA}.level_master start_level
            ON start_level.level_master_id = ws.level_master_id
        JOIN ${TABLE_SCHEMA}.status_master status1
            ON status1.status_id = $4
        LEFT JOIN ${TABLE_SCHEMA}.level_master zun
            ON zun.level_master_id = $2
        LEFT JOIN ${TABLE_SCHEMA}.status_master status2
            ON status2.status_id = $5
        WHERE level.level_master_id = $1
    `, [
        data.currentLevelMasterId,
        data.currentZunLevelMasterId,
        data.startingWorksheetMasterId,
        data.currentStatusGroup1Id,
        data.currentStatusGroup2Id
    ]);
    const row = result.rows[0];

    if (!row) {
        throw httpError(400, "Master level/worksheet/status ไม่ถูกต้อง");
    }

    if (Number(row.current_level_subject_id) !== Number(data.subjectId)) {
        throw httpError(400, "Start Worksheet / Current level ไม่ตรงกับวิชา");
    }

    if (Number(row.current_level_type) !== 1) {
        throw httpError(400, "Current level ต้องเป็น level หลัก ไม่ใช่ Zun");
    }

    if (Number(row.starting_level_subject_id) !== Number(data.subjectId)) {
        throw httpError(400, "Starting worksheet ไม่ตรงกับวิชา");
    }

    if (Number(row.starting_level_type) !== 1) {
        throw httpError(400, "Starting worksheet ต้องเป็น level หลัก ไม่ใช่ Zun");
    }

    if (data.currentZunLevelMasterId) {
        if (Number(row.zun_subject_id) !== Number(data.subjectId) || Number(row.zun_level_type) !== 2) {
            throw httpError(400, "Zun level ไม่ตรงกับวิชา");
        }
    }

    if (Number(row.status1_group) !== 1) {
        throw httpError(400, "Status หลักต้องเป็น group 1");
    }

    if (data.currentStatusGroup2Id && Number(row.status2_group) !== 2) {
        throw httpError(400, "Status พิเศษต้องเป็น group 2");
    }
}

export async function getStudentMasters() {
    const [
        prefixes,
        genders,
        grades,
        subjects,
        levels,
        worksheets,
        statuses,
        schedules,
        dtMasters,
        dtResults,
        studentHints,
        addressHints
    ] = await Promise.all([
        pool.query(`SELECT prefix_id, prefix_name FROM ${TABLE_SCHEMA}.prefix_master ORDER BY prefix_id`),
        pool.query(`SELECT gender_id, gender_name FROM ${TABLE_SCHEMA}.gender_master ORDER BY gender_id`),
        pool.query(`SELECT school_grade_id, school_class, school_grade FROM ${TABLE_SCHEMA}.school_grade_master ORDER BY school_grade_id`),
        pool.query(`SELECT subject_id, subject_code, subject_name FROM ${TABLE_SCHEMA}.subject_master ORDER BY subject_id`),
        pool.query(`
            SELECT level_master_id, subject_id, level_code, level_type, next_level_master_id
            FROM ${TABLE_SCHEMA}.level_master
            ORDER BY subject_id, level_type, level_master_id
        `),
        pool.query(`
            SELECT worksheet_master_id, level_master_id, worksheet_no
            FROM ${TABLE_SCHEMA}.worksheet_master
            ORDER BY level_master_id, worksheet_no
        `),
        pool.query(`
            SELECT status_id, status_code, status_name, status_group
            FROM ${TABLE_SCHEMA}.status_master
            ORDER BY status_group, status_id
        `),
        pool.query(`
            SELECT
                os.opening_schedule_id,
                wd.weekday_code,
                wd.weekday_name,
                os.start_time::text AS start_time,
                os.end_time::text AS end_time
            FROM ${TABLE_SCHEMA}.opening_schedule os
            JOIN ${TABLE_SCHEMA}.weekday_master wd
                ON wd.weekday_id = os.weekday_id
            ORDER BY os.opening_schedule_id
        `),
        pool.query(`
            SELECT
                dt_master_id,
                subject_id,
                test_level,
                max_score,
                max_time
            FROM ${TABLE_SCHEMA}.dt_master
            ORDER BY subject_id, dt_master_id
        `),
        pool.query(`
            SELECT
                dt_master_id,
                worksheet_master_id
            FROM ${TABLE_SCHEMA}.dt_result_master
            ORDER BY dt_master_id, worksheet_master_id
        `),
        pool.query(`
            SELECT
                COALESCE(json_agg(DISTINCT school_name) FILTER (WHERE school_name IS NOT NULL AND school_name <> ''), '[]') AS schools,
                COALESCE(json_agg(DISTINCT address_road) FILTER (WHERE address_road IS NOT NULL AND address_road <> ''), '[]') AS roads,
                COALESCE(json_agg(DISTINCT address_subdistrict) FILTER (WHERE address_subdistrict IS NOT NULL AND address_subdistrict <> ''), '[]') AS subdistricts,
                COALESCE(json_agg(DISTINCT address_district) FILTER (WHERE address_district IS NOT NULL AND address_district <> ''), '[]') AS districts,
                COALESCE(json_agg(DISTINCT address_province) FILTER (WHERE address_province IS NOT NULL AND address_province <> ''), '[]') AS provinces,
                COALESCE(json_agg(DISTINCT address_zipcode) FILTER (WHERE address_zipcode IS NOT NULL AND address_zipcode <> ''), '[]') AS zipcodes
            FROM ${TABLE_SCHEMA}.student
        `),
        pool.query(`
            SELECT DISTINCT
                address_zipcode AS zipcode,
                address_province AS province,
                address_district AS district,
                address_subdistrict AS subdistrict
            FROM ${TABLE_SCHEMA}.student
            WHERE address_zipcode IS NOT NULL
              AND address_zipcode <> ''
            ORDER BY address_zipcode, address_province, address_district, address_subdistrict
        `)
    ]);

    return {
        prefixes: prefixes.rows.map((row) => ({
            id: row.prefix_id,
            name: row.prefix_name
        })),
        genders: genders.rows.map((row) => ({
            id: row.gender_id,
            name: row.gender_name
        })),
        grades: grades.rows.map((row) => ({
            id: row.school_grade_id,
            label: `${row.school_class} (${row.school_grade})`
        })),
        subjects: subjects.rows.map((row) => ({
            id: row.subject_id,
            code: row.subject_code,
            name: row.subject_name
        })),
        levels: levels.rows.map((row) => ({
            id: row.level_master_id,
            subjectId: row.subject_id,
            code: row.level_code,
            type: row.level_type,
            nextLevelMasterId: row.next_level_master_id
        })),
        worksheets: worksheets.rows.map((row) => ({
            id: row.worksheet_master_id,
            levelMasterId: row.level_master_id,
            worksheetNo: row.worksheet_no
        })),
        statuses: statuses.rows.map((row) => ({
            id: row.status_id,
            code: row.status_code,
            name: row.status_name,
            group: row.status_group
        })),
        schedules: schedules.rows.map((row) => ({
            id: row.opening_schedule_id,
            label: `${row.weekday_name} ${row.start_time.slice(0, 5)}-${row.end_time.slice(0, 5)}`,
            weekdayCode: row.weekday_code,
            weekdayName: row.weekday_name,
            startTime: row.start_time.slice(0, 5),
            endTime: row.end_time.slice(0, 5)
        })),
        dtMasters: dtMasters.rows.map((row) => ({
            id: row.dt_master_id,
            subjectId: row.subject_id,
            testLevel: row.test_level,
            maxScore: row.max_score,
            maxTime: row.max_time
        })),
        dtResults: dtResults.rows.map((row) => ({
            dtMasterId: row.dt_master_id,
            worksheetMasterId: row.worksheet_master_id
        })),
        studentHints: {
            ...studentHints.rows[0],
            addresses: addressHints.rows
        }
    };
}

export async function findStudentDuplicate({
    firstName = "",
    lastName = ""
}) {
    const first = String(firstName || "").trim();
    const last = String(lastName || "").trim();

    if (!first || !last) {
        return null;
    }

    const result = await pool.query(`
        SELECT student_id, first_name, last_name, nickname
        FROM ${TABLE_SCHEMA}.student
        WHERE lower(trim(first_name)) = lower(trim($1))
          AND lower(trim(last_name)) = lower(trim($2))
        ORDER BY student_id
        LIMIT 1
    `, [first, last]);

    return result.rows[0] ? mapStudent(result.rows[0]) : null;
}

export async function searchStudents({
    query = "",
    status = "active",
    limit = 80
}) {
    const trimmed = String(query || "").trim();
    const pageSize = Math.min(Math.max(Number(limit) || 80, 1), 200);
    const params = [];
    const where = [];

    if (status === "active") {
        params.push(ACTIVE_STATUS_CODES);
        where.push(`EXISTS (
            SELECT 1
            FROM ${TABLE_SCHEMA}.enrollment e
            JOIN ${TABLE_SCHEMA}.status_master status
                ON status.status_id = e.current_status_group1_id
            WHERE e.student_id = student.student_id
              AND status.status_code = ANY($${params.length}::text[])
        )`);
    }

    if (status === "kc") {
        params.push(ACTIVE_STATUS_CODES);
        where.push(`EXISTS (
            SELECT 1
            FROM ${TABLE_SCHEMA}.enrollment e
            JOIN ${TABLE_SCHEMA}.status_master status
                ON status.status_id = e.current_status_group1_id
            WHERE e.student_id = student.student_id
              AND e.is_kumon_connect = TRUE
              AND status.status_code = ANY($${params.length}::text[])
        )`);
    }

    if (status === "new") {
        where.push(`NOT EXISTS (
            SELECT 1
            FROM ${TABLE_SCHEMA}.enrollment e
            WHERE e.student_id = student.student_id
        )`);
    }

    if (status === "absent") {
        where.push(`EXISTS (
            SELECT 1
            FROM ${TABLE_SCHEMA}.enrollment e
            JOIN ${TABLE_SCHEMA}.status_master status
                ON status.status_id = e.current_status_group1_id
            WHERE e.student_id = student.student_id
              AND status.status_code IN ('A', 'OT', 'CP')
        )`);
    }

    if (trimmed) {
        params.push(`%${trimmed}%`);
        params.push(`${trimmed}%`);
        where.push(`(
            student.student_id::text LIKE $${params.length}
            OR EXISTS (
                SELECT 1
                FROM ${TABLE_SCHEMA}.enrollment search_enrollment
                WHERE search_enrollment.student_id = student.student_id
                  AND search_enrollment.enrollment_id::text LIKE $${params.length}
            )
            OR student.first_name ILIKE $${params.length - 1}
            OR student.last_name ILIKE $${params.length - 1}
            OR COALESCE(student.nickname, '') ILIKE $${params.length - 1}
            OR COALESCE(student.mobile, '') ILIKE $${params.length - 1}
            OR CONCAT(student.first_name, ' ', student.last_name) ILIKE $${params.length - 1}
        )`);
    }

    const exactSearchParamIndex = trimmed ? params.length + 1 : null;

    if (trimmed) {
        params.push(trimmed);
    }

    params.push(pageSize);
    const limitParamIndex = params.length;
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const matchSql = trimmed
        ? `
            (
                SELECT exact_enrollment.enrollment_id
                FROM ${TABLE_SCHEMA}.enrollment exact_enrollment
                WHERE exact_enrollment.student_id = student.student_id
                  AND exact_enrollment.enrollment_id::text = $${exactSearchParamIndex}
                ORDER BY exact_enrollment.enrollment_id
                LIMIT 1
            ) AS matched_enrollment_id,
        `
        : "NULL::integer AS matched_enrollment_id,";
    const orderSql = trimmed
        ? `
            CASE
                WHEN EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.enrollment exact_enrollment
                    WHERE exact_enrollment.student_id = student.student_id
                      AND exact_enrollment.enrollment_id::text = $${exactSearchParamIndex}
                ) THEN 0
                WHEN student.student_id::text = $${exactSearchParamIndex} THEN 1
                WHEN student.student_id::text LIKE $${exactSearchParamIndex} || '%' THEN 2
                WHEN EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.enrollment prefix_enrollment
                    WHERE prefix_enrollment.student_id = student.student_id
                      AND prefix_enrollment.enrollment_id::text LIKE $${exactSearchParamIndex} || '%'
                ) THEN 3
                ELSE 4
            END,
            student.student_id DESC
        `
        : "student.student_id DESC";
    const result = await pool.query(`
        SELECT
            student.student_id,
            student.first_name,
            student.last_name,
            student.nickname,
            student.mobile,
            ${matchSql}
            COALESCE(json_agg(
                json_build_object(
                    'enrollmentId', e.enrollment_id,
                    'subjectCode', subject.subject_code,
                    'currentLevelCode', level.level_code,
                    'statusCode', status.status_code,
                    'isKumonConnect', e.is_kumon_connect
                )
                ORDER BY subject.subject_id
            ) FILTER (WHERE e.enrollment_id IS NOT NULL), '[]') AS enrollments
        FROM ${TABLE_SCHEMA}.student student
        LEFT JOIN ${TABLE_SCHEMA}.enrollment e
            ON e.student_id = student.student_id
        LEFT JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        LEFT JOIN ${TABLE_SCHEMA}.level_master level
            ON level.level_master_id = e.current_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.status_master status
            ON status.status_id = e.current_status_group1_id
        ${whereSql}
        GROUP BY student.student_id
        ORDER BY ${orderSql}
        LIMIT $${limitParamIndex}
    `, params);

    return result.rows.map((row) => ({
        studentId: row.student_id,
        displayName: formatStudentName(row),
        firstName: row.first_name,
        lastName: row.last_name,
        nickname: row.nickname,
        mobile: row.mobile,
        matchedEnrollmentId: row.matched_enrollment_id,
        enrollments: row.enrollments
    }));
}

export async function getStudentProfile(studentId) {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const [studentResult, enrollmentResult] = await Promise.all([
        pool.query(`
            SELECT
                student.*,
                prefix.prefix_name,
                grade.school_class
            FROM ${TABLE_SCHEMA}.student student
            JOIN ${TABLE_SCHEMA}.prefix_master prefix
                ON prefix.prefix_id = student.prefix_id
            LEFT JOIN ${TABLE_SCHEMA}.school_grade_master grade
                ON grade.school_grade_id = student.school_grade_id
            WHERE student.student_id = $1
        `, [normalizedStudentId]),
        pool.query(`
            SELECT
                e.*,
                COALESCE((to_jsonb(e)->>'is_kumon_connect')::boolean, FALSE) AS is_kumon_connect,
                subject.subject_code,
                subject.subject_name,
                level.level_code AS current_level_code,
                zun.level_code AS current_zun_level_code,
                start_ws.worksheet_no AS starting_worksheet_no,
                status1.status_code AS status_group1_code,
                status1.status_name AS status_group1_name,
                status2.status_code AS status_group2_code,
                status2.status_name AS status_group2_name,
                EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.at_used at_used
                    JOIN ${TABLE_SCHEMA}.at_master at_master
                        ON at_master.at_master_id = at_used.at_master_id
                    WHERE at_used.enrollment_id = e.enrollment_id
                      AND at_master.level_master_id = e.current_level_master_id
                      AND at_used.is_pass = TRUE
                ) AS has_passed_current_level_at,
                EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.billing_detail detail
                    WHERE detail.enrollment_id = e.enrollment_id
                ) OR EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.worksheet_used worksheet
                    WHERE worksheet.enrollment_id = e.enrollment_id
                ) OR EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.cd_used cd
                    WHERE cd.enrollment_id = e.enrollment_id
                ) OR EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.at_used at_used_blocker
                    WHERE at_used_blocker.enrollment_id = e.enrollment_id
                ) OR EXISTS (
                    SELECT 1
                    FROM ${TABLE_SCHEMA}.enrollment_status status_used
                    WHERE status_used.enrollment_id = e.enrollment_id
                ) AS has_delete_blocker,
                CONCAT(wd1.weekday_name, ' ', os1.start_time::text, '-', os1.end_time::text) AS opening_schedule_label1,
                CONCAT(wd2.weekday_name, ' ', os2.start_time::text, '-', os2.end_time::text) AS opening_schedule_label2
            FROM ${TABLE_SCHEMA}.enrollment e
            JOIN ${TABLE_SCHEMA}.subject_master subject
                ON subject.subject_id = e.subject_id
            JOIN ${TABLE_SCHEMA}.level_master level
                ON level.level_master_id = e.current_level_master_id
            LEFT JOIN ${TABLE_SCHEMA}.level_master zun
                ON zun.level_master_id = e.current_zun_level_master_id
            JOIN ${TABLE_SCHEMA}.worksheet_master start_ws
                ON start_ws.worksheet_master_id = e.starting_worksheet_master_id
            JOIN ${TABLE_SCHEMA}.status_master status1
                ON status1.status_id = e.current_status_group1_id
            LEFT JOIN ${TABLE_SCHEMA}.status_master status2
                ON status2.status_id = e.current_status_group2_id
            LEFT JOIN ${TABLE_SCHEMA}.opening_schedule os1
                ON os1.opening_schedule_id = e.opening_schedule_id1
            LEFT JOIN ${TABLE_SCHEMA}.weekday_master wd1
                ON wd1.weekday_id = os1.weekday_id
            LEFT JOIN ${TABLE_SCHEMA}.opening_schedule os2
                ON os2.opening_schedule_id = e.opening_schedule_id2
            LEFT JOIN ${TABLE_SCHEMA}.weekday_master wd2
                ON wd2.weekday_id = os2.weekday_id
            WHERE e.student_id = $1
            ORDER BY subject.subject_id, e.enrollment_id
        `, [normalizedStudentId])
    ]);

    if (!studentResult.rows[0]) {
        throw httpError(404, "ไม่พบ student");
    }

    return {
        student: mapStudent(studentResult.rows[0]),
        enrollments: enrollmentResult.rows.map(mapEnrollment)
    };
}

export async function createStudent(payload) {
    const data = studentPayload(payload);

    requireStudentCreateFields(data);

    const duplicate = await findStudentDuplicate({
        firstName: data.firstName,
        lastName: data.lastName
    });

    if (duplicate) {
        throw httpError(409, `มีเด็กชื่อนี้แล้ว: #${duplicate.studentId} ${duplicate.displayName}`);
    }

    const result = await pool.query(`
        INSERT INTO ${TABLE_SCHEMA}.student (
            prefix_id, first_name, last_name, nickname, gender_id, birth_date,
            school_grade_id, school_name, mobile, email, address_number,
            address_village, address_alley, address_road, address_subdistrict,
            address_district, address_province, address_zipcode, remark
        )
        VALUES (
            $1, $2, $3, $4, $5, $6,
            $7, $8, $9, $10, $11,
            $12, $13, $14, $15,
            $16, $17, $18, $19
        )
        RETURNING student_id
    `, [
        data.prefixId,
        data.firstName,
        data.lastName,
        data.nickname,
        data.genderId,
        data.birthDate,
        data.schoolGradeId,
        data.schoolName,
        data.mobile,
        data.email,
        data.addressNumber,
        data.addressVillage,
        data.addressAlley,
        data.addressRoad,
        data.addressSubdistrict,
        data.addressDistrict,
        data.addressProvince,
        data.addressZipcode,
        data.remark
    ]);

    return getStudentProfile(result.rows[0].student_id);
}

export async function deleteStudentIfNoEnrollment(studentId) {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const result = await pool.query(`
        SELECT
            student.student_id,
            COUNT(enrollment.enrollment_id)::integer AS enrollment_count
        FROM ${TABLE_SCHEMA}.student student
        LEFT JOIN ${TABLE_SCHEMA}.enrollment enrollment
            ON enrollment.student_id = student.student_id
        WHERE student.student_id = $1
        GROUP BY student.student_id
    `, [normalizedStudentId]);
    const row = result.rows[0];

    if (!row) {
        throw httpError(404, "ไม่พบ student");
    }

    if (Number(row.enrollment_count) > 0) {
        throw httpError(409, "ลบไม่ได้ เพราะ student นี้มี enrollment แล้ว");
    }

    await pool.query(`
        DELETE FROM ${TABLE_SCHEMA}.student
        WHERE student_id = $1
    `, [normalizedStudentId]);

    return {
        deletedStudentId: normalizedStudentId
    };
}

export async function updateStudent(studentId, payload) {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const data = studentPayload(payload);

    if (!data.firstName || !data.lastName) {
        throw httpError(400, "กรุณากรอกชื่อและนามสกุล");
    }

    const result = await pool.query(`
        UPDATE ${TABLE_SCHEMA}.student
        SET
            prefix_id = $1,
            first_name = $2,
            last_name = $3,
            nickname = $4,
            gender_id = $5,
            birth_date = $6,
            school_grade_id = $7,
            school_name = $8,
            mobile = $9,
            email = $10,
            address_number = $11,
            address_village = $12,
            address_alley = $13,
            address_road = $14,
            address_subdistrict = $15,
            address_district = $16,
            address_province = $17,
            address_zipcode = $18,
            remark = $19,
            updated_at = CURRENT_TIMESTAMP
        WHERE student_id = $20
        RETURNING student_id
    `, [
        data.prefixId,
        data.firstName,
        data.lastName,
        data.nickname,
        data.genderId,
        data.birthDate,
        data.schoolGradeId,
        data.schoolName,
        data.mobile,
        data.email,
        data.addressNumber,
        data.addressVillage,
        data.addressAlley,
        data.addressRoad,
        data.addressSubdistrict,
        data.addressDistrict,
        data.addressProvince,
        data.addressZipcode,
        data.remark,
        normalizedStudentId
    ]);

    if (!result.rows[0]) {
        throw httpError(404, "ไม่พบ student");
    }

    return getStudentProfile(normalizedStudentId);
}

export async function createEnrollment(studentId, payload) {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const data = enrollmentPayload(payload);
    const dtData = dtPayload(payload.dt);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const startingLevelResult = await client.query(`
            SELECT level_master_id
            FROM ${TABLE_SCHEMA}.worksheet_master
            WHERE worksheet_master_id = $1
        `, [data.startingWorksheetMasterId]);

        if (!startingLevelResult.rows[0]) {
            throw httpError(400, "Start worksheet ไม่ถูกต้อง");
        }

        data.currentLevelMasterId = Number(startingLevelResult.rows[0].level_master_id);
        await assertEnrollmentMasters(client, data);

        if (dtData) {
            const dtMasterResult = await client.query(`
                SELECT
                    dt_master_id,
                    subject_id,
                    max_score,
                    max_time
                FROM ${TABLE_SCHEMA}.dt_master
                WHERE dt_master_id = $1
            `, [dtData.dtMasterId]);
            const dtMaster = dtMasterResult.rows[0];

            if (!dtMaster || Number(dtMaster.subject_id) !== Number(data.subjectId)) {
                throw httpError(400, "DT test ไม่ตรงกับวิชา");
            }

            if (dtData.score > Number(dtMaster.max_score)) {
                throw httpError(400, `DT score ต้องไม่เกิน ${dtMaster.max_score}`);
            }

            const dtResult = await client.query(`
                SELECT 1
                FROM ${TABLE_SCHEMA}.dt_result_master
                WHERE dt_result_master.dt_master_id = $1
                  AND dt_result_master.worksheet_master_id = $2
                LIMIT 1
            `, [dtData.dtMasterId, data.startingWorksheetMasterId]);

            if (!dtResult.rows[0]) {
                throw httpError(400, "Start worksheet ไม่ตรงกับ DT test");
            }
        }

        const result = await client.query(`
            INSERT INTO ${TABLE_SCHEMA}.enrollment (
                student_id, subject_id, kumon_student_id, current_level_master_id,
                is_kumon_connect, current_zun_level_master_id, starting_worksheet_master_id,
                en_start_date, opening_schedule_id1, opening_schedule_id2,
                current_status_group1_id, current_status_group2_id, remark
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            RETURNING enrollment_id
        `, [
            normalizedStudentId,
            data.subjectId,
            data.kumonStudentId,
            data.currentLevelMasterId,
            data.isKumonConnect,
            data.currentZunLevelMasterId,
            data.startingWorksheetMasterId,
            data.enStartDate,
            data.openingScheduleId1,
            data.openingScheduleId2,
            data.currentStatusGroup1Id,
            data.currentStatusGroup2Id,
            data.remark
        ]);
        const enrollmentId = result.rows[0].enrollment_id;

        if (dtData) {
            await client.query(`
                INSERT INTO ${TABLE_SCHEMA}.dt_used (
                    enrollment_id,
                    dt_master_id,
                    dt_date,
                    score,
                    used_time,
                    starting_worksheet_master_id
                )
                VALUES ($1, $2, $3, $4, $5, $6)
            `, [
                enrollmentId,
                dtData.dtMasterId,
                dtData.dtDate,
                dtData.score,
                dtData.usedTime,
                data.startingWorksheetMasterId
            ]);
        }

        await client.query("COMMIT");
        return {
            enrollmentId,
            profile: await getStudentProfile(normalizedStudentId)
        };
    } catch (error) {
        await client.query("ROLLBACK");

        if (error.code === "23505") {
            throw httpError(409, "เด็กคนนี้มีวิชานี้อยู่แล้ว");
        }

        throw error;
    } finally {
        client.release();
    }
}

export async function updateEnrollment(studentId, enrollmentId, payload) {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const normalizedEnrollmentId = requiredInt(enrollmentId, "Enrollment ID");
    const data = enrollmentPayload(payload);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        data.currentLevelMasterId = requiredInt(
            data.currentLevelMasterId,
            "ระดับที่เรียน"
        );
        await assertEnrollmentMasters(client, data);

        const result = await client.query(`
            UPDATE ${TABLE_SCHEMA}.enrollment
            SET
                subject_id = $1,
                kumon_student_id = $2,
                is_kumon_connect = $3,
                current_level_master_id = $4,
                current_zun_level_master_id = $5,
                starting_worksheet_master_id = $6,
                en_start_date = $7,
                opening_schedule_id1 = $8,
                opening_schedule_id2 = $9,
                current_status_group1_id = $10,
                current_status_group2_id = $11,
                remark = $12,
                updated_at = CURRENT_TIMESTAMP
            WHERE enrollment_id = $13
              AND student_id = $14
            RETURNING enrollment_id
        `, [
            data.subjectId,
            data.kumonStudentId,
            data.isKumonConnect,
            data.currentLevelMasterId,
            data.currentZunLevelMasterId,
            data.startingWorksheetMasterId,
            data.enStartDate,
            data.openingScheduleId1,
            data.openingScheduleId2,
            data.currentStatusGroup1Id,
            data.currentStatusGroup2Id,
            data.remark,
            normalizedEnrollmentId,
            normalizedStudentId
        ]);

        if (!result.rows[0]) {
            throw httpError(404, "ไม่พบ enrollment ของ student นี้");
        }

        await client.query("COMMIT");
        return {
            enrollmentId: normalizedEnrollmentId,
            profile: await getStudentProfile(normalizedStudentId)
        };
    } catch (error) {
        await client.query("ROLLBACK");

        if (error.code === "23505") {
            throw httpError(409, "เด็กคนนี้มีวิชานี้อยู่แล้ว");
        }

        throw error;
    } finally {
        client.release();
    }
}

export async function deleteEnrollmentIfNoBilling(studentId, enrollmentId) {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const normalizedEnrollmentId = requiredInt(enrollmentId, "Enrollment ID");
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const enrollmentResult = await client.query(`
            SELECT enrollment_id
            FROM ${TABLE_SCHEMA}.enrollment
            WHERE student_id = $1
              AND enrollment_id = $2
            FOR UPDATE
        `, [normalizedStudentId, normalizedEnrollmentId]);

        if (!enrollmentResult.rows[0]) {
            throw httpError(404, "ไม่พบ enrollment ของ student นี้");
        }

        const billingResult = await client.query(`
            SELECT 1
            FROM ${TABLE_SCHEMA}.billing_detail
            WHERE enrollment_id = $1
            LIMIT 1
        `, [normalizedEnrollmentId]);

        if (billingResult.rows[0]) {
            throw httpError(409, "ลบ subject ไม่ได้ เพราะมี billing แล้ว");
        }

        const deletedDtResult = await client.query(`
            DELETE FROM ${TABLE_SCHEMA}.dt_used
            WHERE enrollment_id = $1
        `, [normalizedEnrollmentId]);
        await client.query(`
            DELETE FROM ${TABLE_SCHEMA}.enrollment
            WHERE enrollment_id = $1
              AND student_id = $2
        `, [normalizedEnrollmentId, normalizedStudentId]);
        await client.query("COMMIT");

        return {
            deletedEnrollmentId: normalizedEnrollmentId,
            deletedDtRows: deletedDtResult.rowCount,
            profile: await getStudentProfile(normalizedStudentId)
        };
    } catch (error) {
        await client.query("ROLLBACK");

        if (error.code === "23503") {
            throw httpError(409, "ลบ subject ไม่ได้ เพราะมีประวัติอื่นผูกอยู่แล้ว");
        }

        throw error;
    } finally {
        client.release();
    }
}

async function statusIdByCode(client, code, group = 1) {
    const result = await client.query(`
        SELECT status_id
        FROM ${TABLE_SCHEMA}.status_master
        WHERE status_code = $1
          AND status_group = $2
    `, [code, group]);

    if (!result.rows[0]) {
        throw httpError(500, `ไม่พบ status ${code}`);
    }

    return Number(result.rows[0].status_id);
}

async function latestBillingPeriodForEnrollment(client, enrollmentId) {
    const result = await client.query(`
        SELECT
            billing.billing_month,
            billing.billing_year
        FROM ${TABLE_SCHEMA}.billing_detail detail
        JOIN ${TABLE_SCHEMA}.billing billing
            ON billing.billing_id = detail.billing_id
        WHERE detail.enrollment_id = $1
        ORDER BY billing.billing_year DESC,
                 billing.billing_month DESC,
                 billing.billing_date DESC,
                 billing.billing_id DESC
        LIMIT 1
    `, [enrollmentId]);
    const row = result.rows[0];

    return row
        ? { month: Number(row.billing_month), year: Number(row.billing_year) }
        : null;
}

async function insertEnrollmentStatusIfMissing(client, {
    enrollmentId,
    statusId,
    period
}) {
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
        enrollmentId,
        statusId,
        period.month,
        period.year
    ]);

    return Boolean(result.rows[0]);
}

async function lockEnrollmentForAction(client, studentId, enrollmentId) {
    const result = await client.query(`
        SELECT
            e.*,
            subject.subject_code,
            level.level_code AS current_level_code,
            EXISTS (
                SELECT 1
                FROM ${TABLE_SCHEMA}.at_used at_used
                JOIN ${TABLE_SCHEMA}.at_master at_master
                    ON at_master.at_master_id = at_used.at_master_id
                WHERE at_used.enrollment_id = e.enrollment_id
                  AND at_master.level_master_id = e.current_level_master_id
                  AND at_used.is_pass = TRUE
            ) AS has_passed_current_level_at
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.level_master level
            ON level.level_master_id = e.current_level_master_id
        WHERE e.student_id = $1
          AND e.enrollment_id = $2
        FOR UPDATE
    `, [studentId, enrollmentId]);

    if (!result.rows[0]) {
        throw httpError(404, "ไม่พบ enrollment ของ student นี้");
    }

    return result.rows[0];
}

async function hasOtherActiveEnrollment(client, studentId, enrollmentId) {
    const result = await client.query(`
        SELECT 1
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.status_master status
            ON status.status_id = e.current_status_group1_id
        WHERE e.student_id = $1
          AND e.enrollment_id <> $2
          AND status.status_code NOT IN ('A', 'OT', 'CP')
        LIMIT 1
    `, [studentId, enrollmentId]);

    return Boolean(result.rows[0]);
}

export async function applyEnrollmentStatusAction(studentId, enrollmentId, payload = {}) {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const normalizedEnrollmentId = requiredInt(enrollmentId, "Enrollment ID");
    const action = String(payload.action || "").trim();
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        const enrollment = await lockEnrollmentForAction(
            client,
            normalizedStudentId,
            normalizedEnrollmentId
        );
        let statusCode = null;
        let period = null;
        let message = "";
        let insertedStatus = false;

        if (action === "absent" || action === "outgoingTransfer") {
            statusCode = action === "absent" ? "A" : "OT";
            const latestPeriod = await latestBillingPeriodForEnrollment(client, normalizedEnrollmentId);

            period = latestPeriod ? nextPeriod(latestPeriod) : currentKumonPeriod();
            const statusId = await statusIdByCode(client, statusCode);

            await client.query(`
                UPDATE ${TABLE_SCHEMA}.enrollment
                SET current_status_group1_id = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE enrollment_id = $2
                  AND student_id = $3
            `, [statusId, normalizedEnrollmentId, normalizedStudentId]);
            insertedStatus = await insertEnrollmentStatusIfMissing(client, {
                enrollmentId: normalizedEnrollmentId,
                statusId,
                period
            });
            message = `${statusCode} แล้ว: ลง enrollment status เดือน ${period.month}/${period.year}${insertedStatus ? "" : " (มีรายการนี้อยู่แล้ว)"}`;
        } else if (action === "resume") {
            const resumeDate = requiredDate(payload.resumeDate, "วันที่กลับมาเรียน");
            const resumePeriod = kumonPeriodFromDate(resumeDate);
            const latestPeriod = await latestBillingPeriodForEnrollment(client, normalizedEnrollmentId);
            const missedMonths = latestPeriod
                ? Math.max(0, monthIndex(resumePeriod) - monthIndex(latestPeriod) - 1)
                : 0;
            const resumeStatusCode = missedMonths <= 3
                ? "R"
                : (await hasOtherActiveEnrollment(client, normalizedStudentId, normalizedEnrollmentId) ? "EO" : "N");
            const statusId = await statusIdByCode(client, resumeStatusCode);
            const halfMonthStatusId = isHalfMonthDate(resumeDate)
                ? await statusIdByCode(client, "H", 2)
                : null;
            const shouldUpdateStartDate = ["N", "EO"].includes(resumeStatusCode);

            await client.query(`
                UPDATE ${TABLE_SCHEMA}.enrollment
                SET current_status_group1_id = $1,
                    current_status_group2_id = $2,
                    en_start_date = CASE WHEN $3 THEN $4 ELSE en_start_date END,
                    updated_at = CURRENT_TIMESTAMP
                WHERE enrollment_id = $5
                  AND student_id = $6
            `, [
                statusId,
                halfMonthStatusId,
                shouldUpdateStartDate,
                resumeDate,
                normalizedEnrollmentId,
                normalizedStudentId
            ]);
            message = `Resume แล้ว: status ${resumeStatusCode}, เดือนคิดเงิน ${resumePeriod.month}/${resumePeriod.year}, หยุด ${missedMonths} เดือน${halfMonthStatusId ? ", Half Month" : ""}${shouldUpdateStartDate ? ", อัปเดต start date" : ""}`;
        } else if (action === "completer") {
            if (!isCompleterLevel(enrollment.subject_code, enrollment.current_level_code)
                || enrollment.has_passed_current_level_at !== true) {
                throw httpError(400, "Completer ใช้ได้เฉพาะ ME/EFL level O หรือ TRP level III ที่สอบ AT ผ่านแล้ว");
            }

            statusCode = "CP";
            period = currentKumonPeriod();
            const statusId = await statusIdByCode(client, statusCode);

            await client.query(`
                UPDATE ${TABLE_SCHEMA}.enrollment
                SET current_status_group1_id = $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE enrollment_id = $2
                  AND student_id = $3
            `, [statusId, normalizedEnrollmentId, normalizedStudentId]);
            insertedStatus = await insertEnrollmentStatusIfMissing(client, {
                enrollmentId: normalizedEnrollmentId,
                statusId,
                period
            });
            message = `Completer แล้ว: ลง enrollment status เดือน ${period.month}/${period.year}${insertedStatus ? "" : " (มีรายการนี้อยู่แล้ว)"}`;
        } else {
            throw httpError(400, "Action ไม่ถูกต้อง");
        }

        await client.query("COMMIT");

        return {
            enrollmentId: normalizedEnrollmentId,
            message,
            profile: await getStudentProfile(normalizedStudentId)
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function getStudentHistory(studentId, type = "ws") {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const normalizedType = String(type || "ws").toLowerCase();
    return getStudentHistoryRows({
        studentId: normalizedStudentId,
        type: normalizedType
    });
}

export async function getStudentWsGraph({
    studentId,
    enrollmentId = null,
    range = "12"
}) {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const normalizedEnrollmentId = enrollmentId ? requiredInt(enrollmentId, "Enrollment ID") : null;
    const normalizedRange = String(range || "12").toLowerCase();
    const monthLimit = ["3", "6", "12"].includes(normalizedRange)
        ? Number(normalizedRange)
        : null;
    const params = [normalizedStudentId];
    const filters = ["e.student_id = $1"];

    if (normalizedEnrollmentId) {
        params.push(normalizedEnrollmentId);
        filters.push(`used.enrollment_id = $${params.length}`);
    }

    if (monthLimit) {
        params.push(monthLimit);
        filters.push(`used.worksheet_date >= (CURRENT_DATE - ($${params.length}::int || ' months')::interval)::date`);
    }

    const result = await pool.query(`
        SELECT
            used.worksheet_date,
            used.enrollment_id,
            subject.subject_code,
            level.level_master_id,
            level.level_code,
            level.level_type,
            used.actual_worksheet_no,
            wm.worksheet_no AS packet_worksheet_no,
            used.cpws,
            used.is_stock_processed,
            COALESCE((to_jsonb(e)->>'is_kumon_connect')::boolean, FALSE) AS is_kumon_connect
        FROM ${TABLE_SCHEMA}.worksheet_used used
        JOIN ${TABLE_SCHEMA}.enrollment e
            ON e.enrollment_id = used.enrollment_id
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.worksheet_master wm
            ON wm.worksheet_master_id = used.worksheet_master_id
        JOIN ${TABLE_SCHEMA}.level_master level
            ON level.level_master_id = wm.level_master_id
        WHERE ${filters.join("\n          AND ")}
          AND level.level_type = 1
        ORDER BY used.worksheet_date ASC, used.worksheet_used_id ASC
    `, params);

    return {
        range: normalizedRange,
        rows: result.rows.map((row) => ({
            date: normalizeDate(row.worksheet_date),
            enrollmentId: row.enrollment_id,
            subjectCode: row.subject_code,
            levelMasterId: row.level_master_id,
            levelCode: row.level_code,
            worksheetType: Number(row.level_type) === 2 ? "ZUN" : "WS",
            worksheetNo: row.actual_worksheet_no,
            packetWorksheetNo: row.packet_worksheet_no,
            cpws: row.cpws,
            isStockProcessed: row.is_stock_processed,
            isKumonConnect: row.is_kumon_connect === true
        }))
    };
}

export async function getStudentHistoryRows({
    studentId,
    type = "ws",
    enrollmentId = null
}) {
    const normalizedStudentId = requiredInt(studentId, "Student ID");
    const normalizedType = String(type || "ws").toLowerCase();
    const normalizedEnrollmentId = enrollmentId ? requiredInt(enrollmentId, "Enrollment ID") : null;
    const params = [normalizedStudentId, HISTORY_LIMIT];
    const enrollmentFilter = normalizedEnrollmentId
        ? "AND e.enrollment_id = $3"
        : "";
    const billingEnrollmentFilter = normalizedEnrollmentId
        ? `AND EXISTS (
            SELECT 1
            FROM ${TABLE_SCHEMA}.billing_detail detail
            WHERE detail.billing_id = billing.billing_id
              AND detail.enrollment_id = $3
        )`
        : "";

    if (normalizedEnrollmentId) {
        params.push(normalizedEnrollmentId);
    }

    const commonEnrollmentJoin = `
        JOIN ${TABLE_SCHEMA}.enrollment e
            ON e.enrollment_id = used.enrollment_id
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
    `;

    const queries = {
        ws: {
            columns: ["date", "enrollment", "subject", "level", "worksheet", "packet", "cpws", "stock"],
            sql: `
                SELECT
                    used.worksheet_date AS date,
                    used.enrollment_id AS enrollment,
                    subject.subject_code AS subject,
                    level.level_code AS level,
                    CONCAT(level.level_code, used.actual_worksheet_no) AS worksheet,
                    wm.worksheet_no AS packet,
                    used.cpws,
                    used.is_stock_processed AS stock
                FROM ${TABLE_SCHEMA}.worksheet_used used
                ${commonEnrollmentJoin}
                JOIN ${TABLE_SCHEMA}.worksheet_master wm
                    ON wm.worksheet_master_id = used.worksheet_master_id
                JOIN ${TABLE_SCHEMA}.level_master level
                    ON level.level_master_id = wm.level_master_id
                WHERE e.student_id = $1
                  ${enrollmentFilter}
                ORDER BY used.worksheet_date DESC, used.worksheet_used_id DESC
                LIMIT $2
            `
        },
        cd: {
            columns: ["date", "enrollment", "subject", "level", "cd", "cpcd", "stock"],
            sql: `
                SELECT
                    used.cd_date AS date,
                    used.enrollment_id AS enrollment,
                    subject.subject_code AS subject,
                    level.level_code AS level,
                    cd.cd_no AS cd,
                    used.cpcd,
                    used.is_stock_processed AS stock
                FROM ${TABLE_SCHEMA}.cd_used used
                ${commonEnrollmentJoin}
                JOIN ${TABLE_SCHEMA}.cd_master cd
                    ON cd.cd_master_id = used.cd_master_id
                JOIN ${TABLE_SCHEMA}.level_master level
                    ON level.level_master_id = cd.level_master_id
                WHERE e.student_id = $1
                  ${enrollmentFilter}
                ORDER BY used.cd_date DESC, used.cd_used_id DESC
                LIMIT $2
            `
        },
        at: {
            columns: ["date", "enrollment", "subject", "level", "score", "time", "group", "pass"],
            sql: `
                SELECT
                    used.at_date AS date,
                    used.enrollment_id AS enrollment,
                    subject.subject_code AS subject,
                    level.level_code AS level,
                    used.score,
                    used.used_time AS time,
                    used.at_group AS group,
                    used.is_pass AS pass
                FROM ${TABLE_SCHEMA}.at_used used
                ${commonEnrollmentJoin}
                JOIN ${TABLE_SCHEMA}.at_master at_master
                    ON at_master.at_master_id = used.at_master_id
                JOIN ${TABLE_SCHEMA}.level_master level
                    ON level.level_master_id = at_master.level_master_id
                WHERE e.student_id = $1
                  ${enrollmentFilter}
                ORDER BY used.at_date DESC, used.at_used_id DESC
                LIMIT $2
            `
        },
        dt: {
            columns: ["date", "enrollment", "subject", "level", "score", "time", "startingWorksheet"],
            sql: `
                SELECT
                    used.dt_date AS date,
                    used.enrollment_id AS enrollment,
                    subject.subject_code AS subject,
                    dt_master.test_level AS level,
                    used.score,
                    used.used_time AS time,
                    CONCAT(start_level.level_code, start_ws.worksheet_no) AS "startingWorksheet"
                FROM ${TABLE_SCHEMA}.dt_used used
                ${commonEnrollmentJoin}
                JOIN ${TABLE_SCHEMA}.dt_master dt_master
                    ON dt_master.dt_master_id = used.dt_master_id
                JOIN ${TABLE_SCHEMA}.worksheet_master start_ws
                    ON start_ws.worksheet_master_id = used.starting_worksheet_master_id
                JOIN ${TABLE_SCHEMA}.level_master start_level
                    ON start_level.level_master_id = start_ws.level_master_id
                WHERE e.student_id = $1
                  ${enrollmentFilter}
                ORDER BY used.dt_date DESC, used.dt_used_id DESC
                LIMIT $2
            `
        },
        billing: {
            columns: ["date", "receipt", "month", "year", "payment", "total", "discount", "net"],
            sql: `
                SELECT
                    billing.billing_date AS date,
                    CONCAT(billing.receipt_book, '/', billing.receipt_no) AS receipt,
                    billing.billing_month AS month,
                    billing.billing_year AS year,
                    payment.payment_method_name AS payment,
                    billing.total_amount AS total,
                    billing.discount_amount AS discount,
                    billing.net_amount AS net
                FROM ${TABLE_SCHEMA}.billing billing
                JOIN ${TABLE_SCHEMA}.payment_method_master payment
                    ON payment.payment_method_id = billing.payment_method_id
                WHERE billing.student_id = $1
                  ${billingEnrollmentFilter}
                ORDER BY billing.billing_date DESC, billing.billing_id DESC
                LIMIT $2
            `
        },
        status: {
            columns: ["month", "year", "enrollment", "subject", "status"],
            sql: `
                SELECT
                    used.status_month AS month,
                    used.status_year AS year,
                    used.enrollment_id AS enrollment,
                    subject.subject_code AS subject,
                    status.status_name AS status
                FROM ${TABLE_SCHEMA}.enrollment_status used
                ${commonEnrollmentJoin}
                JOIN ${TABLE_SCHEMA}.status_master status
                    ON status.status_id = used.status_id
                WHERE e.student_id = $1
                  ${enrollmentFilter}
                ORDER BY used.status_year DESC, used.status_month DESC, used.enrollment_status_id DESC
                LIMIT $2
            `
        }
    };
    const query = queries[normalizedType] || queries.ws;
    const result = await pool.query(query.sql, params);

    return {
        type: queries[normalizedType] ? normalizedType : "ws",
        columns: query.columns,
        rows: result.rows.map((row) => {
            const output = {};
            query.columns.forEach((column) => {
                const value = row[column];
                output[column] = value instanceof Date ? normalizeDate(value) : value;
            });
            return output;
        })
    };
}
