import assert from "node:assert/strict";
import { test } from "node:test";
import { formatStudentName, isCompleterLevel } from "../services/enrollmentHelpers.js";

test("isCompleterLevel matches the configured completer level per subject", () => {
    assert.equal(isCompleterLevel("ME", "O"), true);
    assert.equal(isCompleterLevel("EFL", "O"), true);
    assert.equal(isCompleterLevel("TRP", "III"), true);
});

test("isCompleterLevel rejects a level that isn't that subject's completer level", () => {
    assert.equal(isCompleterLevel("ME", "N"), false);
    assert.equal(isCompleterLevel("TRP", "O"), false); // O is ME/EFL's completer, not TRP's
});

test("isCompleterLevel returns false for an unknown subject code", () => {
    assert.equal(isCompleterLevel("UNKNOWN", "O"), false);
});

test("formatStudentName combines first + last name with no nickname", () => {
    assert.equal(
        formatStudentName({ first_name: "กชพร", last_name: "สังขจันทร์" }),
        "กชพร สังขจันทร์"
    );
});

test("formatStudentName appends the nickname in Kumon's 'น้อง<nickname>' form", () => {
    assert.equal(
        formatStudentName({ first_name: "กชพร", last_name: "สังขจันทร์", nickname: "น้อยหน่า" }),
        "กชพร สังขจันทร์ (น้องน้อยหน่า)"
    );
});

test("formatStudentName tolerates missing first/last name fields", () => {
    assert.equal(formatStudentName({ last_name: "สังขจันทร์" }), "สังขจันทร์");
    assert.equal(formatStudentName({ first_name: "กชพร" }), "กชพร");
    assert.equal(formatStudentName({}), "");
});
