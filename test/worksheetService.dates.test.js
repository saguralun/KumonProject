import assert from "node:assert/strict";
import { test } from "node:test";
import { assertIsoDate, normalizeBillingPeriod, normalizeDate } from "../services/worksheetService.js";

test("normalizeDate formats a Date object as YYYY-MM-DD", () => {
    assert.equal(normalizeDate(new Date(2026, 7, 31)), "2026-08-31"); // month is 0-indexed
});

test("normalizeDate truncates a datetime string down to just the date", () => {
    assert.equal(normalizeDate("2026-08-31T22:47:00.000Z"), "2026-08-31");
});

test("normalizeDate returns an empty string for anything else", () => {
    assert.equal(normalizeDate(null), "");
    assert.equal(normalizeDate(undefined), "");
    assert.equal(normalizeDate(12345), "");
});

test("assertIsoDate passes through a valid YYYY-MM-DD date", () => {
    assert.equal(assertIsoDate("2026-08-31", "Billing date"), "2026-08-31");
});

test("assertIsoDate rejects an invalid date with a labeled 400 error", () => {
    assert.throws(
        () => assertIsoDate("not-a-date", "Billing date"),
        (error) => {
            assert.equal(error.statusCode, 400);
            assert.equal(error.message, "Billing date ไม่ถูกต้อง");
            return true;
        }
    );
});

// Kumon's own billing rule: a worksheet/payment dated after the 20th of
// the month counts toward NEXT month's tuition instead of the current
// one. Getting this wrong means real receipts landing in the wrong
// billing month, so it's worth pinning down explicitly.
test("normalizeBillingPeriod rolls billing month forward for a date after the 20th", () => {
    const result = normalizeBillingPeriod({ billingDate: "2026-08-25" });

    assert.equal(result.billingMonth, 9);
    assert.equal(result.billingYear, 2026);
});

test("normalizeBillingPeriod keeps the same month for a date on/before the 20th", () => {
    const result = normalizeBillingPeriod({ billingDate: "2026-08-20" });

    assert.equal(result.billingMonth, 8);
    assert.equal(result.billingYear, 2026);
});

test("normalizeBillingPeriod rolls both month and year forward across December -> January", () => {
    const result = normalizeBillingPeriod({ billingDate: "2026-12-25" });

    assert.equal(result.billingMonth, 1);
    assert.equal(result.billingYear, 2027);
});

test("normalizeBillingPeriod uses an explicitly-given month/year instead of deriving one", () => {
    const result = normalizeBillingPeriod({
        billingDate: "2026-08-25",
        billingMonth: 3,
        billingYear: 2027
    });

    assert.equal(result.billingMonth, 3);
    assert.equal(result.billingYear, 2027);
});

test("normalizeBillingPeriod rejects an out-of-range explicit year", () => {
    assert.throws(
        () => normalizeBillingPeriod({ billingDate: "2026-08-25", billingMonth: 3, billingYear: 1500 }),
        (error) => {
            assert.equal(error.statusCode, 400);
            return true;
        }
    );
});
