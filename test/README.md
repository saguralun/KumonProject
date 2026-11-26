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

If cold Chrome/Electron startup on a busy PC exceeds an enclosing UI test
deadline, run only one browser suite and opt in to an outer deadline allowance:

```powershell
$env:TEST_UI_TIMEOUT_SCALE = '3'
node --import ./test/support/uiTimeoutAllowance.mjs --test --test-concurrency=1
```

The helper is inert without the opt-in and affects only `.ui.test.js` enclosing
timeouts. It does not change assertions, fixture responses, API operations or
Playwright action deadlines. Do not combine it with reviewInstrumentation's
timeout multiplier. Record the allowance with test results; do not classify a
functional assertion failure as machine slowness.

`isolatedDatabase.integration.test.js` runs on Windows and requires installed
PostgreSQL binaries (default `C:/Program Files/PostgreSQL/18/bin`; override with
`TEST_PG_BIN`). It creates its own cluster in a uniquely named temporary folder,
binds a random loopback port, verifies that cluster's identity, and directs all
service calls to it. It never derives its connection from `DB_*`. Schema setup,
migrations, payment/status changes, WS, stock cuts and restore tests run only
inside that disposable cluster. The test shuts down and removes only its own
cluster when finished.

Windows fixture startup has a separate allowance for cold process launches.
The disposable cluster uses `initdb --no-sync` and the existing server `-F`;
these tests check transactions, not recovery after a machine crash. A cleanup
failure reports its own diagnostic without hiding the original setup failure,
and data is retained if the test cannot confirm its cluster has stopped.

Do not enable `TEST_WINDOWS_RESTART` for routine checks. It is a separate opt-in
restart-helper test, not necessary for this suite's application regression check.

## Coverage

- The account menu keeps only a compact manual update-check button alongside
  Logout. Automatic checks stay silent while preserving update badges. Manual
  latest/new-version/offline results use a non-focusing five-second toast outside
  the menu; repeat checks replace its timer. Browser/Electron fixtures verify
  pending requests, PC/tablet bounds and zero installation or logout requests.
  Login retains its existing inline version feedback.

- Startup loading: ExcelJS and the native receipt bitmap binding load only when
  used. Synthetic workbooks and Thai/ASCII receipt buffers verify output without
  printing; simultaneous exports and failed first native-load retry are covered.
  Login remains interactive with delayed/failed external font CSS. Private status
  fixtures verify per-stage timings, repeat-click sharing, immediate module-error
  feedback, and the native loading window opening/closing without a server restart.
  Electron's local loading card is verified before navigation; startup stays
  pending while a synthetic login response waits. The separate native feedback
  window spans navigation, including when Electron replaces the old document.

- Remaining UI review: read-only status-action Preview, reviewed snapshots under
  the existing enrollment lock, date-read races/retries, grouped WS/AT plans,
  retained shared audit scope, readable Save/hints, offline version timestamps
  and read-only retries, and mocked Windows launcher failure feedback. See
  `UI-FOLLOWUP-2026-11-24.md` and its verification index.

- Worksheet AT/Find Incomplete WS use native modal focus containment, Escape
  and opener restoration. Keyboard name selection, independent paging, stale
  reads, pending/failed AT retries, nested notices and PC/tablet bounds run in
  both Chrome and the embedded desktop with synthetic endpoints. See
  `MODAL-UI-FIXES-2026-11-24.md` and `worksheetModalKeyboard.ui.test.js`.

- Shared cleanup helpers preserve migration parsing (Thai/AD dates, integer
  validation, level prefixes and issue summaries), local service dates and
  distinct stock null values. Stock type caches remain separate per service.
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
  Latest WS and incomplete-WS results use Receive Date,
  with ID as a same-date tie breaker, rather than the largest worksheet number.
  Tests cover backdated inserts, same-day ties and history/context limits.
  Main/Zun ring progress uses the highest CPWS worksheet number ever recorded
  in that current level, plus the existing nine-page packet endpoint, capped at
  200/100. Review packets and date edits cannot lower it; deleting the highest
  record or correcting its WS number recomputes the remaining maximum. Queries
  cover all dates independently of the displayed history limit and keep grade comparison
  on the same percentage. CPWS/KC and AT completion rules stay unchanged.

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
  WS filling permits A -> R only when Report is R and KSIS exposes a writable
  native R option. Preview and final confirmation show the return transition;
  identity is rechecked, ST1 changes first, then newly available worksheet
  fields are filled and verified. All other A rows keep their skip behavior.

- `worksheetCdBoundary.ui.test.js` exercises both slots of daily20 at all three
  TRP 7A/6A CD boundaries, explicit receive/decline/cancel decisions, failed
  receive retry, ordinary WS save after both decisions, duplicate/reversed
  packets, single-slot patterns, ME/EFL and context switches. CD master data
  and receive/stock APIs retain their existing contracts; no CD is handed out
  automatically by the tests or by changing the worksheet selection.
- `studentBirthDateSafety.test.js` and the Students UI cases reject changed
  future birthdays before writes, retain valid corrections and allow unrelated
  edits to legacy unchanged future dates. No new minimum-age rule is imposed
  on edits. Student deletion confirms the child, subject and DT scope first;
  billing/history deletion restrictions remain server-enforced as before.
