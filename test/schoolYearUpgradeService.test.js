import assert from "node:assert/strict";
import { test } from "node:test";
import { isSchoolYearUpgradeDue } from "../services/schoolYearUpgradeService.js";

// school_year 2026 covers 05/2026 through 04/2027 — the upgrade becomes
// due the instant the app's day>20-rolls-to-next-month billing rule
// first reports month 5 of 2027 (in practice, from 21/4/2027 onward).

test("isSchoolYearUpgradeDue is false before the rollover month", () => {
    assert.equal(
        isSchoolYearUpgradeDue(2026, { billingMonth: 4, billingYear: 2027 }),
        false
    );
});

test("isSchoolYearUpgradeDue is true exactly at month 5 of school_year + 1", () => {
    assert.equal(
        isSchoolYearUpgradeDue(2026, { billingMonth: 5, billingYear: 2027 }),
        true
    );
});

test("isSchoolYearUpgradeDue is false once past month 5 (already applied, waiting for next year)", () => {
    assert.equal(
        isSchoolYearUpgradeDue(2027, { billingMonth: 6, billingYear: 2027 }),
        false
    );
});

test("isSchoolYearUpgradeDue is false for month 5 of the wrong year", () => {
    assert.equal(
        isSchoolYearUpgradeDue(2026, { billingMonth: 5, billingYear: 2026 }),
        false
    );
    assert.equal(
        isSchoolYearUpgradeDue(2026, { billingMonth: 5, billingYear: 2028 }),
        false
    );
});

test("isSchoolYearUpgradeDue stays false for the whole rest of the school year after it's already due", () => {
    // Once school_year has been incremented to 2027 for the 2027/2028
    // cycle, month 5/2027 (the OLD due point) must never re-trigger.
    assert.equal(
        isSchoolYearUpgradeDue(2027, { billingMonth: 5, billingYear: 2027 }),
        false
    );
});
