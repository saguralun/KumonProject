import pool from "../config/db.js";
import { httpError } from "./httpError.js";
import { formatStudentName } from "./enrollmentHelpers.js";
import {
    getEnrollmentRow,
    normalizeBillingPeriod,
    normalizeDate
} from "./worksheetService.js";

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

// =========================================================
// Receipts / billing — preview, receive, cancel
// =========================================================
// Moved here from worksheetService.js, which originally held every
// worksheet-input AND payment concern in one file. This is the part that
// actually handles money (getPaymentStatus above is read-only reporting);
// getEnrollmentRow/normalizeDate are core enrollment/date helpers still
// owned by worksheetService.js and imported from there rather than
// duplicated. normalizeBillingPeriod stayed there too (rather than moving
// here with the rest) because worksheetService.js's own
// getWorksheetMonthSummary needs it as well.

function money(value) {
    return Number(Number(value || 0).toFixed(2));
}

function formatBillingPeriod({
    billingMonth,
    billingYear
}) {
    return `${billingMonth}/${billingYear}`;
}

async function insertPaymentEnrollmentStatusHistory(client, receipt) {
    let inserted = 0;

    const paymentDetails = receipt.receiptDetails || receipt.details;

    for (const detail of paymentDetails) {
        const statusCode = String(detail.statusGroup1Code || "").toUpperCase();

        if (!detail.statusGroup1Id || ["C", "CP"].includes(statusCode)) {
            continue;
        }

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
            detail.enrollmentId,
            detail.statusGroup1Id,
            receipt.billingMonth,
            receipt.billingYear
        ]);

        if (result.rows[0]) {
            inserted += 1;
        }
    }

    return inserted;
}

async function normalizeEnrollmentStatusesAfterPayment(client, receipt) {
    const paymentDetails = receipt.receiptDetails || receipt.details;
    const enrollmentIds = [
        ...new Set(paymentDetails.map((detail) => Number(detail.enrollmentId)).filter(Number.isInteger))
    ];

    if (!enrollmentIds.length) {
        return 0;
    }

    const continueResult = await client.query(`
        SELECT status_id
        FROM ${TABLE_SCHEMA}.status_master
        WHERE status_code = 'C'
          AND status_group = 1
        LIMIT 1
    `);
    const continueStatusId = continueResult.rows[0]?.status_id;

    if (!continueStatusId) {
        throw httpError(500, "ไม่พบ status C");
    }

    const result = await client.query(`
        UPDATE ${TABLE_SCHEMA}.enrollment
        SET current_status_group1_id = $2,
            current_status_group2_id = CASE
                WHEN current_status_group2_id IN (
                    SELECT status_id
                    FROM ${TABLE_SCHEMA}.status_master
                    WHERE status_code = 'F'
                      AND status_group = 2
                )
                THEN current_status_group2_id
                ELSE NULL
            END,
            updated_at = CURRENT_TIMESTAMP
        WHERE enrollment_id = ANY($1::int[])
    `, [
        enrollmentIds,
        continueStatusId
    ]);

    return result.rowCount;
}

function calculateReceiptDetailFee({
    center,
    enrollment
}) {
    const fullTuition = money(center.full_tuition);
    const fullRegistrationFee = money(center.registration_fee);
    const fullAdditionalFee = enrollment.additionFee
        ? money(center.addition_full_tuition)
        : 0;
    const statusGroup1Code = enrollment.statusGroup1Code || null;
    const statusGroup2Code = enrollment.statusGroup2Code || null;
    const isFree = ["F", "FS", "FSH"].includes(statusGroup2Code);
    const isHalfMonth = ["H", "FSH"].includes(statusGroup2Code);
    const isNewEnrollment = statusGroup1Code === "N";
    const isFreeRegistration = statusGroup2Code === "FRG";
    const registrationFee = isNewEnrollment ? fullRegistrationFee : 0;
    const registrationDiscount = isNewEnrollment && isFreeRegistration ? fullRegistrationFee : 0;

    if (isFree) {
        return {
            tuitionFee: 0,
            registrationFee,
            additionalFee: 0,
            discountAmount: registrationDiscount,
            netAmount: money(registrationFee - registrationDiscount)
        };
    }

    const tuitionFee = isHalfMonth
        ? money(fullTuition / 2)
        : fullTuition;
    const additionalFee = isHalfMonth
        ? money(fullAdditionalFee / 2)
        : fullAdditionalFee;
    const discountAmount = registrationDiscount;
    const netAmount = money(tuitionFee + registrationFee + additionalFee - discountAmount);

    return {
        tuitionFee,
        registrationFee,
        additionalFee,
        discountAmount,
        netAmount
    };
}

