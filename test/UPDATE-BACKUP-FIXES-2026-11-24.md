# Update and Backup follow-up — 24 November 2026

This round follows the account/permission fixes. It addresses the server/database
target shown in Backup and update confirmations, restart failure feedback, and
access to the safety archive created before Restore. It preserves existing
uncommitted work and does not apply the cancelled WS mock design.

## Reproduction and changes

- The Backup browser and desktop fixtures originally displayed neither
  `CENTER-MAIN` nor `DATABASE-SERVER:5544`, despite their presence in the fixture's
  response. Backup now returns the program server name, database host/port and
  database name without returning database credentials. The page and final
  confirmation identify this target and explain that LAN clients share it.
- The helper already released the update lock after an explicit ERROR following
  READY, but runtime status omitted this failure. Both Login and the signed-in
  page continued waiting. The before service test failed the missing phase
  assertion; both before UI paths timed out waiting for failure feedback.
- Each update now has an attempt ID. Runtime status exposes its phase and a
  nontechnical failure message. Login/workspace wait for the returned attempt
  and stop promptly if it fails while the original server is still available.
  Failure from another attempt is ignored; a changed runtime is still required
  to confirm success. Legacy/no-ID restart checks retain their offline check.
- Update confirmation names the program server. Dependency-install failures say
  the update is incomplete and has not restarted, and direct the user to retry
  through the existing update button after checking the connection.
- Restore success and failures after the safety backup expose the exact backup
  filename. A recovery panel provides its download link and explains how to
  select it and use the ordinary confirmed Restore flow. It never restores a
  file automatically. Errors refresh the list; a failed list refresh disables
  Restore until its target can be read again.
- The recovery link reuses the existing HEAD validation and desktop download
  completion handling. Admin/typed-database confirmation and atomic pg_restore
  flags remain unchanged. Shared script versions are updated in HTML entry
  points, including Migration; Student/WS module entry URLs are unchanged.

Before evidence: `logs/round4-round5-before-ui.log`,
`logs/round4-round5-before-workspace.log`, and
`logs/round4-round5-before-service.log`. The first workspace probe had not opened
the menu; the corrected before probe opened it and then reproduced the actual
failure-feedback timeout. That corrected probe is the workspace evidence.

## Test boundary incident — actual backup created

One initial HTTP test incorrectly used `mock.method` on Node's `execFile`.
That proxy retained the native custom promisifier, which closed over the
original executable call. It therefore ran the real existing backup script once.
The fixture then found no synthetic backup and stopped before pg_restore.

The production backup log confirms:

- Created `kumon_dev_2026-11-24_204105.backup` (about 3.6 MB).
- The existing 12-archive retention policy deleted the oldest archive,
  `kumon_dev_2026-09-15_134303.backup`.
- No production Restore, database data/schema write, update, restart, commit or
  push was performed. The newly created archive is preserved. The deleted older
  archive has not been recovered by this task.

A read-only exact-name search found no copy of the deleted archive in the
workspace or Windows Recycle Bin. This does not establish whether OneDrive's
cloud recycle bin still has a recoverable copy; no cloud recovery was performed.

The incident was reported to the user during work. The corrected HTTP fixture
installs a fresh replacement function, asserts that no native custom promisifier
exists, blocks every other subprocess entry, poisons both production SQL entry
points, uses only synthetic credentials, and restores its hooks afterwards.
The verified rerun called only its fake backup/restore functions and passed.
This report deliberately does not claim that every test was free of production
filesystem effects.

## Verification

411 unique passing checks; one existing opt-in Windows restart-helper skip:

- 352 service/HTTP checks: 351 passed in the full service run, plus the newly
  added Restore HTTP check. The final five-check Restore rerun covers that new
  case and four existing backup checks; those four are not counted twice.
- 45 disposable PostgreSQL parent/subtests passed, including failed COPY
  rollback preserving rows, account concurrency, payments, WS and stock.
- 14 affected UI checks: the first broad run passed 12; the six-case recovery
  run repeats four and adds Login/workspace failure feedback on desktop.
  Browser/desktop backup download, confirmation cancel, failed Restore retry,
  update badges and existing role controls all pass.
- Syntax checks and `git diff --check` passed. No program was deployed or
  restarted. No real receipt, print job or KSIS write was attempted.

Final evidence is indexed in `reviews/2026-11-24/update-backup-verification.json`.
The first restricted corrected HTTP run could not reach its loopback fixture
(`EACCES`); the identical guarded fixture passed with loopback access enabled.

Launcher startup failure dialogs and offline-version-check timestamps remain
separate follow-up items; this round does not claim to have fixed those.
