import pool from "../config/db.js";

const TABLE_SCHEMA = "kumon";
const ACTIVE_STATUS_CODES = ["N", "EO", "IT", "R", "C"];

function normalizeMonth(value) {
    const month = Number(value);

    if (!Number.isInteger(month) || month < 1 || month > 12) {
        return new Date().getMonth() + 1;
    }

    return month;
}

function normalizeYear(value) {
    const year = Number(value);

    if (!Number.isInteger(year) || year < 2000 || year > 2600) {
        return new Date().getFullYear();
    }

    return year;
}

function normalizeLimit(value) {
    const limit = Number(value);

    if (!Number.isInteger(limit) || limit < 1) {
        return 300;
    }

    return Math.min(limit, 1000);
}

function normalizeStatus(value) {
    return ["paid", "partial", "unpaid"].includes(value) ? value : "all";
}

const paymentStatusCte = `
    WITH latest_period_billing AS (
        SELECT DISTINCT ON (billing.student_id)
            billing.billing_id,
            billing.receipt_book,
            billing.receipt_no,
            billing.student_id,
            billing.billing_date,
            billing.total_amount,
            billing.discount_amount,
            billing.net_amount,
            payment.payment_method_name
        FROM ${TABLE_SCHEMA}.billing billing
        JOIN ${TABLE_SCHEMA}.payment_method_master payment
            ON payment.payment_method_id = billing.payment_method_id
        WHERE billing.billing_month = $1
          AND billing.billing_year = $2
        ORDER BY billing.student_id, billing.billing_date DESC, billing.billing_id DESC
    ),
    period_paid_details AS (
        SELECT
            billing.student_id,
            detail.enrollment_id,
            detail.net_amount
        FROM ${TABLE_SCHEMA}.billing billing
        JOIN ${TABLE_SCHEMA}.billing_detail detail
            ON detail.billing_id = billing.billing_id
        WHERE billing.billing_month = $1
          AND billing.billing_year = $2
    ),
    period_paid_summary AS (
        SELECT
            student_id,
            COALESCE(SUM(net_amount), 0)::numeric AS period_net_amount
        FROM period_paid_details
        GROUP BY student_id
    ),
    latest_billing AS (
        SELECT DISTINCT ON (billing.student_id)
            billing.student_id,
            billing.receipt_book AS latest_receipt_book,
            billing.receipt_no AS latest_receipt_no,
            billing.billing_month AS latest_billing_month,
            billing.billing_year AS latest_billing_year,
            billing.billing_date AS latest_billing_date,
            billing.net_amount AS latest_net_amount
        FROM ${TABLE_SCHEMA}.billing billing
        ORDER BY billing.student_id, billing.billing_year DESC, billing.billing_month DESC, billing.billing_date DESC, billing.billing_id DESC
    ),
    center_fee AS (
        SELECT
            full_tuition,
            addition_full_tuition
        FROM ${TABLE_SCHEMA}.center_master
        ORDER BY center_id
        LIMIT 1
    ),
    eligible_enrollments AS (
        SELECT DISTINCT ON (enrollment_id)
            enrollment_id,
            student_id,
            subject_id,
            subject_code,
            current_level_code,
            expected_net_amount
        FROM (
            SELECT
                enrollment.enrollment_id,
                enrollment.student_id,
                subject.subject_id,
                subject.subject_code,
                current_level.level_code AS current_level_code,
                CASE
                    WHEN status2.status_code IN ('F', 'FS', 'FSH') THEN 0
                    ELSE
                        CASE
                            WHEN status2.status_code IN ('H', 'FSH') THEN center.full_tuition / 2
                            ELSE center.full_tuition
                        END
                        + CASE
                            WHEN COALESCE(grade.addition_fee, false) = false THEN 0
                            WHEN status2.status_code IN ('H', 'FSH') THEN center.addition_full_tuition / 2
                            ELSE center.addition_full_tuition
                        END
                END::numeric AS expected_net_amount,
                1 AS source_rank
            FROM ${TABLE_SCHEMA}.enrollment enrollment
            JOIN ${TABLE_SCHEMA}.subject_master subject
                ON subject.subject_id = enrollment.subject_id
            JOIN ${TABLE_SCHEMA}.level_master current_level
                ON current_level.level_master_id = enrollment.current_level_master_id
            JOIN ${TABLE_SCHEMA}.student student
                ON student.student_id = enrollment.student_id
            LEFT JOIN ${TABLE_SCHEMA}.school_grade_master grade
                ON grade.school_grade_id = student.school_grade_id
            JOIN ${TABLE_SCHEMA}.status_master status1
                ON status1.status_id = enrollment.current_status_group1_id
            LEFT JOIN ${TABLE_SCHEMA}.status_master status2
                ON status2.status_id = enrollment.current_status_group2_id
            CROSS JOIN center_fee center
            WHERE status1.status_code = ANY($3::text[])
              AND ($4 = 'ALL' OR subject.subject_code = $4)
              AND (
                    EXTRACT(YEAR FROM (
                        CASE
                            WHEN EXTRACT(DAY FROM enrollment.en_start_date) > 20
                            THEN enrollment.en_start_date + INTERVAL '1 month'
                            ELSE enrollment.en_start_date
                        END
                    ))::int * 12
                    + EXTRACT(MONTH FROM (
                        CASE
                            WHEN EXTRACT(DAY FROM enrollment.en_start_date) > 20
                            THEN enrollment.en_start_date + INTERVAL '1 month'
                            ELSE enrollment.en_start_date
                        END
                    ))::int
                ) <= ($2::int * 12 + $1::int)

            UNION ALL

            SELECT
                enrollment.enrollment_id,
                enrollment.student_id,
                subject.subject_id,
                subject.subject_code,
                billing_level.level_code AS current_level_code,
                detail.net_amount AS expected_net_amount,
                0 AS source_rank
            FROM ${TABLE_SCHEMA}.billing billing
            JOIN ${TABLE_SCHEMA}.billing_detail detail
                ON detail.billing_id = billing.billing_id
            JOIN ${TABLE_SCHEMA}.enrollment enrollment
                ON enrollment.enrollment_id = detail.enrollment_id
            JOIN ${TABLE_SCHEMA}.subject_master subject
                ON subject.subject_id = enrollment.subject_id
            JOIN ${TABLE_SCHEMA}.level_master billing_level
                ON billing_level.level_master_id = detail.current_level_master_id
            WHERE billing.billing_month = $1
              AND billing.billing_year = $2
              AND ($4 = 'ALL' OR subject.subject_code = $4)
        ) source
        ORDER BY enrollment_id, source_rank
    ),
    student_billing AS (
        SELECT
            student.student_id,
            student.first_name,
            student.last_name,
            student.nickname,
            MIN(eligible.enrollment_id)::int AS source_enrollment_id,
            COUNT(*)::int AS eligible_enrollment_count,
            COUNT(*) FILTER (WHERE paid.enrollment_id IS NOT NULL)::int AS paid_enrollment_count,
            COUNT(*) FILTER (WHERE paid.enrollment_id IS NULL)::int AS unpaid_enrollment_count,
            STRING_AGG(
                eligible.subject_code || ' #' || eligible.enrollment_id || ' ' || eligible.current_level_code
                || CASE WHEN paid.enrollment_id IS NOT NULL THEN ' paid' ELSE '' END,
                ', '
                ORDER BY eligible.subject_id, eligible.enrollment_id
            ) AS subjects,
            billing.billing_id,
            billing.receipt_book,
            billing.receipt_no,
            billing.billing_date,
            billing.total_amount,
            billing.discount_amount,
            billing.net_amount,
            billing.payment_method_name,
            latest.latest_receipt_book,
            latest.latest_receipt_no,
            latest.latest_billing_month,
            latest.latest_billing_year,
            latest.latest_billing_date,
            latest.latest_net_amount,
            COALESCE(paid_summary.period_net_amount, 0)::numeric AS period_net_amount,
            COALESCE(SUM(eligible.expected_net_amount), 0)::numeric AS expected_net_amount,
            COALESCE(SUM(eligible.expected_net_amount) FILTER (WHERE paid.enrollment_id IS NULL), 0)::numeric AS unpaid_net_amount,
            CASE
                WHEN COUNT(*) FILTER (WHERE paid.enrollment_id IS NOT NULL) = 0 THEN 'unpaid'
                WHEN COUNT(*) FILTER (WHERE paid.enrollment_id IS NULL) = 0 THEN 'paid'
                ELSE 'partial'
            END AS payment_state
        FROM ${TABLE_SCHEMA}.student student
        JOIN eligible_enrollments eligible
            ON eligible.student_id = student.student_id
        LEFT JOIN period_paid_details paid
            ON paid.enrollment_id = eligible.enrollment_id
        LEFT JOIN latest_period_billing billing
            ON billing.student_id = student.student_id
        LEFT JOIN period_paid_summary paid_summary
            ON paid_summary.student_id = student.student_id
        LEFT JOIN latest_billing latest
            ON latest.student_id = student.student_id
        WHERE (
                $6::text IS NULL
                OR student.student_id::text ILIKE $6
                OR eligible.enrollment_id::text ILIKE $6
                OR student.first_name ILIKE $6
                OR student.last_name ILIKE $6
                OR COALESCE(student.nickname, '') ILIKE $6
              )
        GROUP BY
            student.student_id,
            student.first_name,
            student.last_name,
            student.nickname,
            billing.billing_id,
            billing.receipt_book,
            billing.receipt_no,
            billing.billing_date,
            billing.total_amount,
            billing.discount_amount,
            billing.net_amount,
            billing.payment_method_name,
            paid_summary.period_net_amount,
            latest.latest_receipt_book,
            latest.latest_receipt_no,
            latest.latest_billing_month,
            latest.latest_billing_year,
            latest.latest_billing_date,
            latest.latest_net_amount
    ),
    paid_billing_rows AS (
        SELECT
            student.student_id,
            student.first_name,
            student.last_name,
            student.nickname,
            MIN(detail.enrollment_id)::int AS source_enrollment_id,
            COUNT(*)::int AS eligible_enrollment_count,
            COUNT(*)::int AS paid_enrollment_count,
            0::int AS unpaid_enrollment_count,
            STRING_AGG(
                subject.subject_code || ' #' || detail.enrollment_id || ' ' || billing_level.level_code || ' paid',
                ', '
                ORDER BY subject.subject_id, detail.enrollment_id
            ) AS subjects,
            billing.billing_id,
            billing.receipt_book,
            billing.receipt_no,
            billing.billing_date,
            billing.total_amount,
            billing.discount_amount,
            billing.net_amount,
            payment.payment_method_name,
            latest.latest_receipt_book,
            latest.latest_receipt_no,
            latest.latest_billing_month,
            latest.latest_billing_year,
            latest.latest_billing_date,
            latest.latest_net_amount,
            billing.net_amount::numeric AS period_net_amount,
            COALESCE(SUM(detail.net_amount), 0)::numeric AS expected_net_amount,
            0::numeric AS unpaid_net_amount,
            'paid'::text AS payment_state
        FROM ${TABLE_SCHEMA}.billing billing
        JOIN ${TABLE_SCHEMA}.billing_detail detail
            ON detail.billing_id = billing.billing_id
        JOIN ${TABLE_SCHEMA}.payment_method_master payment
            ON payment.payment_method_id = billing.payment_method_id
        JOIN ${TABLE_SCHEMA}.enrollment enrollment
            ON enrollment.enrollment_id = detail.enrollment_id
        JOIN ${TABLE_SCHEMA}.student student
            ON student.student_id = billing.student_id
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = enrollment.subject_id
        JOIN ${TABLE_SCHEMA}.level_master billing_level
            ON billing_level.level_master_id = detail.current_level_master_id
        LEFT JOIN latest_billing latest
            ON latest.student_id = student.student_id
        WHERE billing.billing_month = $1
          AND billing.billing_year = $2
          AND ($4 = 'ALL' OR subject.subject_code = $4)
          AND (
                $6::text IS NULL
                OR student.student_id::text ILIKE $6
                OR detail.enrollment_id::text ILIKE $6
                OR student.first_name ILIKE $6
                OR student.last_name ILIKE $6
                OR COALESCE(student.nickname, '') ILIKE $6
              )
        GROUP BY
            student.student_id,
            student.first_name,
            student.last_name,
            student.nickname,
            billing.billing_id,
            billing.receipt_book,
            billing.receipt_no,
            billing.billing_date,
            billing.total_amount,
            billing.discount_amount,
            billing.net_amount,
            payment.payment_method_name,
            latest.latest_receipt_book,
            latest.latest_receipt_no,
            latest.latest_billing_month,
            latest.latest_billing_year,
            latest.latest_billing_date,
            latest.latest_net_amount
    ),
    payment_rows AS (
        SELECT *
        FROM student_billing
        WHERE payment_state <> 'paid'

        UNION ALL

        SELECT *
        FROM paid_billing_rows
    )
`;

