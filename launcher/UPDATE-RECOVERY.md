# Generated files blocking an update

The update action checks pending Git files before downloading a release. Older
versions refused every pending file, including their own untracked
`logs/database-upgrade-latest.json`. Older database preparation wrote that
report; creating the report did not itself change a table or a column.

The updater now inspects each pending path before pulling code:

- Recognized database reports, printer discovery cache and narrowly named
  runtime logs are checked for the expected file type/content.
- An unstaged `package-lock.json` can be restored only when its complete package
  graph is unchanged. Formatting and equivalent npm v2/v3 metadata can qualify;
  changed dependency versions, integrity or package metadata cannot.
- Source changes, unknown files, staged changes, deletions, renames, conflicts,
  links and malformed generated output stop the update with a file list.
  A mixed list stops before changing any pending file.

Before recovery, every recognized original is copied to a private archive under
`%LOCALAPPDATA%\KumonDB\update-file-backups\<unique-run>`. The archive includes
SHA-256 hashes, original Git revision/status, exact bytes and previous local
ignore rules. Files are flushed and read back before any recovery action.
An archive failure stops recovery.

Tracked generated files are restored only at their verified paths. Untracked
generated files stay in place and receive exact local Git exclude entries so
older update handlers can continue. No blanket stash, clean or hard reset is
used. Environment credentials and application data are not copied into this
file archive. Normal database Backup remains available separately. Program
updates no longer inspect or alter schema; see [database structures](../database/UPGRADES.md).

Future log output is ignored by the committed `logs/` rule. Deployment installs
use `npm install --no-save` to avoid changing the versioned lockfile.

## One-time recovery for an older blocked installation

Download `launcher/recover-update.cmd` from the reviewed release and double-click
it on the host machine while KumonDB is running. The helper works outside the
project directory, including Downloads; installed Node and Git are required.
It looks for the project automatically or asks for its folder. Finish unsaved
application/KSIS work before confirming its update dialog.

The helper embeds the same recovery implementation and needs no npm packages.
It inspects first, asks before making changes, backs up only verified generated
files, then calls the running application's existing confirmed update action
once. That action downloads the release, installs dependencies and restarts.
Retired preparation entry points only bridge the older running handler and
perform no database work. The helper verifies that a new server instance
responds. It does not perform a SQL migration, payment or KSIS write itself.
Unknown changes remain blocked and named for review.

Once this release is installed, the normal Update button performs file recovery
itself. The helper is only needed to bridge the older handler that cannot yet
download the new implementation. It does not diagnose or repair unrelated
shortcut-launch failures.

If an older running handler returns 401/403 after the files are recovered, the
helper stops without attempting authentication or database work. Sign into the
application with an authorized Admin account and use its Update button, which
sends that browser's existing session. The helper does not share browser cookies,
request credentials or bypass the old handler's access check. File recovery and
its verified archives remain intact, so the signed-in update can continue.

## Maintaining the helper

After changing `services/updateWorktreeService.js` or
`scripts/update-recovery-entry.js`, regenerate the self-contained download with:

```powershell
node scripts/build-update-recovery.js
```

Tests compare the generated artifact byte-for-byte, run it from a temporary
Downloads directory against disposable Git repositories and a fake update API,
and exercise its actual Windows command bootstrap. Never run the default helper
against the live project as a test: confirming it initiates an actual update.
