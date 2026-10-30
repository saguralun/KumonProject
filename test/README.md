# Tests

## Safe Defaults

```powershell
npm test
```

Node discovers `test/**/*.test.js`. Database-backed unit tests replace both
`pool.query` and `pool.connect` with test doubles. They must never call the
production pool: this machine's `.env` points at real data.

Some tests start temporary loopback HTTP fixture servers. They do not start
the application server. Browser and database integration tests are opt-in.

## Full Local Suite

```powershell
$env:TEST_BROWSER_UI = '1'
$env:TEST_ISOLATED_PG = '1'
node --test --test-concurrency=1
```

Browser tests use Playwright, installed Chrome and synthetic page/API fixtures.
Embedded-app tests use a separate Electron fixture/profile. They do not access
the real KSIS account, session, application server or student records.
Serial execution avoids competing browser fixtures on slower workstations.

`isolatedDatabase.integration.test.js` runs on Windows and requires installed
PostgreSQL binaries (default `C:/Program Files/PostgreSQL/18/bin`; override with
`TEST_PG_BIN`). It creates its own cluster in a uniquely named temporary folder,
binds a random loopback port, verifies that cluster's identity, and directs all
service calls to it. It never derives its connection from `DB_*`. Schema setup,
migrations, payment/status changes, WS, stock cuts and restore tests run only
inside that disposable cluster. The test shuts down and removes only its own
cluster when finished.

Do not enable `TEST_WINDOWS_RESTART` for routine checks. It is a separate opt-in
restart-helper test, not necessary for this suite's application regression check.

## Coverage

- Payment receipt allocation and duplicate-payment protection under concurrency.
- Cancellation provenance, legacy receipts, later status edits and later bills.
- WS connection-pool saturation, rollback, delete/date-edit transactions.
- Stock locking, missing balances, concurrent cuts and late arrivals.
- Account revocation, role changes, update authorization and Opening Schedule.
- Update availability while login/workspace pages stay open, including normal
  local users, focus/online retries, offline notices, shared version-check cache,
  explicit cancellation and verified restart waiting (mocked installation).
- Generated-file update recovery in disposable Git repositories: verified private
  backups, preserved runtime reports, equivalent lockfile metadata, refused
  source/staged/dependency changes, backup failures and concurrent edits. A real
  offline npm fixture checks that deployment does not dirty its lockfile. The
  standalone Windows recovery download runs against a fake update API only;
  see `launcher/UPDATE-RECOVERY.md` for its one-time use on older installations.
- Whole-application schema upgrades: the canonical contract, fresh readable
  backup before additive DDL, post-check, idempotence, original-row preservation,
  unsafe-change rejection, competing upgrades and complete rollback. Windows
  bridge fixtures prove failed preparation leaves their original server running
  and successful preparation permits only their isolated replacement server.
  Forecast CHECK fixtures cover IN/ANY and text/varchar dump/restore variants
  without any repair, preserve existing rows, and reject genuinely changed
  allowed values. Run the isolated fixture with `TEST_PG_BIN` pointing to each
  supported installed PostgreSQL release to check its catalog representation.
  See `database/UPGRADES.md` for operational limits and contract regeneration.
- Atomic restore, including a real failed COPY on the disposable database.
- Student selection during saves, stale responses and visible save failures.
- Shared header menu on all 16 workspaces at desktop/mobile widths: no edge
  handle, full-width workspace, click-outside/Escape close, keyboard focus trap,
  permission visibility and menu state reset after navigation. The first paint
  stays full-width with navigation hidden even before scripts initialize.
- Integrated main desktop: real login/logout in fixtures, normal-page navigation,
  exact visible/controlled KSIS view, per-account remote sessions, rejected
  mismatched app sessions, one-window printing, downloads, attachment retries
  and non-destructive shortcut reuse. Electron profiles are temporary test-only
  directories; printer operations are replaced with a harmless callback.
- Report calculations, KSIS identity matching, WS/AT previews and audits,
  guarded saves, pagination, shared embedded workspace and responsive layout
  using synthetic fixtures.
- All 17 pages' declared button wiring and shared in-app confirmations, plus
  browser/Electron workflow tests for Stock Receive/Cut, Opening Schedule,
  Backup/Restore, permissions, table paging, Progress subject races, CD/history,
  Forecast views and valid downloadable Report/Forecast Excel workbooks. The
  page matrix and operational limits are in `CONTROLS-AUDIT-2026-10-23.md`.

Passing these checks does not prove an untested live KSIS change, printer,
network outage or production deployment works. Never run live save/restore/
restart actions without separate authorization.
