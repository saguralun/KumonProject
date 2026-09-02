import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyGuestLogin } from "../services/authService.js";

// Deliberately never asserts against the real GUEST_PIN value here — that
// would mean committing the actual shared PIN into test source. Wrong-PIN
// checks use an obviously-fake value instead, and the one test that needs
// the real PIN to succeed reads it from process.env at run time (populated
// from .env the same way the app itself gets it) and skips if it isn't set,
// rather than ever hardcoding it.

test("verifyGuestLogin rejects an empty display name regardless of PIN", () => {
    assert.throws(
        () => verifyGuestLogin({ displayName: "", pin: "anything" }),
        (error) => {
            assert.equal(error.statusCode, 400);
            return true;
        }
    );
    assert.throws(() => verifyGuestLogin({ displayName: "   ", pin: "anything" }));
});

test("verifyGuestLogin rejects an obviously-wrong PIN", () => {
    assert.throws(
        () => verifyGuestLogin({ displayName: "Test User", pin: "definitely-not-the-real-pin-000" }),
        (error) => {
            assert.equal(error.statusCode, 401);
            return true;
        }
    );
});

test("verifyGuestLogin trims the display name", () => {
    assert.throws(() => verifyGuestLogin({ displayName: "  ", pin: "wrong" }), (error) => {
        assert.equal(error.statusCode, 400); // trimmed to empty, not treated as a valid name
        return true;
    });
});

test("verifyGuestLogin accepts the actually-configured PIN and returns a guest session shape", (t) => {
    if (!process.env.GUEST_PIN) {
        t.skip("GUEST_PIN not configured in this environment");
        return;
    }

    const result = verifyGuestLogin({ displayName: "  Test Guest  ", pin: process.env.GUEST_PIN });

    assert.equal(result.role, "guest");
    assert.equal(result.displayName, "Test Guest"); // trimmed
});
