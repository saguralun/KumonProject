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
- Concurrent last-Admin changes across deactivate/demote/upsert, and permission
  cache reads racing revocation. Both unit fixtures and a disposable PostgreSQL
  check protect the final active Admin.
- Update availability while login/workspace pages stay open, including normal
  local users, focus/online retries, offline notices, shared version-check cache,
  explicit cancellation and verified restart waiting (mocked installation).
- Generated-file update recovery in disposable Git repositories: verified private
  backups, preserved runtime reports, equivalent lockfile metadata, refused
  source/staged/dependency changes, backup failures and concurrent edits. A real
  offline npm fixture checks that deployment does not dirty its lockfile. The
  standalone Windows recovery download runs against a fake update API only;
  see `launcher/UPDATE-RECOVERY.md` for its one-time use on older installations.
- Code-only updates: complete injected pull/install/restart flow without a
  database connection, inert legacy entry points for the first transition,
  removed preparation API, ignored historical schema reports and retry after
  installation/restart failure. Windows fixtures restart only their disposable
  server despite a poisoned legacy preparation script, and refuse a changed
  runtime identity. Manual receipt migration fixtures and read-only Payment
  safety guards remain covered; updates never apply DDL.
- Atomic restore, including a real failed COPY on the disposable database.
- Student selection during saves, stale responses and visible save failures.
- Student profile/history and enrollment saves cannot replace a later selection;
  Add Student duplicate-check failures stay visible. Users refreshes cannot
  overwrite a permission change that completed while their response was pending.
- Displayed main/Zun/AT context is checked under enrollment locks. Tests cover
  concurrent stale submissions, historical AT edits, digital KC completion and
  appending to a delivery order while Process owns its parent lock.
- Backup publication runs the real script against a fake dump executable:
  partial, empty, missing and interrupted output never becomes a completed backup,
  and filename collisions preserve the earlier archive. No real dump is run.
- A helper error after READY releases only its own Update attempt; unknown
  status never permits a concurrent updater.
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
- Automatic student Preview opens the same embedded KSIS view beside the form,
  waits for synthetic manual login without reloading typed input, and resumes
  reading without applying or saving. Fixtures cover cancellation, expiry,
  account/token isolation, stale opens, dirty forms and competing WS/AT drafts.
- All 17 pages' declared button wiring is checked against each page's own loaded
  scripts and recursive imports; local scripts, styles and image assets must
  resolve. Shared in-app confirmations are covered alongside
  browser/Electron workflow tests for Stock Receive/Cut, Opening Schedule,
  Backup/Restore, permissions, table paging, Progress subject races, CD/history,
  Forecast views and valid downloadable Report/Forecast Excel workbooks. The
  desktop download fixtures save real synthetic copies to isolated Downloads
  directories and forbid native save dialogs. They verify exact backup bytes
  after desktop shutdown, safe duplicate naming under concurrent downloads,
  failed saves/retries, missing files and permission errors without a live dump.
  The page matrix and operational limits are in `CONTROLS-AUDIT-2026-10-23.md`.
- The single Migration engine is exercised in browser and Electron: every
  module Preview/Import button, dependency rules, cancellation, failed imports,
  retries and out-of-order pagination use synthetic endpoints only. The obsolete
  first engine and initial cards have been removed; live fallback data adapters
  remain. Shared WS/AT confirmation scopes are invalidated if another window
  changes eligible identities before approval.

- Students/WS subject cues are covered with synthetic browser and Electron
  fixtures: independent subject filters and ID/name search, ME/EFL/TRP panel
  colors, mixed enrollment status badges, responsive layout and no writes.
  Directory absence durations use month/year history, not an invented day;
  missing history stays unknown. The disposable PostgreSQL suite checks
  repeated A logs, Resume followed by a new absence (including the same
  month), exact enrollment searches and existing Active/Absent filters.