async function getNextReceiptNo({
    billingMonth,
    billingYear,
    client = pool
}) {
    const periodResult = await client.query(`
        SELECT receipt_book
        FROM ${TABLE_SCHEMA}.billing
        WHERE billing_month = $1
          AND billing_year = $2
        ORDER BY receipt_book DESC
        LIMIT 1
    `, [billingMonth, billingYear]);

    if (periodResult.rows[0]) {
        const receiptBook = Number(periodResult.rows[0].receipt_book);
        const receiptNoResult = await client.query(`
            SELECT COALESCE(MAX(receipt_no), 0)::int + 1 AS next_receipt_no
            FROM ${TABLE_SCHEMA}.billing
            WHERE receipt_book = $1
              AND billing_month = $2
              AND billing_year = $3
        `, [receiptBook, billingMonth, billingYear]);

        return {
            receiptBook,
            receiptNo: Number(receiptNoResult.rows[0]?.next_receipt_no || 1)
        };
    }

    const nextBookResult = await client.query(`
        SELECT COALESCE(MAX(receipt_book), 0)::int + 1 AS next_receipt_book
        FROM ${TABLE_SCHEMA}.billing
    `);

    return {
        receiptBook: Number(nextBookResult.rows[0]?.next_receipt_book || 1),
        receiptNo: 1
    };
}

