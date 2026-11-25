# Worksheet modal keyboard controls — 2026-11-24

## Scope

UI review items 1–2 only: AT and Find Incomplete WS keyboard/focus behavior,
and keyboard selection of a child from the incomplete-WS list. Business rules,
API payloads, dates, stock, identity matching and the database schema are not
changed. Existing buttons, row-click selection, subject colors, regular/KC
pagination, Enter shortcuts and pass/fail defaults remain available.

## Changes

- Both overlays use native modal dialogs. Background controls cannot receive
  keyboard or mouse focus. Tab/Shift+Tab stay inside the open dialog; Escape,
  Close and backdrop clicks use the same page-specific cancellation rules.
  Closing returns focus to the opener, including either AT entry button.
- A shared modal controller owns opening, cancellation, focus wrapping and
  restoration. A queued close event cannot hide an already reopened dialog.
  Backdrop mousedown prevents the browser's subsequent default focus action
  from replacing the restored opener with the now-hidden dialog.
- AT still uses Enter for Score → Time → Group → Save and arrow keys for
  Group. Tab follows the actual controls, including Pass/Fail and Date AT.
  While a save is pending, controls and duplicate submission remain blocked;
  Escape/backdrop cannot close the waiting form. Errors appear inside the
  dialog, retain the entered values and restore focus for deliberate retry.
  Existing context/revision checks still ignore stale AT results.
- Incomplete WS puts a native button on each student's name. Enter and Space
  each load exactly one context; clicking the rest of the row still works.
  Paging retains keyboard focus in its section, choosing the opposite paging
  button if the original button becomes disabled. Closing/reopening invalidates
  old reads so late success or failure cannot replace the new list or status.
- The circular WS module entry remains unversioned. The worksheet CSS reference
  is versioned; there is no smartphone redesign.

## Verification

`worksheetModalKeyboard.ui.test.js` covers both Chrome and the embedded desktop:
Tab boundaries, background inertness, both AT openers, Enter/Space/mouse child
selection, pending saves, duplicate prevention, errors/retry, independent KC
content while paging, stale reads, backdrop focus restoration, nested notices
and card/control bounds at 1366×768 and 1024×768. Screenshots are saved under
`logs/modal-*.png` and were visually inspected.

All requests use synthetic API responses and isolated browser/desktop profiles.
No production data, schema, backup, restore, payment or KSIS operation is run;
the production application is not restarted. Existing WS/AT regression suites
and the AT leave-protection cases are rerun. Unit checks use mocked database
connections; no live database integration is needed for these UI changes.

The first keyboard run had an incorrect synthetic incomplete-WS URL; those
setup failures are excluded. The corrected baseline confirms the old overlays
are not native modals on either surface. The expanded tests also reproduced
the backdrop focus issue during implementation, before its shared fix.

The broad regression exposed a race in the desktop multi-scenario level test:
the preceding AT success text could satisfy its wait before the next free-level
refresh began. It now additionally requires a newer context request to finish.
The original level, packet-1, retained-input and payload assertions are unchanged;
the entire AT scope suite is rerun after this synchronization correction.

Final results and source/log fingerprints are recorded in
`reviews/2026-11-24/modal-ui-verification.json`. Earlier project fixes are
preserved; this report does not claim a new manual test of every project button.

Final verification: **97 unique passing checks** — 28 mocked WS/AT service
checks and 69 UI checks. The broad UI run passed 62/63; the corrected AT scope
rerun passed all 10, resolving its one timing failure without counting repeated
cases. Six additional WS/AT leave-protection cases passed. All 14 new keyboard
and modal cases pass on the final implementation. Syntax and whitespace checks
pass. No commit, push or production restart is included in this round.