export async function getPaymentStatus({
    billingMonth,
    billingYear,
    subject = "ALL",
    status = "all",
    query = "",
    limit
}) {
    const normalizedMonth = normalizeMonth(billingMonth);
    const normalizedYear = normalizeYear(billingYear);
    const normalizedSubject = String(subject || "ALL").toUpperCase();
    const normalizedStatus = normalizeStatus(status);
    const normalizedQuery = String(query || "").trim();
    const normalizedLimit = normalizeLimit(limit);
    const params = [
        normalizedMonth,
        normalizedYear,
        ACTIVE_STATUS_CODES,
        normalizedSubject,
        normalizedStatus,
        normalizedQuery ? `%${normalizedQuery}%` : null,
        normalizedLimit
    ];
    const result = await pool.query(`
        ${paymentStatusCte}
        SELECT *
        FROM payment_rows
        WHERE ($5 = 'all')
           OR ($5 = payment_state)
        ORDER BY
            CASE payment_state WHEN 'unpaid' THEN 0 WHEN 'partial' THEN 1 ELSE 2 END,
            first_name,
            last_name,
            student_id,
            billing_date DESC NULLS LAST,
            billing_id DESC NULLS LAST
        LIMIT $7
    `, params);
    const summaryParams = params.slice(0, 5).concat(null);
    const summaryResult = await pool.query(`
        ${paymentStatusCte}
        SELECT
            COUNT(*)::int AS total_students,
            COUNT(*) FILTER (WHERE payment_state = 'paid')::int AS paid_students,
            COUNT(*) FILTER (WHERE payment_state = 'partial')::int AS partial_students,
            COUNT(*) FILTER (WHERE payment_state = 'unpaid')::int AS unpaid_students,
            COALESCE(SUM(period_net_amount), 0)::numeric AS total_net_amount,
            COALESCE(SUM(expected_net_amount), 0)::numeric AS expected_net_amount,
            COALESCE(SUM(unpaid_net_amount), 0)::numeric AS unpaid_net_amount
        FROM student_billing
        WHERE ($5::text IS NOT NULL OR $5::text IS NULL)
    `, summaryParams);
    const summary = summaryResult.rows[0] || {};

    return {
        billingMonth: normalizedMonth,
        billingYear: normalizedYear,
        subject: normalizedSubject,
        status: normalizedStatus,
        rows: result.rows.map((row) => ({
            studentId: row.student_id,
            studentName: `${row.first_name} ${row.last_name}`,
            nickname: row.nickname,
            sourceEnrollmentId: row.source_enrollment_id,
            activeEnrollmentCount: row.eligible_enrollment_count,
            paidEnrollmentCount: row.paid_enrollment_count,
            unpaidEnrollmentCount: row.unpaid_enrollment_count,
            subjects: row.subjects,
            billingId: row.billing_id,
            receiptBook: row.receipt_book,
            receiptNo: row.receipt_no,
            billingDate: row.billing_date,
            totalAmount: row.total_amount,
            discountAmount: row.discount_amount,
            netAmount: row.period_net_amount,
            expectedNetAmount: row.expected_net_amount,
            unpaidNetAmount: row.unpaid_net_amount,
            paymentMethodName: row.payment_method_name,
            latestReceiptBook: row.latest_receipt_book,
            latestReceiptNo: row.latest_receipt_no,
            latestBillingMonth: row.latest_billing_month,
            latestBillingYear: row.latest_billing_year,
            latestBillingDate: row.latest_billing_date,
            latestNetAmount: row.latest_net_amount,
            paymentState: row.payment_state,
            isPaid: row.payment_state === "paid",
            isPartial: row.payment_state === "partial"
        })),
        summary: {
            totalStudents: Number(summary.total_students || 0),
            paidStudents: Number(summary.paid_students || 0),
            partialStudents: Number(summary.partial_students || 0),
            unpaidStudents: Number(summary.unpaid_students || 0),
            totalNetAmount: Number(summary.total_net_amount || 0),
            expectedNetAmount: Number(summary.expected_net_amount || 0),
            unpaidNetAmount: Number(summary.unpaid_net_amount || 0)
        }
    };
}