async function buildReceiptPreview({
    enrollmentId,
    billingDate,
    billingMonth,
    billingYear,
    paymentMethodId,
    existingBillingId = null,
    selectedEnrollmentIds = null,
    client = pool
}) {
    const normalizedEnrollmentId = Number(enrollmentId);

    if (!Number.isInteger(normalizedEnrollmentId) || normalizedEnrollmentId < 1) {
        throw httpError(400, "Enrollment ID ไม่ถูกต้อง");
    }

    const period = normalizeBillingPeriod({
        billingDate,
        billingMonth,
        billingYear
    });
    const currentEnrollment = await getEnrollmentRow(normalizedEnrollmentId);

    if (!currentEnrollment) {
        throw httpError(404, "ไม่พบ enrollment ที่ยังใช้งานอยู่");
    }

    const centerResult = await client.query(`
        SELECT *
        FROM ${TABLE_SCHEMA}.center_master
        ORDER BY center_id
        LIMIT 1
    `);
    const center = centerResult.rows[0];

    if (!center) {
        throw httpError(500, "ไม่พบ center master");
    }

    const normalizedPaymentMethodId = paymentMethodId ? Number(paymentMethodId) : null;
    const paymentResult = await client.query(`
        SELECT payment_method_id, payment_method_code, payment_method_name
        FROM ${TABLE_SCHEMA}.payment_method_master
        WHERE ($1::smallint IS NULL AND payment_method_code = 'CA')
           OR payment_method_id = $1::smallint
        LIMIT 1
    `, [Number.isInteger(normalizedPaymentMethodId) ? normalizedPaymentMethodId : null]);
    const paymentMethod = paymentResult.rows[0];

    if (!paymentMethod) {
        throw httpError(400, "Payment method ไม่ถูกต้อง");
    }

    // A student can have more than one billing record in the same period
    // (e.g. each subject paid on a different day via separate receipts).
    // When the caller names a specific billing (the normal case — every
    // row in the Payment Center carries its own billingId), look that
    // exact record up rather than always fetching "the latest for this
    // student+period" and hoping it happens to match: with two+ billings,
    // only the newest one could ever match that way, so any older bill's
    // row would wrongly fall through to the fresh-receipt code path
    // instead of reprint/cancel mode.
    const normalizedExistingBillingId = Number.isInteger(Number(existingBillingId)) && Number(existingBillingId) > 0
        ? Number(existingBillingId)
        : null;
    const existingBillingQuery = `
        SELECT
            billing.billing_id,
            billing.receipt_book,
            billing.receipt_no,
            billing.billing_date,
            billing.created_at,
            billing.payment_method_id,
            billing.total_amount,
            billing.discount_amount,
            billing.net_amount,
            billing.billing_month,
            billing.billing_year,
            payment.payment_method_code,
            payment.payment_method_name
        FROM ${TABLE_SCHEMA}.billing
        JOIN ${TABLE_SCHEMA}.payment_method_master payment
            ON payment.payment_method_id = billing.payment_method_id
        WHERE billing.student_id = $1
    `;
    const existingBillingResult = normalizedExistingBillingId
        ? await client.query(`${existingBillingQuery} AND billing.billing_id = $2`, [
            currentEnrollment.student_id,
            normalizedExistingBillingId
        ])
        : existingBillingId === true
            ? await client.query(`
                ${existingBillingQuery}
                  AND billing.billing_month = $2
                  AND billing.billing_year = $3
                ORDER BY billing.billing_date DESC, billing.billing_id DESC
                LIMIT 1
            `, [currentEnrollment.student_id, period.billingMonth, period.billingYear])
            : { rows: [] };
    const existingBilling = existingBillingResult.rows[0] || null;
    const useExistingBilling = Boolean(existingBilling);

    // Separate from the specific-billing lookup above: a cheap hint for
    // "is there *a* billing for this student+period at all" (regardless of
    // which one, if any, the caller actually requested), used by callers to
    // retry with a concrete existingBillingId once they learn everything is
    // already paid. Not used to decide useExistingBilling itself.
    const latestBillingIdResult = await client.query(`
        SELECT billing_id
        FROM ${TABLE_SCHEMA}.billing
        WHERE student_id = $1
          AND billing_month = $2
          AND billing_year = $3
        ORDER BY billing_date DESC, billing_id DESC
        LIMIT 1
    `, [currentEnrollment.student_id, period.billingMonth, period.billingYear]);
    const latestBillingIdForPeriod = latestBillingIdResult.rows[0]?.billing_id || null;

    const paidDetailsByEnrollmentId = new Map();
    const reprintDetailsByEnrollmentId = new Map();

    const paidDetailsResult = await client.query(`
        SELECT DISTINCT ON (detail.enrollment_id)
            detail.enrollment_id,
            billing.billing_id,
            billing.receipt_book,
            billing.receipt_no,
            detail.tuition_fee,
            detail.registration_fee,
            detail.additional_fee,
            detail.discount_amount,
            detail.net_amount
        FROM ${TABLE_SCHEMA}.billing billing
        JOIN ${TABLE_SCHEMA}.billing_detail detail
            ON detail.billing_id = billing.billing_id
        WHERE billing.student_id = $1
          AND billing.billing_month = $2
          AND billing.billing_year = $3
        ORDER BY detail.enrollment_id, billing.billing_date DESC, billing.billing_id DESC
    `, [
        currentEnrollment.student_id,
        period.billingMonth,
        period.billingYear
    ]);

    paidDetailsResult.rows.forEach((row) => {
        paidDetailsByEnrollmentId.set(Number(row.enrollment_id), row);
    });

    if (useExistingBilling) {
        const reprintDetailsResult = await client.query(`
            SELECT
                enrollment_id,
                tuition_fee,
                registration_fee,
                additional_fee,
                discount_amount,
                net_amount
            FROM ${TABLE_SCHEMA}.billing_detail
            WHERE billing_id = $1
        `, [existingBilling.billing_id]);

        reprintDetailsResult.rows.forEach((row) => {
            reprintDetailsByEnrollmentId.set(Number(row.enrollment_id), row);
        });
    }
    const receiptNo = useExistingBilling
        ? {
            receiptBook: existingBilling.receipt_book,
            receiptNo: existingBilling.receipt_no
        }
        : await getNextReceiptNo({
            billingMonth: period.billingMonth,
            billingYear: period.billingYear,
            client
        });
    const enrollmentsResult = await client.query(`
        SELECT
            e.enrollment_id,
            e.student_id,
            e.current_level_master_id,
            e.current_zun_level_master_id,
            e.current_status_group1_id,
            e.current_status_group2_id,
            student.first_name,
            student.last_name,
            student.nickname,
            student.school_grade_id,
            grade.addition_fee,
            subject.subject_code,
            subject.subject_name,
            current_level.level_code AS current_level_code,
            current_zun.level_code AS current_zun_level_code,
            status1.status_code AS status_group1_code,
            status1.status_name AS status_group1_name,
            status2.status_code AS status_group2_code,
            status2.status_name AS status_group2_name
        FROM ${TABLE_SCHEMA}.enrollment e
        JOIN ${TABLE_SCHEMA}.student student
            ON student.student_id = e.student_id
        LEFT JOIN ${TABLE_SCHEMA}.school_grade_master grade
            ON grade.school_grade_id = student.school_grade_id
        JOIN ${TABLE_SCHEMA}.subject_master subject
            ON subject.subject_id = e.subject_id
        JOIN ${TABLE_SCHEMA}.level_master current_level
            ON current_level.level_master_id = e.current_level_master_id
        LEFT JOIN ${TABLE_SCHEMA}.level_master current_zun
            ON current_zun.level_master_id = e.current_zun_level_master_id
        JOIN ${TABLE_SCHEMA}.status_master status1
            ON status1.status_id = e.current_status_group1_id
        LEFT JOIN ${TABLE_SCHEMA}.status_master status2
            ON status2.status_id = e.current_status_group2_id
        WHERE e.student_id = $1
          AND status1.status_code = ANY($2::text[])
        ORDER BY subject.subject_id, e.enrollment_id
    `, [
        currentEnrollment.student_id,
        ACTIVE_STATUS_CODES
    ]);
    const requestedSelection = Array.isArray(selectedEnrollmentIds)
        ? new Set(selectedEnrollmentIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))
        : null;
    const detailRows = enrollmentsResult.rows.map((row) => {
        const fee = calculateReceiptDetailFee({
            center,
            enrollment: {
                additionFee: row.addition_fee,
                statusGroup1Code: row.status_group1_code,
                statusGroup2Code: row.status_group2_code
            }
        });

        const enrollmentKey = Number(row.enrollment_id);
        const paidDetail = paidDetailsByEnrollmentId.get(enrollmentKey);
        const reprintDetail = reprintDetailsByEnrollmentId.get(enrollmentKey);
        const isPaid = Boolean(paidDetail);
        const isReprintDetail = Boolean(reprintDetail);
        const selected = useExistingBilling
            ? isReprintDetail
            : requestedSelection
                ? requestedSelection.has(enrollmentKey) && !isPaid
                : !isPaid;
        const displayDetail = reprintDetail || paidDetail;

        return {
            enrollmentId: row.enrollment_id,
            isPaid,
            isSelected: selected,
            isLocked: isPaid || useExistingBilling,
            paidBillingId: paidDetail?.billing_id || null,
            paidReceiptBook: paidDetail?.receipt_book || null,
            paidReceiptNo: paidDetail?.receipt_no || null,
            subjectCode: row.subject_code,
            subjectName: row.subject_name,
            currentLevelMasterId: row.current_level_master_id,
            currentLevelCode: row.current_level_code,
            currentZunLevelMasterId: row.current_zun_level_master_id,
            currentZunLevelCode: row.current_zun_level_code,
            statusGroup1Id: row.current_status_group1_id,
            statusGroup1Code: row.status_group1_code,
            statusGroup1Name: row.status_group1_name,
            statusGroup2Id: row.current_status_group2_id,
            statusGroup2Code: row.status_group2_code,
            statusGroup2Name: row.status_group2_name,
            ...(displayDetail ? {
                tuitionFee: money(displayDetail.tuition_fee),
                registrationFee: money(displayDetail.registration_fee),
                additionalFee: money(displayDetail.additional_fee),
                discountAmount: money(displayDetail.discount_amount),
                netAmount: money(displayDetail.net_amount)
            } : fee)
        };
    });

    if (!detailRows.length) {
        throw httpError(400, "ไม่มี enrollment ที่รับเงินได้");
    }

    const receiptDetails = detailRows.filter((row) => row.isSelected);

    const computedDiscountAmount = money(receiptDetails.reduce((sum, row) => sum + row.discountAmount, 0));
    const computedNetAmount = money(receiptDetails.reduce((sum, row) => sum + row.netAmount, 0));
    const computedTotalAmount = money(computedNetAmount + computedDiscountAmount);
    const discountAmount = useExistingBilling
        ? money(existingBilling.discount_amount)
        : computedDiscountAmount;
    const netAmount = useExistingBilling
        ? money(existingBilling.net_amount)
        : computedNetAmount;
    const totalAmount = useExistingBilling
        ? money(existingBilling.total_amount)
        : computedTotalAmount;

    return {
        billingId: useExistingBilling ? existingBilling.billing_id : null,
        alreadyPaid: detailRows.every((row) => row.isPaid),
        partiallyPaid: detailRows.some((row) => row.isPaid) && detailRows.some((row) => !row.isPaid),
        existingBillingId: latestBillingIdForPeriod,
        receiptBook: receiptNo.receiptBook,
        receiptNo: receiptNo.receiptNo,
        studentId: currentEnrollment.student_id,
        sourceEnrollmentId: normalizedEnrollmentId,
        studentName: formatStudentName(currentEnrollment),
        billingDate: useExistingBilling
            ? normalizeDate(existingBilling.billing_date)
            : period.billingDate,
        // Real time-of-payment for display on the printed receipt.
        // billing_date is a DATE column (no time); billing.created_at is
        // the only place an actual timestamp exists for an existing
        // receipt. For a not-yet-paid preview there's no row yet, so "now"
        // is the closest honest answer — receiveReceiptPayment's own
        // INSERT happens moments later anyway.
        billingTime: useExistingBilling
            ? existingBilling.created_at
            : new Date(),
        paymentMethodId: useExistingBilling ? existingBilling.payment_method_id : paymentMethod.payment_method_id,
        paymentMethodCode: useExistingBilling ? existingBilling.payment_method_code : paymentMethod.payment_method_code,
        paymentMethodName: useExistingBilling ? existingBilling.payment_method_name : paymentMethod.payment_method_name,
        totalAmount,
        discountAmount,
        netAmount,
        billingMonth: period.billingMonth,
        billingYear: period.billingYear,
        center: {
            centerId: center.center_id,
            centerName: center.center_name,
            instructor: center.instructor
        },
        details: detailRows,
        receiptDetails
    };
}

