# Startup loading and feedback

The Windows shortcut now shows a separate loading dialog before server startup.
It reports checking, server start, module loading, desktop creation and login
navigation, then closes on readiness. It shows elapsed time and a slow-start hint
after 30 seconds, permits copying diagnostics and can be dismissed without
stopping the server. An already-running app is still reused. A repeated click
while the first launcher is alive shares its pending attempt.

The launcher starts the existing server through `launcher/server-entry.mjs`,
avoiding npm startup overhead. Direct `node server.js` and `npm start` remain
supported. The wrapper observes fatal errors without swallowing them. A known
module-loading failure ends readiness polling immediately; genuine unavailable
servers and desktop failures still produce the existing error feedback.

Diagnostics stay outside Git under `%LOCALAPPDATA%/KumonDB/startup/`, one JSON
snapshot per project. They contain stage names, attempt ID, process ID and
elapsed times, not student data or credentials. Node validates the target path
against that directory/project before writing. Finished or superseded attempts
cannot be overwritten by an old server. Feedback/storage failure is optional
and cannot prevent opening the app. The separate dialog remains responsive
while the launcher waits and spans Electron replacing its local loading page
with the login document. Reusing a running server reports the desktop-open
request as a single phase; the original server cannot write to a newer attempt.

ExcelJS is imported lazily by the two existing async workbook builders, sharing
the first load across requests. Native canvas is required only on first bitmap
rendering, retaining the synchronous receipt/payload API, wrapping and Thai font
registration. Receipt transport, queue, amounts and payment actions are unchanged.
There is no new printing modal: the existing background-print workflow remains.

Login's existing Google Fonts URL loads as a nonblocking stylesheet with a
no-JavaScript fallback. Existing fonts/weights and fallback stack are preserved.
External font delay/failure cannot block login paint, handlers or update controls.

## Verification

- Complete non-UI service suite: 383 passed, one pre-existing explicit Windows
  real-restart test skipped. Production queries/process effects are replaced by
  fixtures in the respective service tests.
- Browser/Electron/native feedback tests cover login, delayed/failed fonts,
  update confirmation, current exports, preserved KSIS fixture sessions, downloads,
  background print success/failure and partial payment (two of three subjects).
- Native feedback opens as a real child process with a private temporary status
  directory, then closes on readiness. Dismissal, repeated launch sharing, module
  failure and the local desktop loading card are separately exercised.
- Comparison against the committed pre-change builders: six synthetic receipt
  payloads are byte-identical; two Excel workbook models match after normalizing
  creation/modification timestamps. No printing or record creation is involved.
- Alternating serial profiles with the original eager imports substituted into
  the same server graph measured 5,769/4,514 ms before and 1,688/1,232 ms after.
  These warm-filesystem samples stop immediately before `app.listen`: they are
  not end-to-end launch times, cold-start guarantees or remote-PC measurements.
  The profiler blocks production pool access and subprocesses and executes no
  server listener, startup task or desktop.

One additional UI assertion originally expected Electron's old local document
to remain accessible throughout pending navigation. Electron replaces that
document. The test now verifies the loading card before navigation, absence of
readiness while the login response is held, and readiness afterward; the separate
native window is what spans the navigation. No application workaround or timeout
increase was used for this assertion.

See `reviews/2026-11-26/startup-loading-verification.json` for source fingerprints,
unique test names and evidence-file hashes. Tests used synthetic APIs/profiles,
temporary files and buffers; this work did not restart the live app or perform
database/schema, real payment, real print, backup/restore or KSIS save operations.
