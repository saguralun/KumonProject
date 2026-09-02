import assert from "node:assert/strict";
import { test } from "node:test";
import {
    formatDateDisplay,
    formatMoneyAscii,
    formatTimeDisplay,
    hasThai,
    monthNameEn,
    splitNickname
} from "../services/printerRawService.js";

test("formatMoneyAscii formats with thousands separators, 2 decimals, and a THB suffix", () => {
    assert.equal(formatMoneyAscii(1700), "1,700.00 THB");
    assert.equal(formatMoneyAscii(0), "0.00 THB");
    assert.equal(formatMoneyAscii(1234567.5), "1,234,567.50 THB");
});

test("formatMoneyAscii treats null/undefined as zero rather than throwing", () => {
    assert.equal(formatMoneyAscii(null), "0.00 THB");
    assert.equal(formatMoneyAscii(undefined), "0.00 THB");
});

test("hasThai detects Thai script and ignores plain ASCII", () => {
    assert.equal(hasThai("กชพร สังขจันทร์"), true);
    assert.equal(hasThai("ME (#3181)"), false);
    assert.equal(hasThai(""), false);
    assert.equal(hasThai(null), false);
});

test("splitNickname pulls the trailing (nickname) off formatStudentName()'s output", () => {
    assert.deepEqual(
        splitNickname("กชพร สังขจันทร์ (น้องน้อยหน่า)"),
        { name: "กชพร สังขจันทร์", nickname: "(น้องน้อยหน่า)" }
    );
});

test("splitNickname returns the whole string as the name when there's no nickname", () => {
    assert.deepEqual(splitNickname("John Smith"), { name: "John Smith", nickname: "" });
});

test("splitNickname handles an empty/missing name", () => {
    assert.deepEqual(splitNickname(""), { name: "", nickname: "" });
});

test("monthNameEn maps 1-12 to English month names", () => {
    assert.equal(monthNameEn(1), "January");
    assert.equal(monthNameEn(9), "September");
    assert.equal(monthNameEn(12), "December");
});

test("monthNameEn falls back to the raw value for an out-of-range month", () => {
    assert.equal(monthNameEn(13), 13);
    assert.equal(monthNameEn(0), 0);
});

test("formatDateDisplay converts an ISO date to DD/MM/<Buddhist year>", () => {
    assert.equal(formatDateDisplay("2026-08-31"), "31/08/2569");
});

test("formatDateDisplay falls back to '-' for missing/unparseable input", () => {
    assert.equal(formatDateDisplay(""), "-");
    assert.equal(formatDateDisplay(null), "-");
});

test("formatTimeDisplay renders HH:MM in local time from a full timestamp", () => {
    // Constructed from local Date parts (not a UTC string) so this doesn't
    // depend on which timezone the test happens to run in.
    const localTimestamp = new Date(2026, 7, 31, 22, 47, 0).toISOString();

    assert.equal(formatTimeDisplay(localTimestamp), "22:47");
});

test("formatTimeDisplay returns an empty string for an unparseable timestamp", () => {
    assert.equal(formatTimeDisplay("not-a-date"), "");
    assert.equal(formatTimeDisplay(""), "");
});
