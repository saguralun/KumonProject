import pool from "../config/db.js";
import { httpError } from "./httpError.js";

const TABLE_SCHEMA = "kumon";
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function normalizeTime(value, fieldName) {
    const raw = String(value || "").trim();

    if (!TIME_PATTERN.test(raw)) {
        throw httpError(400, `${fieldName} ต้องเป็นเวลา HH:MM`);
    }

    return raw;
}

function normalizeWeekdayId(value) {
    const weekdayId = Number(value);

    if (!Number.isInteger(weekdayId) || weekdayId < 1 || weekdayId > 7) {
        throw httpError(400, "กรุณาเลือกวันเปิด");
    }

    return weekdayId;
}

function formatSchedule(row) {
    return {
        id: row.opening_schedule_id,
        weekdayId: row.weekday_id,
        weekdayCode: row.weekday_code,
        weekdayName: row.weekday_name,
        startTime: row.start_time?.slice(0, 5),
        endTime: row.end_time?.slice(0, 5),
        label: `${row.weekday_name} ${row.start_time?.slice(0, 5)}-${row.end_time?.slice(0, 5)}`,
        isActive: row.is_active !== false,
        usageCount: Number(row.usage_count || 0),
        canDelete: Number(row.usage_count || 0) === 0
    };
}

async function hasScheduleActiveColumn(client = pool) {
    const result = await client.query(`
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = $1
          AND table_name = 'opening_schedule'
          AND column_name = 'is_active'
    `, [TABLE_SCHEMA]);

    return result.rows.length > 0;
}

async function getScheduleUsage(client = pool) {
    const result = await client.query(`
        SELECT opening_schedule_id, COUNT(*)::int AS usage_count
        FROM (
            SELECT opening_schedule_id1 AS opening_schedule_id
            FROM ${TABLE_SCHEMA}.enrollment
            WHERE opening_schedule_id1 IS NOT NULL
            UNION ALL
            SELECT opening_schedule_id2 AS opening_schedule_id
            FROM ${TABLE_SCHEMA}.enrollment
            WHERE opening_schedule_id2 IS NOT NULL
        ) usage_rows
        GROUP BY opening_schedule_id
    `);

    return new Map(result.rows.map((row) => [
        Number(row.opening_schedule_id),
        Number(row.usage_count)
    ]));
}

export async function listOpeningSchedules() {
    const supportsActive = await hasScheduleActiveColumn();
    const activeSelect = supportsActive ? "os.is_active" : "TRUE AS is_active";
    const [weekdayResult, scheduleResult, usageMap] = await Promise.all([
        pool.query(`
            SELECT weekday_id, weekday_code, weekday_name
            FROM ${TABLE_SCHEMA}.weekday_master
            ORDER BY weekday_id
        `),
        pool.query(`
            SELECT
                os.opening_schedule_id,
                os.weekday_id,
                wd.weekday_code,
                wd.weekday_name,
                os.start_time::text,
                os.end_time::text,
                ${activeSelect}
            FROM ${TABLE_SCHEMA}.opening_schedule os
            JOIN ${TABLE_SCHEMA}.weekday_master wd
              ON wd.weekday_id = os.weekday_id
            ORDER BY os.weekday_id, os.start_time
        `),
        getScheduleUsage()
    ]);

    const schedules = scheduleResult.rows.map((row) =>
        formatSchedule({
            ...row,
            usage_count: usageMap.get(Number(row.opening_schedule_id)) || 0
        })
    );

    const schedulesByWeekday = weekdayResult.rows.map((weekday) => ({
        weekdayId: weekday.weekday_id,
        weekdayCode: weekday.weekday_code,
        weekdayName: weekday.weekday_name,
        schedules: schedules.filter((schedule) => schedule.weekdayId === weekday.weekday_id)
    }));

    return {
        weekdays: weekdayResult.rows.map((row) => ({
            id: row.weekday_id,
            code: row.weekday_code,
            name: row.weekday_name
        })),
        schedules,
        schedulesByWeekday,
        summary: {
            weekdays: weekdayResult.rows.length,
            slots: schedules.length,
            activeSlots: schedules.filter((schedule) => schedule.isActive).length,
            inactiveSlots: schedules.filter((schedule) => !schedule.isActive).length,
            usedSlots: schedules.filter((schedule) => schedule.usageCount > 0).length,
            unusedSlots: schedules.filter((schedule) => schedule.usageCount === 0).length
        }
    };
}

export async function createOpeningSchedule(input) {
    const weekdayId = normalizeWeekdayId(input?.weekdayId);
    const startTime = normalizeTime(input?.startTime, "เวลาเริ่ม");
    const endTime = normalizeTime(input?.endTime, "เวลาจบ");

    if (startTime >= endTime) {
        throw httpError(400, "เวลาจบต้องมากกว่าเวลาเริ่ม");
    }

    try {
        const result = await pool.query(`
            INSERT INTO ${TABLE_SCHEMA}.opening_schedule (weekday_id, start_time, end_time)
            VALUES ($1, $2, $3)
            RETURNING opening_schedule_id
        `, [weekdayId, startTime, endTime]);

        return {
            id: result.rows[0].opening_schedule_id,
            ...(await listOpeningSchedules())
        };
    } catch (error) {
        if (error.code === "23505") {
            throw httpError(409, "เวลานี้มีอยู่แล้วในวันเดียวกัน");
        }

        throw error;
    }
}

export async function setOpeningScheduleActive(scheduleId, isActive) {
    const id = Number(scheduleId);

    if (!Number.isInteger(id) || id < 1) {
        throw httpError(400, "รหัสเวลาเปิดไม่ถูกต้อง");
    }

    if (!(await hasScheduleActiveColumn())) {
        throw httpError(409, "ยังไม่มี column is_active ในตาราง opening_schedule กรุณารัน database/001_create_master_tables.sql (เวอร์ชันล่าสุด) ก่อน");
    }

    const result = await pool.query(`
        UPDATE ${TABLE_SCHEMA}.opening_schedule
        SET is_active = $2
        WHERE opening_schedule_id = $1
        RETURNING opening_schedule_id
    `, [id, Boolean(isActive)]);

    if (result.rows.length === 0) {
        throw httpError(404, "ไม่พบเวลาเปิดนี้");
    }

    return listOpeningSchedules();
}

export async function deleteOpeningSchedule(scheduleId) {
    const id = Number(scheduleId);

    if (!Number.isInteger(id) || id < 1) {
        throw httpError(400, "รหัสเวลาเปิดไม่ถูกต้อง");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const scheduleResult = await client.query(`
            SELECT opening_schedule_id
            FROM ${TABLE_SCHEMA}.opening_schedule
            WHERE opening_schedule_id = $1
            FOR UPDATE
        `, [id]);

        if (scheduleResult.rows.length === 0) {
            throw httpError(404, "ไม่พบเวลาเปิดนี้");
        }

        const usageMap = await getScheduleUsage(client);
        const usageCount = usageMap.get(id) || 0;

        if (usageCount > 0) {
            throw httpError(409, `ลบไม่ได้ เพราะมี enrollment ใช้อยู่ ${usageCount} รายการ`);
        }

        await client.query(`
            DELETE FROM ${TABLE_SCHEMA}.opening_schedule
            WHERE opening_schedule_id = $1
        `, [id]);

        await client.query("COMMIT");
        return listOpeningSchedules();
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
