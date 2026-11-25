# Unsaved work on navigation/close — 24 November 2026

This round adds leave protection to WS Input/AT, Students and Stock Receive.
It continues the existing uncommitted work. No schema/business-rule changes,
production transactions, real backup/Restore, print, KSIS write, deployment,
Git commit/push or production restart are part of this round.

## Reproduction

The browser and desktop fixtures typed a Student name, stock quantity or WS
selection, then dispatched a cancelable beforeunload event. The original pages
did not prevent unload. Defaults alone were clean. Evidence:

- `logs/round4-round6-before-clean.log`: actual missing protection for WS and
  Stock Receive, browser and desktop. The Student setup in this run incorrectly
  looked for a Student ID field inside the profile form.
- `logs/round4-round6-before-student.log`: the corrected setup waits for the
  actual first-name field and reproduces missing protection in both surfaces.

An earlier fixture version left its server/browser open when setup failed.
Only that runner, identified by its exact command and PID, and its child test
processes were stopped. Setup now closes its fixture on failure. No production
application process was stopped.

## Behavior

- `leaveGuard.js` reads each page's dirty/busy state without persisting drafts.
  Same-window app links ask before leaving edited values. Cancel keeps the
  current values; explicit discard navigates once, without a second warning.
  New tabs, downloads, same-document links and previously handled links keep
  their normal behavior.
- Browser close/reload uses its native beforeunload confirmation. The desktop
  window supplies its own warning and defaults to returning to work. An
  explicit discard allows unload. The existing authorized server-restart owner
  shutdown can still close its orphaned desktop instead of becoming stuck.
  A capability returned by the desktop host keeps an older running host from
  silently blocking native close if it reloads new web files before restart.
  Menu protection still works there; the new native close dialog becomes
  available when a new desktop process is launched.
- Login logout requests are not sent until the user accepts leaving a dirty
  page. A busy save instead asks the user to wait for the result. The update
  action also waits for pending writes and includes dirty-work details in its
  existing final confirmation.
- WS defaults and the next Receive Date after a successful save form clean
  baselines. Failed WS writes retain the draft. AT score/time/date/group/pass
  edits are tracked independently, including pending and failed submissions.
  History controls with uncommitted input also request close/reload protection.
- Students reuses its existing per-form baselines. Saving one form still keeps
  changes in the other. Add Student/Add Subject and edited Resume dates are
  tracked while their forms are open. Explicit Cancel buttons retain their
  existing discard behavior.
- Stock quantities and header-only edits are protected. Saving, starting a new
  DO or choosing an existing saved DO updates the header baseline. Detail edits
  and pending writes are included. Durable unresolved DO operations retain the
  existing operation key; the warning explains that navigation does not cancel
  a submitted operation. No automatic retry or additional stock write is added.
- The two circular Student/WS module entry URLs remain unversioned. Only shared
  classic-script references are versioned. PC/tablet layout and business buttons
  are unchanged; no smartphone redesign was applied.

## Verification scope

The dedicated UI suite exercises clean defaults, dirty values, cancel/confirm
navigation, pending/failed/successful saves, actual cancelled browser reload,
actual Electron window close with cancel then discard, logout, AT/Add Student/
Add Subject forms, header-only DO input, update cancellation and unresolved DO
messages. All API writes are synthetic fixture requests. Desktop close tests
replace their own native message-box function; they do not open/close the user's
KumonDB window.

Regression coverage includes WS search/date/number/history, AT/Zun advancement
and delayed results, CD handout, Student drafts/status/date/Zun corrections,
DO retries/quantity/Process/deletion, menus and desktop account/KSIS isolation.
The service/HTTP suite uses mocks, temporary resources and the guarded Restore
fixture from the previous round. No live database integration was needed for
these frontend/desktop changes.

Fixture teardown explicitly allows discarding synthetic state. The DO recovery
test explicitly authorizes its intentional reload while keeping the original
key/quantity assertions. A stock selection test now waits for the previous
native dialog's queued close event before starting its next choice; its value
and cancellation assertions are unchanged.

Final counts, log fingerprints and preserved prior work are indexed in
`reviews/2026-11-24/leave-guard-verification.json`.

Final verification totals: **458 passing checks**, one existing opt-in Windows
restart-helper skip. This is 352 service/HTTP checks and 106 unique UI checks:
84 existing regression checks plus 22 leave-protection checks. The first broad
UI run passed 83 and hit the stock dialog-close timing case described above;
the stock recheck passed all four cases with the original value assertions.
The 28-case guard/stock rerun and three-case desktop compatibility rerun are
deduplicated against those totals. A subsequent capability run exposed a real
startup bug: a transient desktop-info failure was incorrectly classified as an
old host, disabling native-close protection. Only a successful legacy response
now enables that compatibility fallback; unknown failures keep protection and
retry on load/focus. The native-close/legacy/failing-IPC checks and all six
browser/desktop navigation paths pass after this fix. Rechecks resolve the two
failures in that run without counting any repeated case again.
The desktop workflow's expected info response
now includes `leaveConfirmation: true`; its login, account isolation, KSIS view,
print and foreign-sender assertions remain intact and pass in the final rerun.
Syntax checks and `git diff --check` also pass.

## Limits

This is leave protection, not automatic saving or crash recovery. Forced process
termination/OS failure can still lose renderer drafts. Leaving cannot roll back
requests already sent to the server, which may finish after the window closes.
Remote KSIS form edits and other pages' specialized payment/printing workflows
retain their existing guards; they are not claimed as new coverage here.