- Unused enrollment corrections are checked in browser
  and Electron, including failed-save recovery, reload and Add Subject.
  New Start Date and DT defaults use day one of the current calendar month;
  existing enrollment dates are unchanged when opened. Tests also cover the
  date default after the 20th and across December/January.
  Disposable PostgreSQL tests cover half-month/exemption rules, the existing
  schema remaining unchanged, and a new status committed while an initial-data
  edit waits on the enrollment lock. These fixes add no tables or columns.
  Both Student subject forms offer No Zun / ZI / ZII and round-trip the
  existing level IDs; packet selection remains in WS Input.
  N/EO enrollments retain Start Date / Special Status corrections after usage;
  other initial fields stay locked. Browser and Electron tests cover manual
  exemptions, H/FSH date alignment, failed-save retry and reload. Disposable
  PostgreSQL tests preserve WS/status/billing history, reject edits after a
  concurrent change out of N/EO, and keep the schema unchanged.
  WS Receive Date defaults to that enrollment's Start Date without WS history;
  existing WS uses the latest WS date plus one day. Tests cover corrected Start
  Dates, other subjects, older WS inserts and deleting the final WS record.
  A successful main-level advancement starts the input at packet 1, including
  when the new level has old history; failure, historical AT edits without a
  level change and final levels preserve their defaults. Enrollment starting
  packets apply only to their own level; subsequent WS uses normal history.
  Unprocessed history rows allow inline WS-number corrections with Enter;
  Escape/blur cancels. Corrections preserve the record, date, level and CPWS,
  resolve the corresponding packet, and refresh progress/summary atomically.
  Browser/Electron tests cover retry, duplicate submission, processed rows,
  late responses and failed history refresh. Disposable PostgreSQL tests cover
  stale snapshots, Zun bounds, rollback and both stock-cut/edit lock orders.
  WS search uses one ID/name/nickname field, with exact IDs ahead of ID prefixes
  and numeric names. Browser/Electron checks cover immediate Enter, subject
  filters, responsive layout and obsolete responses; disposable PostgreSQL
  tests cover ranking, Thai/full names, nicknames and legacy search modes.
  FRGH combines half tuition/additional fees with free registration. Catalog
  startup checks only this status, backs up before inserting a missing row,
  preserves existing IDs/labels and leaves schema repair retired. Tests cover
  missing/existing centers, occupied IDs, backup failure and concurrent starts;
  receipts retain fee/status snapshots, Report marks free registration and
  unchanged receipt cancellation restores FRGH. Browser/Electron checks cover
  Add Subject and N/EO corrections with FRG/FRGH date alignment.
  WS History uses worksheet_used_id descending on load, after saves and after
  date correction, so newly entered rows stay visible even with a wrong date.
  Latest WS, incomplete-WS results and the progress ring use Receive Date,
  with ID as a same-date tie breaker, rather than the largest worksheet number.
  Tests cover backdated inserts, same-day ties and history/context limits.

- KSIS roster previews separate ID-less children by exact name and DOB, merge
  only repeated copies of that identity, and show missing IDs as neutral info.
  WS/AT planning and audits accept an ID missing on either side regardless of
  active status. Unique exact name/DOB/subject matches are ready without a
  per-row checkbox; duplicate identities, bad dates and conflicting
  known IDs remain blocked for existing-student statuses. N/EO/IT bypass IDs
  (including temporary or conflicting values) and match exact name/DOB/subject;
  they retain duplicate protection and identity rechecks immediately before
  filling. The single final fill/save confirmation is still required. Off-page children
  are separated from missing DOB or same-name/DOB conflicts. Blank IDs never
  enter the ID-import save endpoint, and matching never changes stored IDs.
  WS/AT readers exclude filtered-out headers and subject/test rows while still
  including rows below the scroll. Hidden dirty rows block preparation, refresh
  and batch saves. A six-row filtered fixture verifies the left preview count
  and shared header both reflect the prepared page.
  WS audit accepts one child's distinct subjects across page boundaries, even
  for N/EO/IT without IDs. Same-page duplicate headers, repeated subject rows
  and different local students sharing an identity remain reviewable.
  WS audit skips A/OT only when the Report itself is inactive (or the row exists
  only in KSIS). Active Report rows, including R, against KSIS A/OT are visible
  mismatches. The audit does not authorize or change KSIS statuses.

Passing these checks does not prove an untested live KSIS change, printer,
network outage or production deployment works. Never run live save/restore/
restart actions without separate authorization.
