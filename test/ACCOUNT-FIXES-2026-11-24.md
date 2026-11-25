# Account and permission safety — 24 November 2026

This round addresses two-machine permission editing and separates account
creation, password reset, role assignment and activation. Existing uncommitted
payment/WS/stock/Students/KSIS work remains in place. No production data,
schema, sessions, Git commits/pushes or running application were changed.

## Reproduction before the fix

- Two independent browser contexts loaded the same Staff grants. Machine A
  revoked Stock; machine B enabled Report using its old whole-role snapshot.
  The previous implementation restored Stock without warning.
  Evidence: `logs/round4-two-pages-before.log` and
  `logs/round4-permissions-before.log`.
- Posting an existing username to the combined create/reset endpoint could
  change its display name and role and reactivate an inactive account.
  Evidence: `logs/round4-account-before.log` (unexpected HTTP 200 rather than
  duplicate rejection).

## Resulting behavior

- Permission edits compare the grants originally seen by the page against
  current grants while holding that role's PostgreSQL row lock. A stale edit
  returns 409 without writing. The UI loads current values and asks the user
  to review and click again; it never automatically reapplies stale grants.
- The HTTP permission endpoint requires this snapshot. A previously cached
  page without it receives reload guidance instead of an unsafe overwrite.
  Trusted internal two-argument service callers retain their explicit behavior.
- The create form creates a new username only. Duplicate usernames return 409;
  existing credentials, role, display name and activation stay unchanged.
- Each account has its own password reset dialog. It submits only the target
  account ID and new password. Role assignment and activation use their
  existing separate actions. Inactive accounts remain inactive after reset.
- A successful password reset revokes all sessions of the target account,
  including a self-resetting Admin's current session, but preserves other
  accounts' sessions. Stale in-flight sessions cannot restore access. Failure
  to revoke sessions rolls back the password change.
- The dialog clears secrets synchronously on cancel/success, blocks duplicate
  submits and Escape while saving, and retains the target for an explicit retry
  after a failed request. Create, role and activation controls remain available.
- Explicit CLI/bootstrap upsert behavior and last-active-Admin protection are
  preserved. No migration, added table or added column is required.

## Verification

400 unique passing checks and one existing Windows restart-helper skip:

- 345 service/HTTP checks: the full service run passed 344, and the subsequently
  added create-only HTTP check passed separately. These include session reset,
  last Admin concurrency, CLI bootstrap, authorization cache invalidation,
  duplicate creation and permission endpoint guards.
- 45 disposable PostgreSQL checks (including its parent test): real concurrent
  permission writers produce one success and one 409; explicit fresh retry
  works; invalid permission insertion rolls back its preceding deletion;
  concurrent password/role changes preserve inactive account data; the schema
  stays identical. Existing payment, WS, stock and restore checks also pass.
- 10 affected UI checks: nine in the filtered Users/Role/reset run plus the
  separate create/role/activation check. Browser and integrated desktop reset
  paths and two independent admin contexts are included.

Final logs:

- `logs/round4-services.log`
- `logs/round4-create-http.log`
- `logs/round4-isolated.log`
- `logs/round4-ui-final.log`
- `logs/round4-create-ui-final.log`

An initial reset UI check caught queued native-dialog secret cleanup; the
application now clears it synchronously and the complete affected UI run passes.
The first create-controls UI check observed the temporary loading placeholder;
its wait now requires the returned row before checking the same role/activation
assertions. The corrected complete create-controls check passes. Repeated checks
are not counted again.

Syntax checks and `git diff --check` passed. Twenty previous-round application
and test fingerprints outside this round's intended edits were also checked
unchanged. This validates fixtures and a disposable database; no real account,
receipt, printer, KSIS save or production restart was exercised.
