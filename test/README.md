# Tests

Run with:

```bash
npm test
```

Uses Node's built-in test runner (`node --test`, `node:assert/strict`) —
no extra dependency needed, works with this project's ESM setup as-is.
Node auto-discovers every `test/**/*.test.js` file.

## Scope so far

Pure unit tests only — no database, no live server, no network calls.
Every test here imports a real service file and calls its exported
functions directly with plain in-memory arguments; none of them touch
Postgres or the running app. That's deliberate: this machine's `.env`
points at the real production database, so a test suite that ran real
queries could read or write live data. Don't add a test here that calls
a DB-touching function (anything that does `pool.query(...)`) without
first working out a separate test-database strategy.

Covered:
- `services/httpError.js` — the shared error-with-status-code helper
- `services/enrollmentHelpers.js` — `isCompleterLevel`, `formatStudentName`
- `services/worksheetService.js` — `normalizeDate`, `assertIsoDate`,
  `normalizeBillingPeriod` (including the day > 20 "rolls into next
  month" Kumon billing rule)
- `services/printerRawService.js` — the receipt-formatting helpers
  (`formatMoneyAscii`, `hasThai`, `splitNickname`, `monthNameEn`,
  `formatDateDisplay`, `formatTimeDisplay`)
- `services/authService.js` — `verifyGuestLogin`'s validation logic
  (deliberately never asserts against the real `GUEST_PIN` value in
  committed source — see that test file's comment)

Not covered yet: anything that touches the database (most of
`studentService.js`, `paymentService.js`, `worksheetService.js`'s
DB-backed functions, etc.), the frontend `public/js/*.js` files (would
need a browser-like environment or DOM stubbing to test in isolation),
and the printer transports (real hardware/network I/O, not something to
unit test).
