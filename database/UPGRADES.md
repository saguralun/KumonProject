# Database structures and program updates

Program updates download application code, install dependencies and restart.
They do not inspect or modify database tables, columns, constraints or functions.
Existing data and structures remain unchanged. Historical schema reports do not
block version checks or updates.

## Transition from older installations

An already-running older updater may call the newly downloaded
`scripts/prepare-database.js --update` or a legacy preparation export once.
These compatibility entry points return a retired/success result without
inspecting, backing up or modifying the database. The new updater and restart
helper never call them. The automatic schema planner and snapshot are removed.

The old preparation API is removed. Optional Admin-only receipt diagnostics
remain read-only; Payment still refuses an unsafe transaction when its required
receipt tracking columns are missing. It never adds those columns itself.

## Backups and future changes

The normal Backup, download and Restore features remain available.
Generated-file recovery during a program update still makes its verified file
archive; that archive is separate from a database backup.

SQL files 001–004 remain as reference/manual setup and migration scripts.
Do not run reset/seed scripts on an existing deployment. Any future schema
change needs a separately reviewed migration and backup, rather than an
automatic repair during an update.
