// Backs the admin/instructor "Statistics" page (public/statistics.html):
// a monthly count of enrollment status EVENTS (New/Incoming Transfer/
// Enrolling-Other-Subject/Resumed = kids coming IN; Absent/Outgoing
// Transfer/Completer = kids going OUT), grouped by calendar month and
// compared across the latest 3 calendar years — plus a separate "Current"
// (C / Continue) count, the steady-state headcount rather than an event.
//
// Data source for the 7 event codes: `enrollment_status`, a dedicated
// per-month history table — confirmed directly against the live database
// (not just the source code) that all 7 ARE recorded there with a real
// status_month/status_year on the row (including "R", which an earlier
// reading of the write-path code wrongly suggested was never logged this
// way — it is). "C" is genuinely absent from this table (never logged as
// an "event" since staying put isn't one), so it's tracked separately.
//
// Data source for "Current": `billing_detail` (joined to `billing` for its
// month/year), NOT `enrollment_status`. Per the app's own billing flow, an
// enrollment's billing_detail.status_group1 is set to "C" whenever it was
// billed that month with no other status event attached — exactly "paid,
// nothing else going on, counts as current" — confirmed directly against
// the live data: status_code counts in billing_detail are C/N/EO/R/IT
// only (A/OT/CP never appear there), and C dwarfs the rest (~36k of ~40k
// rows), consistent with it being the default/steady state at billing
// time rather than an event.
import pool from "../config/db.js";

const TABLE_SCHEMA = "kumon";

// "เข้า" (in) group first, "ออก" (out) group second — the natural framing
// for this chart (kids entering vs leaving), and lets the frontend color
// them as two visually distinct clusters within each stacked bar. "C"
// (Current) is deliberately NOT in this list — its count is 10x+ larger
// than these 7 combined some months, so stacking it into the same bar
// would swallow the in/out segments the chart is actually about. It's
// reported as a separate `current` field per year instead (see below).
export const STATUS_CODES = ["N", "IT", "EO", "R", "A", "OT", "CP"];

export const STATUS_LABELS = {
    N: "New Enrolment",
    IT: "Incoming Transfer",
    EO: "Enrolling Other Subject",
    R: "Resumed",
    A: "Absent",
    OT: "Outgoing Transfer",
    CP: "Completer",
    C: "Current"
};

const MONTH_LABELS_TH = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
];

// years/months/statuses are all fixed, tiny (4 x 12 x 7 at most) — running
// the aggregation query fresh on every request is cheap and always
// current, no caching needed.
export async function getEnrollmentStatusStatistics() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JS getMonth() is 0-based

    // A month later in the current year than "now" hasn't happened yet —
    // rather than show a 3rd, empty/placeholder bar for it (the earlier
    // design), the whole 3-year window for that month's panel slides back
    // one year instead, so every panel always shows 3 real, complete
    // years of data. E.g. today in September: the September panel (month
    // <= currentMonth) shows 2024/2025/2026; the October panel (month >
    // currentMonth, hasn't happened in 2026 yet) shows 2023/2024/2025.
    // Needs data back to currentYear - 3 (one year further than the
    // simple "latest 3 years" case) to cover that shifted window.
    const earliestYear = currentYear - 3;

    const [eventResult, currentResult] = await Promise.all([
        pool.query(
            `SELECT es.status_year, es.status_month, sm.status_code, count(*)::int AS cnt
             FROM ${TABLE_SCHEMA}.enrollment_status es
             JOIN ${TABLE_SCHEMA}.status_master sm ON sm.status_id = es.status_id
             WHERE sm.status_code = ANY($1) AND es.status_year >= $2
             GROUP BY es.status_year, es.status_month, sm.status_code`,
            [STATUS_CODES, earliestYear]
        ),
        pool.query(
            `SELECT b.billing_year AS status_year, b.billing_month AS status_month, count(*)::int AS cnt
             FROM ${TABLE_SCHEMA}.billing_detail bd
             JOIN ${TABLE_SCHEMA}.billing b ON b.billing_id = bd.billing_id
             JOIN ${TABLE_SCHEMA}.status_master sm ON sm.status_id = bd.status_group1_id
             WHERE sm.status_code = 'C' AND b.billing_year >= $1
             GROUP BY b.billing_year, b.billing_month`,
            [earliestYear]
        )
    ]);

    // "<year>-<month>" -> { <statusCode>: count }
    const countsByYearMonth = new Map();

    eventResult.rows.forEach((row) => {
        const key = `${row.status_year}-${row.status_month}`;

        if (!countsByYearMonth.has(key)) {
            countsByYearMonth.set(key, {});
        }

        countsByYearMonth.get(key)[row.status_code] = row.cnt;
    });

    // "<year>-<month>" -> current (C) count
    const currentByYearMonth = new Map();

    currentResult.rows.forEach((row) => {
        currentByYearMonth.set(`${row.status_year}-${row.status_month}`, row.cnt);
    });

    const months = [];

    for (let month = 1; month <= 12; month += 1) {
        // This month's own 3-year window — only ever 3 full, real years,
        // never a placeholder. headYear (the latest year in the window)
        // is what the panel's own heading shows.
        const years = month <= currentMonth
            ? [currentYear - 2, currentYear - 1, currentYear]
            : [currentYear - 3, currentYear - 2, currentYear - 1];
        const headYear = years[years.length - 1];

        const yearData = {};

        years.forEach((year) => {
            const counts = countsByYearMonth.get(`${year}-${month}`) || {};
            const byStatus = {};
            let total = 0;

            STATUS_CODES.forEach((code) => {
                const value = counts[code] || 0;

                byStatus[code] = value;
                total += value;
            });

            yearData[year] = {
                byStatus,
                total,
                current: currentByYearMonth.get(`${year}-${month}`) || 0,
                // The one bar, across the whole 12-panel grid, that
                // represents literally this month and this year right
                // now — its data is still accumulating (the month isn't
                // over), unlike every other bar shown, which is a closed,
                // complete month. Flagged so the frontend can mark it
                // distinctly instead of presenting it as equally final.
                isCurrentMonth: year === currentYear && month === currentMonth
            };
        });

        months.push({ month, monthLabel: MONTH_LABELS_TH[month - 1], years, headYear, yearData });
    }

    return { statusCodes: STATUS_CODES, statusLabels: STATUS_LABELS, months };
}