- CD return race cases keep success and failure messages with the originating
  profile request. They do not redirect the return or change stock arithmetic.
- `stockHeaderDates.test.js` rejects date mismatches before appending quantity
  under the existing DO lock. Legacy calls that omit receiveDate still append
  without changing the stored receipt date/period. It does not add a
  retrospective date-edit API.
  `stockReadSafety.ui.test.js` verifies out-of-order DO searches, late search
  errors, physical-cut vs usage counts, zero physical cuts and older responses
  that omit cutQuantity (unknown is displayed, never inferred from usage).
  The disposable PostgreSQL suite independently checks birthday validation and
  date-mismatch rollback alongside the normal payment/stock/WS workflows.
- The AT advancement UI case waits for its own completion POST before checking
  the refreshed state. Viewport checks wait for the existing tablet DOM move
  before measuring Save/CD buttons. This preserves the original value/visibility
  assertions and avoids observing a prior result or a transient hidden panel.

- `rolePermissionEdits.test.js` and `usersAccountSafety.ui.test.js` reproduce
  stale whole-role grants in two independent admin contexts. Role-row locking
  and the required original-grants snapshot prevent silent overwrites. Tests
  cover deliberate review/retry, legacy-page rejection, Admin guards and cache
  refresh. Account creation is create-only; per-account password reset has its
  own endpoint/dialog and preserves name, role and activation. Reset tests cover
  target-only session revocation, in-flight old sessions, self-reset, rollback,
  cancel/clear, duplicate submit, retry and normal role/activation controls.
  The isolated PostgreSQL suite also tests real concurrent permission writers
  and reset/role actions without changing the schema. See
  `ACCOUNT-FIXES-2026-11-24.md` for reproduction and verification evidence.

- `updateBackupRecovery.ui.test.js` checks server/database identification,
  before-Restore archive downloads and restart failure feedback on Login and
  signed-in pages in browser/desktop fixtures. `backupRecoverySafety.test.js`
  exercises injected backup/restore steps, target metadata and upload cleanup.
  `backupImportRoutes.test.js` replaces subprocesses with a fresh function
  without Node's native custom promisifier, blocks other process entries and
  verifies the real route's Admin/name guards and structured recovery response.
  See `UPDATE-BACKUP-FIXES-2026-11-24.md`, including the initial test boundary
  incident and its production backup/retention side effects.

- `leaveGuard.ui.test.js` exercises unsaved-work protection on WS/AT, Students
  and Stock Receive: cancel/confirm navigation, pending/failed/successful saves,
  native browser reload cancellation, actual fixture-window close, logout and
  update cancellation, modal drafts and unresolved DO messages. No form values
  are auto-saved or persisted by the guard. Existing DO retry keys are retained.
  See `LEAVE-GUARD-FIXES-2026-11-24.md` for scope, reproduction and limitations.

- `fourPointClarity.ui.test.js` covers Progress assessment totals/reasons and
  WS date drafts in browser/desktop fixtures, including Tab/blur, explicit
  save/cancel, Enter/Esc, retries, processed-row locks, redraws, PC/tablet
  layouts and deliberate selection changes. Date drafts are memory-only;
  blur never saves or discards them. `progressChartAssessment.test.js` checks
  the read-only service payload and preserves the original pace calculation.
  `studentSearchAndHalfClarity.ui.test.js` covers Student/Enrollment ID labels,
  truthful exact/prefix matches, and explanations for the existing H/FSH/FRGH
  date alignment in both enrollment forms. No new date or billing policy is
  introduced. Verification is recorded in
  `reviews/2026-11-25/four-point-verification.json`.

- `reviewRemainingClarity.ui.test.js` and `reviewRemainingStress.ui.test.js`
  cover retained WS number/date drafts, explicit save/cancel, mixed-field saves,
  selection guards, concurrent number changes, processed/read-only drafts,
  older payloads, AT prerequisite/date explanations, PC/tablet layouts, inactive
  role usage and a role assigned by another machine during deletion. Existing
  AT defaults, completion eligibility and backend deletion rules are retained.
  `roleUsageCounts.test.js` and `worksheetCompletionHelp.test.js` cover the
  read-only metadata and pure explanations; the disposable PostgreSQL suite
  verifies real role counts and protects inactive accounts. Final evidence:
  `reviews/2026-11-25/remaining-three-verification.json`.

- `launcherFeedback.test.js` additionally reproduces a slow localhost lookup,
  cold startup beyond the former deadline, readiness at the final polling
  boundary and an invalid runtime response. The launcher uses direct local
  IPv4 for its own requests, retains the app's existing localhost origin,
  allows a bounded 90-second cold start and probes once more before failure.
  True server/window/dependency failures still display diagnostics. Tests
  replace process/network/dialog effects; the live confirmation only reads
  runtime status and does not restart or focus the working app. Evidence:
  `reviews/2026-11-26/launcher-readiness-verification.json`.

Passing these checks does not prove an untested live KSIS change, printer,
network outage or production deployment works. Never run live save/restore/
restart actions without separate authorization.