export async function previewReceipt(payload) {
    const receipt = await buildReceiptPreview({
        enrollmentId: payload?.enrollmentId,
        billingDate: payload?.billingDate,
        billingMonth: payload?.billingMonth,
        billingYear: payload?.billingYear,
        paymentMethodId: payload?.paymentMethodId,
        existingBillingId: payload?.existingBillingId,
        selectedEnrollmentIds: payload?.selectedEnrollmentIds
    });
    const paymentMethodsResult = await pool.query(`
        SELECT payment_method_id, payment_method_code, payment_method_name
        FROM ${TABLE_SCHEMA}.payment_method_master
        ORDER BY payment_method_id
    `);

    return {
        success: true,
        receipt,
        paymentMethods: paymentMethodsResult.rows.map((row) => ({
            paymentMethodId: row.payment_method_id,
            paymentMethodCode: row.payment_method_code,
            paymentMethodName: row.payment_method_name
        }))
    };
}

export async function receiveReceiptPayment(payload) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const receipt = await buildReceiptPreview({
            enrollmentId: payload?.enrollmentId,
            billingDate: payload?.billingDate,
            billingMonth: payload?.billingMonth,
            billingYear: payload?.billingYear,
            paymentMethodId: payload?.paymentMethodId,
            selectedEnrollmentIds: payload?.selectedEnrollmentIds,
            client
        });

        if (!receipt.receiptDetails.length) {
            throw httpError(
                409,
                `น้องคนนี้จ่ายเงินค่าเรียนเดือน ${formatBillingPeriod(receipt)} ครบแล้ว`
            );
        }
        const insertBilling = await client.query(`
            INSERT INTO ${TABLE_SCHEMA}.billing (
                receipt_book,
                receipt_no,
                student_id,
                billing_date,
                payment_method_id,
                total_amount,
                discount_amount,
                net_amount,
                billing_month,
                billing_year
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING billing_id
        `, [
            receipt.receiptBook,
            receipt.receiptNo,
            receipt.studentId,
            receipt.billingDate,
            receipt.paymentMethodId,
            receipt.totalAmount,
            receipt.discountAmount,
            receipt.netAmount,
            receipt.billingMonth,
            receipt.billingYear
        ]);
        const billingId = insertBilling.rows[0].billing_id;

        for (const detail of receipt.receiptDetails) {
            await client.query(`
                INSERT INTO ${TABLE_SCHEMA}.billing_detail (
                    billing_id,
                    enrollment_id,
                    current_level_master_id,
                    current_zun_level_master_id,
                    status_group1_id,
                    status_group2_id,
                    tuition_fee,
                    registration_fee,
                    additional_fee,
                    discount_amount,
                    net_amount
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [
                billingId,
                detail.enrollmentId,
                detail.currentLevelMasterId,
                detail.currentZunLevelMasterId,
                detail.statusGroup1Id,
                detail.statusGroup2Id,
                detail.tuitionFee,
                detail.registrationFee,
                detail.additionalFee,
                detail.discountAmount,
                detail.netAmount
            ]);
        }
        const enrollmentStatusHistoryInserted = await insertPaymentEnrollmentStatusHistory(client, receipt);
        const enrollmentStatusesUpdated = await normalizeEnrollmentStatusesAfterPayment(client, receipt);

        await client.query("COMMIT");

        return {
            success: true,
            billingId,
            enrollmentStatusHistoryInserted,
            enrollmentStatusesUpdated,
            receipt: {
                ...receipt,
                billingId
            }
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}

export async function cancelReceiptPayment(payload) {
    const billingId = Number(payload?.billingId);

    if (!Number.isInteger(billingId) || billingId < 1) {
        throw httpError(400, "Billing ID ไม่ถูกต้อง");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const billingResult = await client.query(`
            SELECT
                billing_id,
                receipt_book,
                receipt_no,
                student_id,
                billing_month,
                billing_year
            FROM ${TABLE_SCHEMA}.billing
            WHERE billing_id = $1
            FOR UPDATE
        `, [billingId]);
        const billing = billingResult.rows[0];

        if (!billing) {
            throw httpError(404, "ไม่พบใบเสร็จนี้");
        }

        const detailsResult = await client.query(`
            SELECT
                detail.billing_detail_id,
                detail.enrollment_id,
                detail.status_group1_id,
                detail.status_group2_id,
                status1.status_code AS status_group1_code,
                status1.status_name AS status_group1_name,
                status2.status_code AS status_group2_code,
                status2.status_name AS status_group2_name
            FROM ${TABLE_SCHEMA}.billing_detail detail
            JOIN ${TABLE_SCHEMA}.status_master status1
                ON status1.status_id = detail.status_group1_id
            LEFT JOIN ${TABLE_SCHEMA}.status_master status2
                ON status2.status_id = detail.status_group2_id
            WHERE detail.billing_id = $1
            ORDER BY detail.billing_detail_id
            FOR UPDATE OF detail
        `, [billingId]);
        const details = detailsResult.rows;

        if (!details.length) {
            throw httpError(409, "ใบเสร็จนี้ไม่มีรายละเอียดให้ยกเลิก");
        }

        let deletedStatusHistory = 0;

        for (const detail of details) {
            const deleteHistoryResult = await client.query(`
                DELETE FROM ${TABLE_SCHEMA}.enrollment_status
                WHERE enrollment_id = $1
                  AND status_month = $2
                  AND status_year = $3
            `, [
                detail.enrollment_id,
                billing.billing_month,
                billing.billing_year
            ]);

            deletedStatusHistory += deleteHistoryResult.rowCount;

            await client.query(`
                UPDATE ${TABLE_SCHEMA}.enrollment
                SET current_status_group1_id = $1,
                    current_status_group2_id = $2,
                    updated_at = CURRENT_TIMESTAMP
                WHERE enrollment_id = $3
            `, [
                detail.status_group1_id,
                detail.status_group2_id,
                detail.enrollment_id
            ]);
        }

        await client.query(`
            DELETE FROM ${TABLE_SCHEMA}.billing_detail
            WHERE billing_id = $1
        `, [billingId]);
        await client.query(`
            DELETE FROM ${TABLE_SCHEMA}.billing
            WHERE billing_id = $1
        `, [billingId]);

        await client.query("COMMIT");

        return {
            success: true,
            billingId,
            receiptBook: billing.receipt_book,
            receiptNo: billing.receipt_no,
            billingMonth: billing.billing_month,
            billingYear: billing.billing_year,
            restoredEnrollments: details.length,
            deletedStatusHistory
        };
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
}
