# Remaining UI review items — 2026-11-24

Completes review items 3–6 after the modal/keyboard work in
`MODAL-UI-FIXES-2026-11-24.md`. The existing WS redesign mock remains cancelled.
The target is PC first, with tablet checks; no new smartphone layout is added.

## Students: explain status changes before confirmation

- A read-only, no-store Preview endpoint is restricted to the same
  Admin/Instructor roles as status actions. A READ ONLY/REPEATABLE READ
  transaction obtains the current enrollment and billing data without a row
  write lock. Preview itself never changes a student, bill or status log.
- Preview and the existing write action share one calculation for A/OT/CP,
  R/N/EO, the billing cutoff, missed months, H and Start Date. Existing rules
  and legacy callers without a Preview snapshot retain their contract.
- Before confirming, the dialog shows the resulting status, period, Start Date,
  special status and the reason for the period. Changed dates invalidate old
  reads. Failed reads keep Save disabled and provide an explicit read retry.
- The new UI submits the reviewed fingerprint. The write action recalculates
  under its existing enrollment lock and rejects a changed plan before writing.
  The UI then reads a new Preview and requires a new deliberate confirmation;
  it never retries a mutation automatically. Pending writes remain locked, and
  failures retain the entered date and existing draft protection.

## KSIS: visible groups and persistent audit scope

- WS/AT plans are grouped into Ready, Review/identity confirmation,
  Skipped/already present, and Outside the current page. Ready and Review start
  open; other groups can be opened with mouse or keyboard. Existing fill/save
  eligibility, identity matching, confirmations and payloads are unchanged.
- Blocked rows without a target remain visible with their reason. They do not
  inflate the Outside count. Off-page rows use an informational badge, not a
  red error. An empty ID continues to follow the existing N/EO/IT identity rules.
- A shared description formatter retains scope, original page, period,
  subject, check time, off-page counts, ignored blank rows and repeated rows
  when WS results return through the shared workspace. AT uses it as well.
  Existing audit filter/search values are not reset by shared result rendering.

## WS/AT: readable Save and actionable disabled reasons

- Save uses solid dark green and readable disabled text. Its state change does
  not animate through a temporarily low-contrast foreground/background pair.
  The normal and disabled appearance are verified from computed styles.
- A live hint next to Save states the exact missing requirement or pending
  operation. AT explains Score/Time/Group readiness. Existing eligibility and
  validation still decide whether saving is allowed.
- The tablet layout moves the same hint with the existing Save/CD controls;
  there is one button and one hint, with the same listeners and state.
- Common WS commands/counts use Thai labels while domain terms such as
  Main WS, Zun, AT and CPWS remain. All existing controls, including worksheet
  arrows and subject filters, are kept.

## Version checking and Windows startup feedback

- Login and the workspace menu display the last successful version-check time.
  A failed check explicitly says the version could not be verified, retaining
  an existing update badge. A manual Check Again bypasses only the read throttle;
  it still respects the busy/hidden/in-flight guards and never applies updates.
  A timestamp is optionally retained in session storage; blocked storage does
  not prevent version checks. The prior successful-status callback contract is
  preserved.
- Startup failures now show a Thai diagnostic dialog with computer, project
  folder, stage and details, plus Copy/Close. There is a visible fallback if
  WinForms cannot load. Hidden startup waits for local runtime readiness and
  explicitly verifies opening the integrated desktop, with bounded waits.
- Normal relaunch still reuses the existing app; it never becomes an automatic
  force restart. The rapid-launch cooldown and hidden server launch remain.
  The diagnostic helper is UTF-8 with BOM for Windows PowerShell 5.1.

## Verification and limits

All UI mutations use synthetic APIs and temporary browser/Electron profiles.
SQL unit tests poison the production pool; PostgreSQL integration uses only its
verified disposable cluster. Launcher tests replace network, process start/stop,
filesystem lock changes and native dialogs before executing the real script.
Native Copy/Close wiring is inspected; the user's real diagnostic window or
clipboard is not operated. The existing Windows restart-helper opt-in stays off.

The first broad UI run exposed five cases around the new grouped DOM: off-page
WS badges were still red and were corrected; AT tests now expand their closed
Outside group; the WS confirmation test scopes its original target-count
assertions to Ready while separately asserting Skipped rows. No mutation,
identity, saved-count or cancellation assertion was removed. A native PowerShell
fixture cold start exceeded its initial 12-second child-process limit once;
the exact standalone recheck passed, and the fixture now allows 30 seconds for
process startup without changing production startup deadlines or effect guards.

PC/tablet screenshots are in `logs/round8-ws-*.png`; related KSIS screenshots
come from the existing real-page fixtures. The final verification index is
`reviews/2026-11-24/ui-followup-verification.json` and records deduplicated cases,
source/log hashes, resolved failures and preserved earlier work.

No production data/schema update, backup, restore, payment, print or KSIS save is
performed. No production restart, commit or push is included in this round.

Final verification totals: **578 passing checks** — 371 service/HTTP checks,
46 disposable-PostgreSQL parent/subtests and 161 exact-name unique UI checks.
One existing opt-in Windows restart-helper test remains skipped. The broad UI
run's five grouped-DOM failures are resolved by the focused rechecks and the
final 82-case regression batch. Repeated cases, including eight launcher cases
in the mixed final feedback run, are counted once. The two PC/tablet layout
checks and final offline-feedback recheck pass. Source syntax, retained module
entry URLs, UTF-8 BOM and whitespace checks pass; the index records exact hashes.
