import pool from "../config/db.js";
import { normalizeBillingPeriod } from "./worksheetService.js";

const TABLE_SCHEMA = "kumon";

// center_master.school_year = 2026 means "this cycle covers 05/2026
// through 04/2027" — the same Kumon billing-period rule already used
// everywhere else in this app (a date after the 20th of a month counts
// as the next month) decides when that cycle rolls over: the first
// moment today's effective billing month/year (see normalizeBillingPeriod
// in worksheetService.js) reports month 5 of (school_year + 1) — in
// practice, from 21/4 of the following year onward — every student's
// school_grade_id should advance to their school_grade_master.
// next_school_grade_id (grade 17/"Etc" has no next grade and stays put),
// and school_year itself increments by 1.
export function isSchoolYearUpgradeDue(currentSchoolYear, effectiveBillingPeriod) {
    return effectiveBillingPeriod.billingMonth === 5
        && effectiveBillingPeriod.billingYear === currentSchoolYear + 1;
}

// This is checked (not scheduled) — call checkAndApplySchoolYearUpgrade()
// periodically (see server.js) and it's a no-op every time except the
// one moment per year isSchoolYearUpgradeDue() above actually returns
// true. Once applied, school_year is already incremented, so the
// condition is false again until next year — safe to call as often as
// you like.
export async function checkAndApplySchoolYearUpgrade() {
    const centerResult = await pool.query(
        `SELECT center_id, school_year FROM ${TABLE_SCHEMA}.center_master LIMIT 1`
    );
    const center = centerResult.rows[0];

    if (!center) {
        return { applied: false, reason: "no center_master row" };
    }

    const today = normalizeBillingPeriod({});
    const dueYear = center.school_year + 1;

    if (!isSchoolYearUpgradeDue(center.school_year, today)) {
        return {
            applied: false,
            reason: "not due yet",
            currentSchoolYear: center.school_year,
            today
        };
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        // Every student, active or inactive — this table has no status
        // column of its own (that lives on enrollment), so the school
        // year applies to every row unconditionally. next_school_grade_id
        // is NULL for grade 17 ("Etc", already at the top), so the JOIN
        // naturally excludes those rows and they stay exactly where they
        // are — no explicit "= 17 stays 17" case needed.
        const studentResult = await client.query(`
            UPDATE ${TABLE_SCHEMA}.student s
            SET school_grade_id = g.next_school_grade_id
            FROM ${TABLE_SCHEMA}.school_grade_master g
            WHERE s.school_grade_id = g.school_grade_id
              AND g.next_school_grade_id IS NOT NULL
        `);

        await client.query(
            `UPDATE ${TABLE_SCHEMA}.center_master SET school_year = school_year + 1 WHERE center_id = $1`,
            [center.center_id]
        );

        await client.query("COMMIT");

        return {
            applied: true,
            previousSchoolYear: center.school_year,
            newSchoolYear: dueYear,
            studentsUpgraded: studentResult.rowCount
        };
    } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        client.release();
    }
}
