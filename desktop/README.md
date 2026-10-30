# Integrated KumonDB Desktop

The Windows shortcut (`start-kumondb.bat` -> `launcher/start.ps1`) starts Node
with `KUMON_DESKTOP_MAIN=1`. Once the HTTP server is ready, it opens one Electron
window at the normal login page. Worksheet, Students, Payment, Report and K-sis
all navigate inside that same window. Do not launch Chrome alongside it.

Opening the shortcut again focuses the existing main window. A normal relaunch
does not stop a running server or discard KSIS edits. The explicit
`-ForceRestart` launcher option remains an administrative restart operation;
do not use it with unresolved work. If an older running version does not have
the desktop focus endpoint, the launcher warns and leaves that version alone.

The K-sis page attaches to the main window's remote view automatically. Node's
KSIS tools use that exact Playwright page. Switching local menus hides the view
without navigating or reloading it. No KSIS save is triggered by attachment.
An unexpected/closed remote page is not replaced during a pending operation.

The local app has its own persistent desktop profile. Each signed-in account's
KSIS view uses its existing isolated `ksis/<project>/<user>/desktop` profile,
not the local app cookie store or another user's KSIS session. Login cookies
and history remain subject to KSIS expiry rules; persistence does not promise
that KSIS will never require login again. A mismatched local session cannot
take over the open main window. Logging out revokes its active KSIS binding.
Student-link import reuses an already opened main-app KSIS session and does
not silently open another Chrome when that session is missing.

The Add Student Preview button can attach the signed-in account's KSIS view
directly beside the existing form. It opens only the requested student link,
waits for the user to log into KSIS manually, and polls the same view without
reloading the login form. After login it returns to the requested student page
and displays a selectable Preview. It neither applies fields nor saves a student
automatically. The separate Apply and Save actions remain explicit user choices.
Cancelling, closing the form, changing the link or leaving the page cancels that
preview; polling expires after five minutes. Existing WS/AT drafts, dirty KSIS
forms and competing KSIS tasks block navigation. Account checks and per-preview
tokens prevent a stale cancellation from hiding a newer user's view. The remote
view is authorized on the Students page only while that preview is active.

Remote content stays sandboxed with Node disabled and receives no local IPC
bridge. External popups, unexpected navigation and remote downloads remain
blocked. Local exports are copied to the operating system's Downloads folder
before reporting success, so those copies survive application shutdown. Native
Save As dialogs are not used: Windows shell integrations can leave an invisible
modal and disable the app. Exclusive copying allocates `(1)`, `(2)` and so on
when a name exists, without overwriting any prior download. Failed copies are
not reported as successful. Backup downloads check access and file availability
with HEAD first, stay on the Backup page, and show the saved path or error.
No extra browser window is opened. Unpaid-list printing uses an
isolated, script-disabled print document and the normal print dialog, not a
second application window. Receipts keep their existing printer service.

An Electron owner check prevents leaving an orphaned main window after its
owning Node server exits. This is not a restart command; it only ends an app
whose owner is already gone.

## Activation Boundary

These changes have only been exercised with fixtures. No production data,
running application, live KSIS session or printer was changed during development.
The running old version will not change until an authorized activation/restart.
Resolve any uncertain AT saves and pending edits before that activation.
The separate payment-tracking migration from the earlier repair pass is still
required before live payment/cancellation operations under the new server code.

Use the fixture test instructions in `test/README.md` for regression checks.
Do not run the launcher, restart helper or real KSIS operations as a test.

Final verification on 2026-10-23: 221 tests, 220 passed, 0 failed, 1 skipped
(the optional Windows restart-helper test). This includes the disposable
PostgreSQL checks from the earlier repair pass. Syntax checks passed for 153
JavaScript/CommonJS files and the launcher PowerShell parser. Native window
capture and a pixel check confirmed that the synthetic KSIS view is visibly
painted inside the one main window at desktop sizes. Printing was mocked;
no physical printer was used. No commit or push was performed.
