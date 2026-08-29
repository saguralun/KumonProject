import pool from "../config/db.js";
import { httpError } from "./httpError.js";

const TABLE_SCHEMA = "kumon";
const FORECAST_CACHE_TABLE = "worksheet_forecast_average";
const FORECAST_CACHE_MAX_AGE_DAYS = 7;
const FORECAST_PACKET_NUMBERS = Array.from({ length: 20 }, (_, index) => (index * 10) + 1);
const ACTIVE_STATUS_CODES = ["N", "EO", "IT", "R", "C"];

// Matches the same "day 21+ rolls to next month" Kumon period rule used
// elsewhere (worksheetService.js / studentService.js / stockReceiveService.js)
// — a report for period (month, year) covers real calendar dates from the
// 21st of the prior month through the 20th of this month.
function periodDateRange(month, year) {
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const pad2 = (value) => String(value).padStart(2, "0");

    return {
        start: `${prevYear}-${pad2(prevMonth)}-21`,
        end: `${year}-${pad2(month)}-21`,
        prevMonth,
        prevYear
    };
}

// pg returns DATE columns as JS Date objects at local midnight — reading
// them back with getUTC*()/toISOString() shifts the date by a day in any
// timezone ahead of UTC, so this uses the same local-component extraction
// as normalizeDate() elsewhere (worksheetService.js) instead.
function formatThaiDate(value) {
    if (!value) {
        return "";
    }

    let year;
    let month;
    let day;

    if (value instanceof Date) {
        year = value.getFullYear();
        month = value.getMonth() + 1;
        day = value.getDate();
    } else {
        [year, month, day] = String(value).slice(0, 10).split("-").map(Number);
    }

    if (!year || !month || !day) {
        return "";
    }

    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function boolText(value) {
    return value ? "True" : "False";
}

function packetLabel(levelCode, worksheetNo) {
    return worksheetNo === null || worksheetNo === undefined ? "" : `${levelCode || ""}${worksheetNo}`;
}

function round2(value) {
    return Math.round(Number(value || 0) * 100) / 100;
}

async function hasForecastAverageTable(client = pool) {
    const result = await client.query(`
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = $1
          AND table_name = $2
          AND table_type = 'BASE TABLE'
    `, [TABLE_SCHEMA, FORECAST_CACHE_TABLE]);

    return result.rows.length > 0;
}

async function assertForecastAverageTable(client = pool) {
    if (!(await hasForecastAverageTable(client))) {
        throw httpError(409, "ยังไม่มีตาราง worksheet_forecast_average กรุณารัน database/006_create_worksheet_forecast_average.sql ก่อน");
    }
}

async function loadForecastCacheStatus(client = pool) {
    await assertForecastAverageTable(client);

    const result = await client.query(`
        SELECT
            MAX(calculated_at) AS calculated_at,
            COUNT(*)::int AS rows_count
        FROM ${TABLE_SCHEMA}.${FORECAST_CACHE_TABLE}
    `);
    const row = result.rows[0];
    const calculatedAt = row.calculated_at;
    const isFresh = Boolean(calculatedAt)
        && new Date(calculatedAt).getTime() >= Date.now() - (FORECAST_CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

    return {
        calculatedAt,
        rowsCount: Number(row.rows_count || 0),
        isFresh
    };
}

async function insertForecastAverages(client, sourceScope, fromDate = null) {
    const dateFilter = fromDate ? "AND wu.worksheet_date >= $1" : "";
    const params = fromDate ? [fromDate] : [];
    const result = await client.query(`
        WITH per_student_packet AS (
            SELECT
                e.subject_id,
                lm.level_master_id,
                wm.worksheet_no AS worksheet_packet_no,
                wu.enrollment_id,
                COUNT(DISTINCT wu.worksheet_date)::int AS days_count,
                COUNT(*)::int AS cpws_count,
                MIN(wu.worksheet_date) AS first_date,
                MAX(wu.worksheet_date) AS last_date
            FROM ${TABLE_SCHEMA}.worksheet_used wu
            JOIN ${TABLE_SCHEMA}.worksheet_master wm
              ON wm.worksheet_master_id = wu.worksheet_master_id
            JOIN ${TABLE_SCHEMA}.level_master lm
              ON lm.level_master_id = wm.level_master_id
            JOIN ${TABLE_SCHEMA}.enrollment e
              ON e.enrollment_id = wu.enrollment_id
            WHERE wu.cpws = TRUE
              AND lm.level_type = 1
              ${dateFilter}
            GROUP BY
                e.subject_id,
                lm.level_master_id,
                wm.worksheet_no,
                wu.enrollment_id
        )
        INSERT INTO ${TABLE_SCHEMA}.${FORECAST_CACHE_TABLE} (
            subject_id,
            level_master_id,
            worksheet_packet_no,
            source_scope,
            student_count,
            sample_count,
            avg_days_per_student,
            avg_cpws_per_student,
            min_days,
            max_days,
            min_cpws,
            max_cpws,
            calculated_from,
            calculated_to,
            calculated_at
        )
        SELECT
            subject_id,
            level_master_id,
            worksheet_packet_no,
            $${params.length + 1} AS source_scope,
            COUNT(*)::int AS student_count,
            SUM(cpws_count)::int AS sample_count,
            ROUND(AVG(days_count)::numeric, 2) AS avg_days_per_student,
            ROUND(AVG(cpws_count)::numeric, 2) AS avg_cpws_per_student,
            MIN(days_count)::int AS min_days,
            MAX(days_count)::int AS max_days,
            MIN(cpws_count)::int AS min_cpws,
            MAX(cpws_count)::int AS max_cpws,
            MIN(first_date) AS calculated_from,
            MAX(last_date) AS calculated_to,
            CURRENT_TIMESTAMP AS calculated_at
        FROM per_student_packet
        GROUP BY subject_id, level_master_id, worksheet_packet_no
        RETURNING worksheet_forecast_average_id
    `, [...params, sourceScope]);

    return result.rowCount;
}

export async function recalculateWorksheetForecastAverages() {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");
        await assertForecastAverageTable(client);
        await client.query(`DELETE FROM ${TABLE_SCHEMA}.${FORECAST_CACHE_TABLE}`);

        const twoYearsAgoResult = await client.query("SELECT (CURRENT_DATE - INTERVAL '2 years')::date AS from_date");
        const twoYearsAgo = twoYearsAgoResult.rows[0].from_date;
        const twoYearRows = await insertForecastAverages(client, "2Y", twoYearsAgo);
        const allRows = await insertForecastAverages(client, "ALL");

        await client.query("COMMIT");

        return {
            recalculated: true,
            twoYearRows,
            allRows,
            totalRows: twoYearRows + allRows,
            calculatedAt: new Date().toISOString()
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

async function ensureFreshForecastAverage({ force = false } = {}) {
    const before = await loadForecastCacheStatus();

    if (!force && before.isFresh && before.rowsCount > 0) {
        return {
            cacheAction: "ใช้ cache เดิม",
            recalculated: false,
            calculatedAt: before.calculatedAt,
            averageRows: before.rowsCount
        };
    }

    const recalculation = await recalculateWorksheetForecastAverages();

    return {
        cacheAction: "คำนวณค่าเฉลี่ยใหม่",
        recalculated: true,
        calculatedAt: recalculation.calculatedAt,
        averageRows: recalculation.totalRows,
        twoYearRows: recalculation.twoYearRows,
        allRows: recalculation.allRows
    };
}

async function loadForecastMasters() {
    const [levelResult, worksheetResult, averageResult] = await Promise.all([
        pool.query(`
            SELECT
                lm.level_master_id,
                lm.subject_id,
                sm.subject_code,
                lm.level_code,
                lm.next_level_master_id
            FROM ${TABLE_SCHEMA}.level_master lm
            JOIN ${TABLE_SCHEMA}.subject_master sm
              ON sm.subject_id = lm.subject_id
            WHERE lm.level_type = 1
            ORDER BY lm.subject_id, lm.level_master_id
        `),
        pool.query(`
            SELECT worksheet_master_id, level_master_id, worksheet_no, next_worksheet_master_id
            FROM ${TABLE_SCHEMA}.worksheet_master
            ORDER BY level_master_id, worksheet_no
        `),
        pool.query(`
            SELECT
                subject_id,
                level_master_id,
                worksheet_packet_no,
                source_scope,
                student_count,
                sample_count,
                avg_days_per_student,
                avg_cpws_per_student,
                calculated_at
            FROM ${TABLE_SCHEMA}.${FORECAST_CACHE_TABLE}
            ORDER BY subject_id, level_master_id, worksheet_packet_no, source_scope
        `)
    ]);

    const levelsById = new Map(levelResult.rows.map((row) => [Number(row.level_master_id), row]));
    const worksheetsByLevel = new Map();
    const worksheetById = new Map();

    worksheetResult.rows.forEach((row) => {
        const levelId = Number(row.level_master_id);
        const normalized = {
            worksheetMasterId: Number(row.worksheet_master_id),
            levelMasterId: levelId,
            worksheetNo: Number(row.worksheet_no),
            nextWorksheetMasterId: row.next_worksheet_master_id ? Number(row.next_worksheet_master_id) : null
        };

        worksheetById.set(normalized.worksheetMasterId, normalized);

        if (!worksheetsByLevel.has(levelId)) {
            worksheetsByLevel.set(levelId, []);
        }

        worksheetsByLevel.get(levelId).push(normalized);
    });

    const averages = new Map();

    averageResult.rows.forEach((row) => {
        const key = `${row.subject_id}:${row.level_master_id}:${row.worksheet_packet_no}`;
        const entry = {
            sourceScope: row.source_scope,
            studentCount: Number(row.student_count || 0),
            sampleCount: Number(row.sample_count || 0),
            avgDaysPerStudent: Number(row.avg_days_per_student || 0),
            avgCpwsPerStudent: Number(row.avg_cpws_per_student || 0),
            calculatedAt: row.calculated_at
        };

        if (!averages.has(key)) {
            averages.set(key, {});
        }

        averages.get(key)[row.source_scope] = entry;
    });

    return {
        levelsById,
        worksheetsByLevel,
        worksheetById,
        averages
    };
}

function averageForPacket(averages, subjectId, levelMasterId, packetNo) {
    const scopes = averages.get(`${subjectId}:${levelMasterId}:${packetNo}`) || {};

    return scopes["2Y"] || scopes.ALL || null;
}

function firstPacketForLevel(worksheetsByLevel, levelMasterId) {
    return (worksheetsByLevel.get(Number(levelMasterId)) || [])[0] || null;
}

function nextPacket({ current, levelsById, worksheetsByLevel, worksheetById }) {
    if (current?.nextWorksheetMasterId && worksheetById.has(current.nextWorksheetMasterId)) {
        return worksheetById.get(current.nextWorksheetMasterId);
    }

    const level = levelsById.get(Number(current?.levelMasterId));

    if (!level?.next_level_master_id) {
        return null;
    }

    return firstPacketForLevel(worksheetsByLevel, Number(level.next_level_master_id));
}

async function loadActiveForecastEnrollments(subjectCode) {
    const params = [ACTIVE_STATUS_CODES];
    const subjectFilter = subjectCode && subjectCode !== "all"
        ? `AND sm.subject_code = $${params.push(subjectCode)}`
        : "";

    const result = await pool.query(`
        WITH latest_ws AS (
            SELECT DISTINCT ON (wu.enrollment_id)
                wu.enrollment_id,
                wu.worksheet_master_id
            FROM ${TABLE_SCHEMA}.worksheet_used wu
            JOIN ${TABLE_SCHEMA}.worksheet_master wm
              ON wm.worksheet_master_id = wu.worksheet_master_id
            JOIN ${TABLE_SCHEMA}.level_master lm
              ON lm.level_master_id = wm.level_master_id
            WHERE wu.cpws = TRUE
              AND lm.level_type = 1
            ORDER BY wu.enrollment_id, wu.worksheet_date DESC, wu.worksheet_used_id DESC
        )
        SELECT
            e.enrollment_id,
            e.student_id,
            e.subject_id,
            sm.subject_code,
            e.current_level_master_id,
            e.starting_worksheet_master_id,
            e.is_kumon_connect,
            s.first_name,
            s.last_name,
            s.nickname,
            current_level.level_code AS current_level_code,
            latest_ws.worksheet_master_id AS latest_worksheet_master_id
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.student s
          ON s.student_id = e.student_id
        JOIN ${TABLE_SCHEMA}.subject_master sm
          ON sm.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.status_master status
          ON status.status_id = e.current_status_group1_id
        JOIN ${TABLE_SCHEMA}.level_master current_level
          ON current_level.level_master_id = e.current_level_master_id
        LEFT JOIN latest_ws
          ON latest_ws.enrollment_id = e.enrollment_id
        WHERE status.status_code = ANY($1::text[])
          ${subjectFilter}
        ORDER BY sm.subject_id, e.enrollment_id
    `, params);

    return result.rows;
}

function enrollmentStartPacket(enrollment, masters) {
    const latest = masters.worksheetById.get(Number(enrollment.latest_worksheet_master_id));

    if (latest && latest.levelMasterId === Number(enrollment.current_level_master_id)) {
        return latest;
    }

    const starting = masters.worksheetById.get(Number(enrollment.starting_worksheet_master_id));

    if (starting && starting.levelMasterId === Number(enrollment.current_level_master_id)) {
        return starting;
    }

    return firstPacketForLevel(masters.worksheetsByLevel, Number(enrollment.current_level_master_id));
}

function addForecastRow(rowMap, enrollment, packet, level, average) {
    const key = `${enrollment.subject_id}:${packet.levelMasterId}:${packet.worksheetNo}`;

    if (!rowMap.has(key)) {
        rowMap.set(key, {
            subjectId: Number(enrollment.subject_id),
            subject: enrollment.subject_code,
            levelMasterId: packet.levelMasterId,
            level: level?.level_code || enrollment.current_level_code,
            packet: packet.worksheetNo,
            label: packetLabel(level?.level_code || enrollment.current_level_code, packet.worksheetNo),
            neededCpws: 0,
            prepareQty: 0,
            students: 0,
            enrollments: [],
            avgDays: average.avgDaysPerStudent,
            avgCpws: average.avgCpwsPerStudent,
            avgSource: average.sourceScope,
            avgStudentCount: average.studentCount
        });
    }

    const row = rowMap.get(key);
    row.neededCpws = round2(row.neededCpws + average.avgCpwsPerStudent);
    row.prepareQty = Math.ceil(row.neededCpws);
    row.students += 1;

    if (row.enrollments.length < 8) {
        row.enrollments.push({
            enrollmentId: enrollment.enrollment_id,
            studentId: enrollment.student_id,
            name: `${enrollment.first_name || ""} ${enrollment.last_name || ""}`.trim(),
            nickname: enrollment.nickname || "",
            isKc: enrollment.is_kumon_connect === true
        });
    }
}

export async function buildWorksheetForecast({ days = 15, subject = "all", includeKc = "false", force = false } = {}) {
    const normalizedDays = Number(days);

    if (!Number.isFinite(normalizedDays) || normalizedDays <= 0 || normalizedDays > 365) {
        throw httpError(400, "จำนวนวัน forecast ต้องอยู่ระหว่าง 1-365");
    }

    const normalizedSubject = String(subject || "all").toUpperCase();
    const selectedSubject = normalizedSubject === "ALL" ? "all" : normalizedSubject;
    const includeKumonConnect = includeKc === true || includeKc === "true" || includeKc === "1";
    const cache = await ensureFreshForecastAverage({ force });
    const masters = await loadForecastMasters();
    const enrollments = (await loadActiveForecastEnrollments(selectedSubject))
        .filter((enrollment) => includeKumonConnect || enrollment.is_kumon_connect !== true);
    const rowsByPacket = new Map();
    const missingAverage = [];

    enrollments.forEach((enrollment) => {
        let remainingDays = normalizedDays;
        let packet = enrollmentStartPacket(enrollment, masters);
        let guard = 0;

        while (packet && remainingDays > 0 && guard < 80) {
            const level = masters.levelsById.get(Number(packet.levelMasterId));
            const average = averageForPacket(
                masters.averages,
                Number(enrollment.subject_id),
                Number(packet.levelMasterId),
                Number(packet.worksheetNo)
            );

            if (!average || average.avgDaysPerStudent <= 0 || average.avgCpwsPerStudent <= 0) {
                missingAverage.push({
                    enrollmentId: enrollment.enrollment_id,
                    subject: enrollment.subject_code,
                    level: level?.level_code || enrollment.current_level_code,
                    packet: packet.worksheetNo
                });
                break;
            }

            addForecastRow(rowsByPacket, enrollment, packet, level, average);
            remainingDays -= average.avgDaysPerStudent;
            packet = nextPacket({ current: packet, ...masters });
            guard += 1;
        }
    });

    const rows = [...rowsByPacket.values()]
        .sort((a, b) =>
            a.subjectId - b.subjectId
            || a.levelMasterId - b.levelMasterId
            || a.packet - b.packet
        );
    const totalPrepareQty = rows.reduce((sum, row) => sum + row.prepareQty, 0);
    const totalEstimatedCpws = round2(rows.reduce((sum, row) => sum + row.neededCpws, 0));

    return {
        cache,
        params: {
            days: normalizedDays,
            subject: selectedSubject,
            includeKc: includeKumonConnect
        },
        summary: {
            activeEnrollments: enrollments.length,
            forecastPackets: rows.length,
            totalPrepareQty,
            totalEstimatedCpws,
            missingAverage: missingAverage.length,
            cacheMaxAgeDays: FORECAST_CACHE_MAX_AGE_DAYS
        },
        rows,
        missingAverage: missingAverage.slice(0, 50)
    };
}

async function loadEnrollmentIdsWithActivity({ month, year, start, end }) {
    const result = await pool.query(`
        SELECT enrollment_id FROM ${TABLE_SCHEMA}.worksheet_used
            WHERE worksheet_month = $1 AND worksheet_year = $2
        UNION
        SELECT enrollment_id FROM ${TABLE_SCHEMA}.cd_used
            WHERE cd_month = $1 AND cd_year = $2
        UNION
        SELECT enrollment_id FROM ${TABLE_SCHEMA}.at_used
            WHERE at_date >= $3 AND at_date < $4
        UNION
        SELECT enrollment_id FROM ${TABLE_SCHEMA}.dt_used
            WHERE dt_date >= $3 AND dt_date < $4
    `, [month, year, start, end]);

    return result.rows.map((row) => row.enrollment_id);
}

async function loadEnrollmentBase(enrollmentIds) {
    const result = await pool.query(`
        SELECT
            e.enrollment_id,
            e.kumon_student_id,
            s.school_grade_id,
            sgm.school_grade,
            s.birth_date,
            e.en_start_date,
            lm_start.level_code AS start_level_code,
            wm_start.worksheet_no AS start_worksheet_no,
            s.first_name,
            s.last_name,
            s.nickname,
            sub.subject_code,
            st1.status_code AS status1_code,
            st2.status_code AS status2_code
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.student s ON s.student_id = e.student_id
        JOIN ${TABLE_SCHEMA}.subject_master sub ON sub.subject_id = e.subject_id
        LEFT JOIN ${TABLE_SCHEMA}.school_grade_master sgm ON sgm.school_grade_id = s.school_grade_id
        JOIN ${TABLE_SCHEMA}.worksheet_master wm_start ON wm_start.worksheet_master_id = e.starting_worksheet_master_id
        JOIN ${TABLE_SCHEMA}.level_master lm_start ON lm_start.level_master_id = wm_start.level_master_id
        JOIN ${TABLE_SCHEMA}.status_master st1 ON st1.status_id = e.current_status_group1_id
        LEFT JOIN ${TABLE_SCHEMA}.status_master st2 ON st2.status_id = e.current_status_group2_id
        WHERE e.enrollment_id = ANY($1::int[])
        ORDER BY sgm.school_grade_id NULLS LAST, s.first_name, e.enrollment_id
    `, [enrollmentIds]);

    return result.rows;
}

async function loadWorksheetSummary(enrollmentIds, month, year) {
    const result = await pool.query(`
        SELECT
            wu.enrollment_id,
            COUNT(*) FILTER (WHERE lm.level_type = 1)::int AS wks_used,
            COUNT(*) FILTER (WHERE lm.level_code = 'ZI')::int AS used_zi,
            COUNT(*) FILTER (WHERE lm.level_code = 'ZII')::int AS used_zii
        FROM ${TABLE_SCHEMA}.worksheet_used wu
        JOIN ${TABLE_SCHEMA}.worksheet_master wm ON wm.worksheet_master_id = wu.worksheet_master_id
        JOIN ${TABLE_SCHEMA}.level_master lm ON lm.level_master_id = wm.level_master_id
        WHERE wu.worksheet_month = $2 AND wu.worksheet_year = $3
          AND wu.enrollment_id = ANY($1::int[])
        GROUP BY wu.enrollment_id
    `, [enrollmentIds, month, year]);

    const byEnrollmentId = new Map();

    result.rows.forEach((row) => {
        byEnrollmentId.set(row.enrollment_id, row);
    });

    return byEnrollmentId;
}

// PrevLevel/CurrentLevel snapshot: the latest main-track (level_type=1)
// worksheet recorded within the prior/current worksheet_month+year bucket
// (the same period tag worksheet_used rows already carry, not a recomputed
// date boundary — that's what worksheet_month/worksheet_year are for).
// No cpws filter: TRP's 7A/6A worksheets are never marked cpws=true at
// all, so requiring it silently dropped every kid still in those levels.
// Ordering by date (not by actual_worksheet_no) is what keeps this correct
// across a level change within the same month — e.g. A161 done on the 3rd
// then B51 on the 18th: B51 is the true latest position even though 51 <
// 161, and picking by date rather than comparing the numbers gets that
// right without needing any level-ordinal comparison at all.
//
// Displayed worksheet number is +9 off the actual one (capped at 200),
// matching the "packet" display convention used everywhere else in the
// app (e.g. worksheet.js's displayWorksheetNo).
const MAIN_MAX_WORKSHEET_NO = 200;
const PACKET_DISPLAY_OFFSET = 9;

async function loadLevelSnapshots(enrollmentIds, prevMonth, prevYear, month, year) {
    const result = await pool.query(`
        WITH prev AS (
            SELECT DISTINCT ON (wu.enrollment_id)
                wu.enrollment_id,
                lm.level_code,
                wu.actual_worksheet_no
            FROM ${TABLE_SCHEMA}.worksheet_used wu
            JOIN ${TABLE_SCHEMA}.worksheet_master wm ON wm.worksheet_master_id = wu.worksheet_master_id
            JOIN ${TABLE_SCHEMA}.level_master lm ON lm.level_master_id = wm.level_master_id
            WHERE lm.level_type = 1
              AND wu.worksheet_month = $2 AND wu.worksheet_year = $3
              AND wu.enrollment_id = ANY($1::int[])
            ORDER BY wu.enrollment_id, wu.worksheet_date DESC, wu.worksheet_used_id DESC
        ),
        current AS (
            SELECT DISTINCT ON (wu.enrollment_id)
                wu.enrollment_id,
                lm.level_code,
                wu.actual_worksheet_no
            FROM ${TABLE_SCHEMA}.worksheet_used wu
            JOIN ${TABLE_SCHEMA}.worksheet_master wm ON wm.worksheet_master_id = wu.worksheet_master_id
            JOIN ${TABLE_SCHEMA}.level_master lm ON lm.level_master_id = wm.level_master_id
            WHERE lm.level_type = 1
              AND wu.worksheet_month = $4 AND wu.worksheet_year = $5
              AND wu.enrollment_id = ANY($1::int[])
            ORDER BY wu.enrollment_id, wu.worksheet_date DESC, wu.worksheet_used_id DESC
        )
        SELECT
            COALESCE(prev.enrollment_id, current.enrollment_id) AS enrollment_id,
            prev.level_code AS prev_level_code,
            prev.actual_worksheet_no AS prev_worksheet_no,
            current.level_code AS current_level_code,
            current.actual_worksheet_no AS current_worksheet_no
        FROM prev
        FULL OUTER JOIN current ON current.enrollment_id = prev.enrollment_id
    `, [enrollmentIds, prevMonth, prevYear, month, year]);

    const byEnrollmentId = new Map();

    result.rows.forEach((row) => {
        byEnrollmentId.set(row.enrollment_id, row);
    });

    return byEnrollmentId;
}

function displayWorksheetNo(actualWorksheetNo) {
    return actualWorksheetNo === null || actualWorksheetNo === undefined
        ? null
        : Math.min(MAIN_MAX_WORKSHEET_NO, Number(actualWorksheetNo) + PACKET_DISPLAY_OFFSET);
}

// Status1/Status2 as they actually were for this report's month, not
// enrollment's live current status — a report run later for a past month
// would otherwise show whatever status the enrollment has drifted to by
// today. Two sources, most authoritative first:
//   1. enrollment_status — a dedicated per-month history table, but it only
//      records the group-1 "event" codes (N/EO/IT/OT/R/A), not the routine
//      C/CP, and never group-2 at all.
//   2. billing_detail (joined to billing for the month) — a snapshot of
//      both status groups as they stood when that month was billed.
// Falls back to the enrollment's current status only if neither source has
// anything for that month (e.g. a month before either table's coverage).
async function loadMonthlyStatus(enrollmentIds, month, year) {
    const [historyResult, billingResult] = await Promise.all([
        pool.query(`
            SELECT DISTINCT ON (es.enrollment_id)
                es.enrollment_id,
                sm.status_code
            FROM ${TABLE_SCHEMA}.enrollment_status es
            JOIN ${TABLE_SCHEMA}.status_master sm ON sm.status_id = es.status_id
            WHERE es.status_month = $2 AND es.status_year = $3
              AND es.enrollment_id = ANY($1::int[])
            ORDER BY es.enrollment_id, es.enrollment_status_id DESC
        `, [enrollmentIds, month, year]),
        pool.query(`
            SELECT DISTINCT ON (bd.enrollment_id)
                bd.enrollment_id,
                s1.status_code AS status1_code,
                s2.status_code AS status2_code
            FROM ${TABLE_SCHEMA}.billing_detail bd
            JOIN ${TABLE_SCHEMA}.billing b ON b.billing_id = bd.billing_id
            LEFT JOIN ${TABLE_SCHEMA}.status_master s1 ON s1.status_id = bd.status_group1_id
            LEFT JOIN ${TABLE_SCHEMA}.status_master s2 ON s2.status_id = bd.status_group2_id
            WHERE b.billing_month = $2 AND b.billing_year = $3
              AND bd.enrollment_id = ANY($1::int[])
            ORDER BY bd.enrollment_id, bd.billing_detail_id DESC
        `, [enrollmentIds, month, year])
    ]);

    const historyByEnrollmentId = new Map(historyResult.rows.map((row) => [row.enrollment_id, row.status_code]));
    const billingByEnrollmentId = new Map(billingResult.rows.map((row) => [row.enrollment_id, row]));

    return { historyByEnrollmentId, billingByEnrollmentId };
}

async function loadCdUsed(enrollmentIds, month, year) {
    // DISTINCT ON (enrollment_id, cd_master_id, cd_date): the underlying
    // cd_used table has real duplicate rows for a large chunk of its
    // history (~half the table, matching the CD import duplicate-detection
    // bug fixed earlier — a pre-fix import run appears to have doubled up
    // the whole table). Collapsing here keeps the report correct without
    // needing to touch that data.
    const result = await pool.query(`
        SELECT enrollment_id, cd_date, cd_no, level_code
        FROM (
            SELECT DISTINCT ON (cu.enrollment_id, cu.cd_master_id, cu.cd_date)
                cu.enrollment_id,
                cu.cd_date,
                cm.cd_no,
                lm.level_code,
                cu.cd_used_id
            FROM ${TABLE_SCHEMA}.cd_used cu
            JOIN ${TABLE_SCHEMA}.cd_master cm ON cm.cd_master_id = cu.cd_master_id
            JOIN ${TABLE_SCHEMA}.level_master lm ON lm.level_master_id = cm.level_master_id
            WHERE cu.cd_month = $2 AND cu.cd_year = $3
              AND cu.enrollment_id = ANY($1::int[])
            ORDER BY cu.enrollment_id, cu.cd_master_id, cu.cd_date, cu.cd_used_id ASC
        ) deduped
        ORDER BY enrollment_id, cd_date ASC, cd_used_id ASC
    `, [enrollmentIds, month, year]);

    const byEnrollmentId = new Map();

    result.rows.forEach((row) => {
        if (!byEnrollmentId.has(row.enrollment_id)) {
            byEnrollmentId.set(row.enrollment_id, []);
        }

        byEnrollmentId.get(row.enrollment_id).push(row);
    });

    return byEnrollmentId;
}

async function loadTests(enrollmentIds, start, end) {
    const result = await pool.query(`
        SELECT
            au.enrollment_id,
            'AT' AS test_type,
            lm.level_code AS level_test,
            au.at_date AS date_test,
            au.at_group::text AS grp,
            au.score,
            am.max_score,
            au.used_time,
            am.max_time
        FROM ${TABLE_SCHEMA}.at_used au
        JOIN ${TABLE_SCHEMA}.at_master am ON am.at_master_id = au.at_master_id
        JOIN ${TABLE_SCHEMA}.level_master lm ON lm.level_master_id = am.level_master_id
        WHERE au.at_date >= $2 AND au.at_date < $3
          AND au.enrollment_id = ANY($1::int[])

        UNION ALL

        SELECT
            du.enrollment_id,
            'DT' AS test_type,
            dm.test_level AS level_test,
            du.dt_date AS date_test,
            NULL AS grp,
            du.score,
            dm.max_score,
            du.used_time,
            dm.max_time
        FROM ${TABLE_SCHEMA}.dt_used du
        JOIN ${TABLE_SCHEMA}.dt_master dm ON dm.dt_master_id = du.dt_master_id
        WHERE du.dt_date >= $2 AND du.dt_date < $3
          AND du.enrollment_id = ANY($1::int[])

        ORDER BY enrollment_id, date_test ASC
    `, [enrollmentIds, start, end]);

    const byEnrollmentId = new Map();

    result.rows.forEach((row) => {
        if (!byEnrollmentId.has(row.enrollment_id)) {
            byEnrollmentId.set(row.enrollment_id, []);
        }

        byEnrollmentId.get(row.enrollment_id).push(row);
    });

    return byEnrollmentId;
}

// Column order/names match the legacy monthly report exactly, so staff
// already used to that format see the same thing.
export const REPORT_COLUMNS = [
    "ID", "รหัสคุมอง", "IDGrade", "Grade", "วันเกิด", "วันที่สมัคร", "StartLevel",
    "ชื่อจริง", "นามสกุล", "ชื่อเล่น", "Subject", "FreeStudy", "FreeEnrolment",
    "TestType", "LevelTest", "DateTest", "Group", "Score", "MaxScore", "Time", "MaxTime",
    "TestType1", "LevelTest1", "DateTest1", "Group1", "Score1", "MaxScore1", "Time1", "MaxTime1",
    "TestType2", "LevelTest2", "DateTest2", "Group2", "Score2", "MaxScore2", "Time2", "MaxTime2",
    "PrevLevel", "CurrentLevel", "WksUsed", "Status1", "Status2", "UsedZI", "UsedZII",
    "DateCD1", "CD1", "Level1", "DateCD2", "CD2", "Level2", "DateCD3", "CD3", "Level3",
    "DateCD4", "CD4", "Level4", "DateCD5", "CD5", "Level5", "DateCD6", "CD6", "Level6"
];

export async function buildMonthlyReport({ month, year }) {
    const normalizedMonth = Number(month);
    const normalizedYear = Number(year);

    if (!Number.isInteger(normalizedMonth) || normalizedMonth < 1 || normalizedMonth > 12) {
        throw httpError(400, "เดือนไม่ถูกต้อง");
    }

    if (!Number.isInteger(normalizedYear) || normalizedYear < 2000 || normalizedYear > 2600) {
        throw httpError(400, "ปีไม่ถูกต้อง");
    }

    const { start, end, prevMonth, prevYear } = periodDateRange(normalizedMonth, normalizedYear);
    const enrollmentIds = await loadEnrollmentIdsWithActivity({
        month: normalizedMonth,
        year: normalizedYear,
        start,
        end
    });

    if (!enrollmentIds.length) {
        return [];
    }

    const [base, wsSummaryByEnrollmentId, levelSnapshotByEnrollmentId, cdByEnrollmentId, testsByEnrollmentId, monthlyStatus] = await Promise.all([
        loadEnrollmentBase(enrollmentIds),
        loadWorksheetSummary(enrollmentIds, normalizedMonth, normalizedYear),
        loadLevelSnapshots(enrollmentIds, prevMonth, prevYear, normalizedMonth, normalizedYear),
        loadCdUsed(enrollmentIds, normalizedMonth, normalizedYear),
        loadTests(enrollmentIds, start, end),
        loadMonthlyStatus(enrollmentIds, normalizedMonth, normalizedYear)
    ]);
    const { historyByEnrollmentId, billingByEnrollmentId } = monthlyStatus;

    return base.map((row) => {
        const ws = wsSummaryByEnrollmentId.get(row.enrollment_id);
        const levelSnapshot = levelSnapshotByEnrollmentId.get(row.enrollment_id);
        const billing = billingByEnrollmentId.get(row.enrollment_id);
        const status1Code = historyByEnrollmentId.get(row.enrollment_id)
            || billing?.status1_code
            || row.status1_code
            || "";
        const status2Code = billing?.status2_code || row.status2_code || "";
        const cds = cdByEnrollmentId.get(row.enrollment_id) || [];
        const tests = testsByEnrollmentId.get(row.enrollment_id) || [];
        const record = {
            ID: row.enrollment_id,
            รหัสคุมอง: row.kumon_student_id || "",
            IDGrade: row.school_grade_id ?? "",
            Grade: row.school_grade || "",
            วันเกิด: formatThaiDate(row.birth_date),
            วันที่สมัคร: formatThaiDate(row.en_start_date),
            StartLevel: packetLabel(row.start_level_code, row.start_worksheet_no),
            ชื่อจริง: row.first_name || "",
            นามสกุล: row.last_name || "",
            ชื่อเล่น: row.nickname || "",
            Subject: row.subject_code || "",
            FreeStudy: boolText(status2Code === "FS"),
            FreeEnrolment: boolText(status2Code === "FRG"),
            PrevLevel: levelSnapshot
                ? packetLabel(levelSnapshot.prev_level_code, displayWorksheetNo(levelSnapshot.prev_worksheet_no))
                : "",
            CurrentLevel: levelSnapshot
                ? packetLabel(levelSnapshot.current_level_code, displayWorksheetNo(levelSnapshot.current_worksheet_no))
                : "",
            WksUsed: ws ? ws.wks_used : 0,
            Status1: status1Code,
            Status2: status2Code,
            UsedZI: ws ? ws.used_zi : 0,
            UsedZII: ws ? ws.used_zii : 0
        };

        for (let slot = 0; slot < 3; slot++) {
            const suffix = slot === 0 ? "" : String(slot);
            const test = tests[slot];

            record[`TestType${suffix}`] = test?.test_type || "";
            record[`LevelTest${suffix}`] = test?.level_test || "";
            record[`DateTest${suffix}`] = test ? formatThaiDate(test.date_test) : "";
            record[`Group${suffix}`] = test?.grp || "";
            record[`Score${suffix}`] = test ? test.score : "";
            record[`MaxScore${suffix}`] = test ? test.max_score : "";
            record[`Time${suffix}`] = test ? test.used_time : "";
            record[`MaxTime${suffix}`] = test ? test.max_time : "";
        }

        for (let slot = 1; slot <= 6; slot++) {
            const cd = cds[slot - 1];

            // Legacy column naming is swapped from what it reads as: "CD{n}"
            // holds the level code and "Level{n}" holds the CD number.
            // Confirmed against the sample report (e.g. "...6A	1" for a
            // level with only one CD == level 6A, CD No.1).
            record[`DateCD${slot}`] = cd ? formatThaiDate(cd.cd_date) : "";
            record[`CD${slot}`] = cd ? cd.level_code : "";
            record[`Level${slot}`] = cd ? cd.cd_no : "";
        }

        return record;
    });
}
