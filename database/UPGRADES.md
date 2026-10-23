# Database Checks During Updates

The confirmed program update checks the approved application schema before
restarting. Users on the host machine do not need an Admin login to update.
The manual database preparation action remains Admin-only.

## Update Flow

1. Pull the new application files and install dependencies.
2. Run `scripts/prepare-database.js --update` in a fresh Node process so the
   check uses the newly downloaded code, not the old server's module cache.
3. Compare the database with `schema-contract.json` (34 application tables,
   235 columns, constraints, supporting indexes and two SQL helpers).
4. If already ready, do not back up or change the database unnecessarily.
5. If an additive repair is needed, verify that the backup target matches
   the connected database, make a fresh backup, verify its size/freshness
   and confirm that PostgreSQL can read its archive catalog.
6. Recheck and apply the repair in one transaction with lock and statement
   timeouts. Check the result before committing. On failure, roll back and
   leave the old application running rather than schedule a restart.
7. Keep the latest result, changed object names and backup filename in
   `logs/database-upgrade-latest.json`. A failed preparation keeps the Update
   action available even if the downloaded commit is already current.

The newly downloaded Windows restart helper also checks before stopping the
old server. This bridges older installed update handlers that only knew
about receipt migration 004. It does not run during an ordinary app launch.

## Safety Boundaries

- Never run the legacy 001/002/003 reset/seed files on a live deployment.
  They contain destructive resets or branch-specific seed data.
- Never create students, receipts, histories, balances, accounts or grants
  automatically. No live KSIS action is part of a database upgrade.
- Missing nullable fields, required fields on empty tables, tables for
  additional features, supporting constraints/indexes and SQL helpers can
  be added. A missing future default does not rewrite existing row values.
- Missing core data tables, missing required historical values, incompatible
  types, conflicting definitions or constraint violations stop the update.
  They need a reviewed migration or recovery of the original data, not guesses.
- Extra branch-specific tables/columns are retained. Existing defaults or
  stricter nullability are not silently overwritten.
- This checks schema compatibility, not whether every historical business
  record exists. It cannot recover deleted data or combine branch databases.

## Maintaining The Contract

After an intentional schema change, update the canonical DDL and approved
upgrade behavior together. Generate the contract only from the verified,
disposable cluster in the integration test:

```powershell
$env:TEST_ISOLATED_PG = '1'
$env:TEST_EXPORT_SCHEMA_CONTRACT = '1'
$env:TEST_PG_BIN = 'C:/Program Files/PostgreSQL/17/bin'
node --test test/isolatedDatabase.integration.test.js
Remove-Item Env:TEST_EXPORT_SCHEMA_CONTRACT
```

Review the generated diff before shipping. The normal isolated integration
suite verifies that the contract matches the canonical DDL, preserves rows
through repairs, refuses unsafe changes and rolls back on a failed constraint.
