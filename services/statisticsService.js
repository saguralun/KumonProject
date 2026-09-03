// Backs the admin/instructor "Statistics" page (public/statistics.html):
// a monthly count of enrollment status EVENTS (New/Incoming Transfer/
// Enrolling-Other-Subject/Resumed = kids coming IN; Absent/Outgoing
// Transfer/Completer = kids going OUT), grouped by calendar month and
// compared across the latest 3 calendar years.
//
// Data source: `enrollment_status`, a dedicated per-month history table —
// confirmed directly against the live database (not just the source code)
// that all 7 of these codes ARE recorded there with a real status_month/
// status_year on the row (including "R", which an earlier reading of the
// write-path code wrongly suggested was never logged this way — it is).
// The only group-1 code genuinely absent from this table is "C" (Continue,
// the routine steady state — never logged as an "event" since staying put
// isn't one), which is also correctly not one of the 7 codes asked for
// here. This means the query below needs no fallback to `billing_detail`
// or to an enrollment's current live status — every row is a real dated
// event, not a reconstructed snapshot.
import pool from "../config/db.js";

const TABLE_SCHEMA = "kumon";

// "เข้า" (in) group first, "ออก" (out) group second — the natural framing
// for this chart (kids entering vs leaving), and lets the frontend color
// them as two visually distinct clusters within each stacked bar.
export const STATUS_CODES = ["N", "IT", "EO", "R", "A", "OT", "CP"];

export const STATUS_LABELS = {
    N: "New Enrolment",
    IT: "Incoming Transfer",
    EO: "Enrolling Other Subject",
    R: "Resumed",
    A: "Absent",
    OT: "Outgoing Transfer",
    CP: "Completer"
};

const MONTH_LABELS_TH = [
    "ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.",
    "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."
];

// years/months/statuses are all fixed, tiny (3 x 12 x 7) — running the
// aggregation query fresh on every request is cheap and always current,
// no caching needed.
export async function getEnrollmentStatusStatistics() {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // JS getMonth() is 0-based
    const years = [currentYear - 2, currentYear - 1, currentYear];

    const result = await pool.query(
        `SELECT es.status_year, es.status_month, sm.status_code, count(*)::int AS cnt
         FROM ${TABLE_SCHEMA}.enrollment_status es
         JOIN ${TABLE_SCHEMA}.status_master sm ON sm.status_id = es.status_id
         WHERE sm.status_code = ANY($1) AND es.status_year >= $2
         GROUP BY es.status_year, es.status_month, sm.status_code`,
        [STATUS_CODES, years[0]]
    );

    // "<year>-<month>" -> { <statusCode>: count }
    const countsByYearMonth = new Map();

    result.rows.forEach((row) => {
        const key = `${row.status_year}-${row.status_month}`;

        if (!countsByYearMonth.has(key)) {
            countsByYearMonth.set(key, {});
        }

        countsByYearMonth.get(key)[row.status_code] = row.cnt;
    });

    const months = [];

    for (let month = 1; month <= 12; month += 1) {
        const yearsData = {};

        years.forEach((year) => {
            const counts = countsByYearMonth.get(`${year}-${month}`) || {};
            const byStatus = {};
            let total = 0;

            STATUS_CODES.forEach((code) => {
                const value = counts[code] || 0;

                byStatus[code] = value;
                total += value;
            });

            // A month later in the current year than "now" hasn't happened
            // yet — its 0 isn't a real "nothing happened" data point, so
            // the frontend needs to tell the two apart (a placeholder,
            // not a real empty bar).
            yearsData[year] = {
                byStatus,
                total,
                isFuture: year === currentYear && month > currentMonth
            };
        });

        months.push({ month, monthLabel: MONTH_LABELS_TH[month - 1], years: yearsData });
    }

    return { years, statusCodes: STATUS_CODES, statusLabels: STATUS_LABELS, months };
}
