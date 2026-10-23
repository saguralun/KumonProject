# Application Controls Audit: 2026-10-23

## Scope And Safety

Reviewed all 17 application pages, including Migration and Login. The static
inventory contains 238 declared buttons, including navigation and hidden modal
controls. Dynamically rendered rows, pagination and confirmation buttons are
covered separately by workflow fixtures. A code reference is a wiring check,
not proof that every possible data-dependent branch works.

Browser and actual Electron tests use synthetic local servers and separate
temporary profiles. Database integration uses a disposable PostgreSQL cluster.
No real student, receipt, inventory, KSIS, restore, import or updater operation
was performed. The running application was not restarted. No schema changes
are part of this repair.

## Repairs

1. Replaced the remaining native confirmation/alert calls throughout the app
   and Migration with shared asynchronous in-app dialogs. Cancellation is the
   default, text is escaped, duplicate dialogs are rejected and focus returns
   after dismissal. A contract test prevents native dialogs being reintroduced.
2. Let the topmost dialog own Tab and Escape instead of the navigation menu
   trapping those keys when Update is opened from its account controls.
3. Restore Stock Cut controls after failed requests. Serialize cutting, capture
   the confirmed type/dates, ignore stale WS/CD responses, and do not enable a
   cut against a pending-list load that failed.
4. Serialize DO form submissions and prevent editing/resetting the submitted
   quantities while the request is running. A failed request retains input.
5. Ignore stale DO detail responses. Item changes, Process and deletion retain
   the exact confirmed DO, without closing or replacing a newly opened one.
   These mutations are serialized so Process cannot race a quantity change.
6. Serialize permission changes per role so two checkbox requests cannot
   overwrite each other's complete grant list. Restore controls and checked
   values on rejection.
7. Keep Backup/Restore mutually exclusive and prevent file/name changes or
   duplicate submissions during Restore. Preserve exact database confirmation.
8. Capture worksheet context/date for CD operations, prevent duplicate CD
   requests and never apply their responses to a newly selected student.
9. Ignore old worksheet-history responses after student/date/limit changes.
   Delete and free-level completion retain the context that was confirmed.
10. Ignore stale table-viewer responses after another table/page was selected.
11. Keep Progress Chart responses in the correct subject cache and ignore
    responses from an older refresh or subject selection.
12. Gate Forecast exports on usable results. New/failed calculations cannot
    leave old results available as the new forecast or export an unready plan.
13. Notify the embedded KSIS view when a shared dialog opens/closes, so its
    native browser layer cannot cover the confirmation or intercept its clicks.

## Page Matrix

| Page | Declared buttons | Main evidence |
| --- | ---: | --- |
| Login | 5 | Fixture sign-in, guest service, confirmed local update, cancellation, failure recovery and verified runtime replacement |
| Tables | 5 | Table selection, delayed responses, paging and page-size changes |
| Students | 39 | Source/wiring review; shared form/import helpers; identity preview; Absent/Resume success, cancellation, errors and duplicate prevention in browser/Electron |
| Worksheet | 26 | WS saving and selection locks; validation, stale responses, history/date changes; CD confirmation/error/duplicate/cross-student cases |
| Payment | 22 | Receipt preview, partial subject selection, explicit confirmations, failures, unpaid shortcuts and transaction/cancellation integration tests |
| Report | 12 | Subject views, report rendering/pagination, CSV, event and level summaries, downloaded Excel opened with ExcelJS |
| K-sis | 34 | Synthetic WS/AT preview, identity confirmation, guarded saves, audit/pagination, shared state, recovery/reset and login boundaries |
| Progress Chart | 8 | Subject and grade controls, refresh, delayed subject responses, graph positioning and responsive rendering |
| Statistics | 5 | Read/render path, legends/source review and shared navigation controls |
| Stock | 6 | Subject switching, summary and refresh using synthetic inventory |
| Stock Receive | 10 | Type/subject/level/quantity input; failed/successful DO saves; detail race; item quantity/delete; Process/delete confirmations and processed-state restrictions |
| Stock Cut | 8 | Detail, one-day/all cancellation, rejected/successful cuts, duplicate prevention and delayed WS/CD responses |
| Forecast | 13 | Failed/retried generation, details, forecast/order/expected-stock views and valid multi-sheet Excel exports |
| Opening Schedule | 7 | Duration/end-time calculation; add failure/retry; active switch, refresh and cancelled/confirmed deletion |
| Users | 7 | Source/wiring review; permission serialization/rejection and cancelled/confirmed role deletion; backend account revocation tests |
| Backup | 7 | Synthetic backup/download; typed-name validation, restore cancellation/rejection/success and duplicate prevention |
| Migration | 24 | Source/wiring review, module readiness controls and destructive setup cancellation in browser/Electron; actual import/setup deliberately not executed |

All pages also participate in the shared navigation/role visibility and
desktop/mobile layout suite. Buttons unavailable under a role, current status
or missing input remain unavailable; this audit does not broaden permissions
or change the existing enrollment-status rules.

## Remaining Operational Checks

- Live KSIS can change its forms/API independently. Synthetic matching and
  save/audit tests cannot prove that a live row was saved or should be retried.
- Printer connection, physical paper output and the other machine's current
  running build require separate authorized smoke checks.
- Live Import, Restore, receiving money and deployment must not be used as
  button tests. They require the intended target, backup and explicit consent.
- These checks substantially extend coverage, but do not establish that every
  possible record combination or network failure is defect-free.

Full-suite execution instructions are in [README.md](README.md).

## Verification Result

Final combined run: **281 tests, 280 passed, 0 failed, 1 skipped** in about
262 seconds. Browser UI and isolated PostgreSQL integration flags were enabled.
The skipped test is the opt-in Windows server restart helper, deliberately not
enabled. Additional focused checks passed for duplicate DOM identifiers, dialog
layering/focus and the new workflows before this combined run.

JavaScript syntax checks passed for 110 application/service/route/desktop files.
`git diff --check` passed. The inventory artifact is generated in the system
temporary directory as `kumondb-button-inventory.json`, not production data.
