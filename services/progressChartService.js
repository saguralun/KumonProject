import pool from "../config/db.js";
import {
    computeGradeSyncStatus,
    GRADE_LEVEL_GROUPS_BY_SUBJECT,
    GRADE_SYNC_THRESHOLDS
} from "./worksheetService.js";

const TABLE_SCHEMA = "kumon";
const ACTIVE_STATUS_CODES = ["N", "EO", "IT", "R", "C"];
const MAIN_MAX_WORKSHEET_NO = 200;
const PACKET_DISPLAY_OFFSET = 9;

function flattenLevels(groups) {
    return groups.flatMap((group) => group.levels);
}

// Inverts computeGradeSyncStatus's month math: given a number of months of
// curriculum progress, find where that lands as a fractional position on
// the flattened level axis (levelIndex + how far into that specific level).
// Used to draw the 0/6M/2Y/3Y/5Y/7Y reference lines on the same scale
// students are plotted on.
function monthsToLevelPosition(months, groups, levelIndexByCode) {
    const totalMonths = groups.length * 12;
    const clamped = Math.max(0, Math.min(months, totalMonths - 0.0001));
    const groupIndex = Math.floor(clamped / 12);
    const group = groups[groupIndex];
    const withinGroupMonths = clamped - (groupIndex * 12);
    const sliceMonths = 12 / group.levels.length;
    const withinLevelIndex = Math.min(
        group.levels.length - 1,
        Math.floor(withinGroupMonths / sliceMonths)
    );
    const fractionWithinLevel = (withinGroupMonths - (withinLevelIndex * sliceMonths)) / sliceMonths;
    const levelCode = group.levels[withinLevelIndex];

    return levelIndexByCode.get(levelCode) + fractionWithinLevel;
}

function buildReferenceLines(groups, levelIndexByCode) {
    // 0 months = "exactly on pace" baseline, not itself a badge tier but
    // useful as the floor every other threshold line sits above.
    const thresholds = [
        { code: "0", label: "ทันชั้นเรียนพอดี", minMonths: 0 },
        ...GRADE_SYNC_THRESHOLDS.filter((entry) => entry.minMonths > 0)
    ];

    return thresholds.map((threshold) => ({
        code: threshold.code,
        label: threshold.label,
        points: groups.map((group, gradeIndex) => ({
            grade: group.schoolClass,
            levelPosition: monthsToLevelPosition(
                (gradeIndex * 12) + threshold.minMonths,
                groups,
                levelIndexByCode
            )
        }))
    }));
}

async function loadActiveStudentsForSubject(subjectCode) {
    // active_enrollments narrows to this subject's ~150-200 active students
    // FIRST. latest_ws then only has to scan worksheet_used (300k+ rows)
    // joined against that small set — the original version joined
    // worksheet_used against every enrollment in the whole system inside
    // the CTE, which Postgres re-ran as a correlated nested loop once per
    // outer row (166 loops) instead of once: ~15s instead of ~0.1s.
    const result = await pool.query(`
        WITH active_enrollments AS (
            SELECT
                e.enrollment_id,
                e.student_id,
                e.current_level_master_id,
                e.is_kumon_connect
            FROM ${TABLE_SCHEMA}.enrollment e
            JOIN ${TABLE_SCHEMA}.subject_master subject
                ON subject.subject_id = e.subject_id
            JOIN ${TABLE_SCHEMA}.level_master current_level
                ON current_level.level_master_id = e.current_level_master_id
            JOIN ${TABLE_SCHEMA}.status_master status
                ON status.status_id = e.current_status_group1_id
            WHERE subject.subject_code = $1
              AND current_level.level_type = 1
              AND status.status_code = ANY($2::text[])
        ),
        latest_ws AS (
            SELECT DISTINCT ON (wu.enrollment_id)
                wu.enrollment_id,
                wu.actual_worksheet_no
            FROM ${TABLE_SCHEMA}.worksheet_used wu
            JOIN active_enrollments ae
                ON ae.enrollment_id = wu.enrollment_id
            JOIN ${TABLE_SCHEMA}.worksheet_master wm
                ON wm.worksheet_master_id = wu.worksheet_master_id
            WHERE wu.cpws = TRUE
              AND wm.level_master_id = ae.current_level_master_id
            ORDER BY wu.enrollment_id, wu.worksheet_date DESC, wu.worksheet_used_id DESC
        )
        SELECT
            ae.enrollment_id,
            ae.student_id,
            student.first_name,
            student.last_name,
            student.nickname,
            grade.school_class AS school_grade_class,
            current_level.level_code AS current_level_code,
            COALESCE(lw.actual_worksheet_no, 0)::int AS actual_worksheet_no,
            ae.is_kumon_connect
        FROM active_enrollments ae
        JOIN ${TABLE_SCHEMA}.student student
            ON student.student_id = ae.student_id
        JOIN ${TABLE_SCHEMA}.level_master current_level
            ON current_level.level_master_id = ae.current_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.school_grade_master grade
            ON grade.school_grade_id = student.school_grade_id
        LEFT JOIN latest_ws lw
            ON lw.enrollment_id = ae.enrollment_id
        ORDER BY current_level.level_master_id, student.first_name
    `, [subjectCode, ACTIVE_STATUS_CODES]);

    return result.rows;
}

export async function getProgressChartData({ subjectCode }) {
    const normalizedSubject = String(subjectCode || "").toUpperCase();
    const groups = GRADE_LEVEL_GROUPS_BY_SUBJECT.get(normalizedSubject);

    if (!groups) {
        return { subjectCode: normalizedSubject, grades: [], levels: [], referenceLines: [], students: [] };
    }

    const flatLevels = flattenLevels(groups);
    const levelIndexByCode = new Map(flatLevels.map((code, index) => [code, index]));
    const grades = groups.map((group) => group.schoolClass);
    const referenceLines = buildReferenceLines(groups, levelIndexByCode);

    const rows = await loadActiveStudentsForSubject(normalizedSubject);
    const missingLevel = [];

    const students = rows
        .map((row) => {
            const levelIndex = levelIndexByCode.get(row.current_level_code);

            if (levelIndex === undefined) {
                missingLevel.push(row.current_level_code);

                return null;
            }

            const displayWorksheetNo = row.actual_worksheet_no
                ? Math.min(MAIN_MAX_WORKSHEET_NO, row.actual_worksheet_no + PACKET_DISPLAY_OFFSET)
                : 0;
            const percent = Math.max(0, Math.min(100, Math.round((displayWorksheetNo / MAIN_MAX_WORKSHEET_NO) * 100)));

            const gradeSyncStatus = computeGradeSyncStatus({
                subjectCode: normalizedSubject,
                schoolGradeClass: row.school_grade_class,
                currentLevelCode: row.current_level_code,
                progressPercent: percent
            });

            return {
                enrollmentId: row.enrollment_id,
                studentId: row.student_id,
                name: `${row.first_name || ""} ${row.last_name || ""}`.trim(),
                nickname: row.nickname || "",
                gradeClass: row.school_grade_class || null,
                levelCode: row.current_level_code,
                levelPosition: levelIndex + (percent / 100),
                percent,
                isKc: row.is_kumon_connect === true,
                gradeSyncStatus
            };
        })
        .filter(Boolean);

    return {
        subjectCode: normalizedSubject,
        grades,
        levels: flatLevels,
        referenceLines,
        students,
        missingLevelCount: missingLevel.length
    };
}
