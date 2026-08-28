import pool from "../config/db.js";
import { httpError } from "./httpError.js";

const TABLE_SCHEMA = "kumon";

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
