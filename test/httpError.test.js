import assert from "node:assert/strict";
import { test } from "node:test";
import { httpError } from "../services/httpError.js";

test("httpError builds an Error carrying the given status code and message", () => {
    const error = httpError(404, "ไม่พบข้อมูล");

    assert.ok(error instanceof Error);
    assert.equal(error.statusCode, 404);
    assert.equal(error.message, "ไม่พบข้อมูล");
});

test("httpError keeps distinct instances independent", () => {
    const a = httpError(400, "bad request");
    const b = httpError(500, "server error");

    assert.equal(a.statusCode, 400);
    assert.equal(b.statusCode, 500);
    assert.notEqual(a.message, b.message);
});
