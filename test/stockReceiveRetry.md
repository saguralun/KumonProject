# DO retry protection

Runtime receipts are stored under `STOCK_RECEIVE_RETRY_DIR`, or
`BACKUP_DIR/stock-receive-retries` (default `backups/stock-receive-retries`).
Keep that directory with its database. Do not delete or rotate it like logs.
No schema or session-store changes are needed. Scope and intent files are
exclusive-created and flushed; result files are flushed and atomically renamed.
Successful receipts survive a normal server process restart and return the
original response even if the DO has since been processed or deleted.

Each key is bound to the signed-in account (or guest session) and the exact
submitted type, DO number, dates, item IDs and quantities, including their order
and value types. Concurrent copies share one in-process promise; independent
processes use an exclusive operation-directory claim. A competing process can
return 409 while the original request is still running and can replay it later.
A successful save clears the browser's persisted pending key, allowing a new
intentional append with identical quantities. A definite rollback/validation
rejection is recorded and marked retry-safe so the form can be corrected.

A database commit and filesystem write cannot be one atomic transaction.
Crashes after intent but before the durable result (including lost COMMIT
acknowledgement) therefore block automatic retry with 409 and require manual
DO reconciliation. Missing/corrupt intent/result files also block replay.
This does not claim machine/power-loss durability: filesystem directory
metadata flush semantics, storage hardware and database durability still apply.
Keep the ledger and database together through restore/move; an inconsistent
restore is outside this guarantee. Separate hosts require the same durable
journal directory. There is no automatic receipt expiration. Clearing browser
storage or confirming “start a new DO” after an ambiguous result is an explicit
manual boundary and must follow inspection of the existing DO.

Tests use poisoned production pool entry points and temporary journal folders.
Browser tests use the existing synthetic `controlFixture`, never real records,
the real app, a real KSIS session, or a real restart.

Commands:

```powershell
node --test test/stockReceiveRetry.test.js test/stockReceiveConcurrency.test.js
$env:TEST_BROWSER_UI = '1'
node --test --test-concurrency=1 test/stockReceiveRetry.ui.test.js test/warehouseControls.ui.test.js
```

## Scenario for the parent-owned disposable PostgreSQL integration test

The ready-to-wire helper is
`test/support/stockReceiveRetryDatabaseChecks.js`, exporting
`assertStockReceiveRetryDatabaseSafety(database)`. Call it after schema setup
and after redirecting the production pool to the verified disposable cluster.
It covers WS/CD concurrent create, persisted replay, intentional equal append,
actor/payload mismatch, rollback, concurrent Process, and replay after Process.
It verifies the disposable cluster identity and owns its temporary journal,
synthetic DO cleanup, and restoration of the prior stock balances.

Do not add a schema/table. Import `createStockReceiveRetryStore` from
`../services/stockReceiveRetry.js` and `randomBytes` from `node:crypto`. Within
an existing disposable-database subtest, use the fixture's worksheet/CD master
ID and a unique synthetic DO number:

```js
const directory = path.join(root, 'do-retry-journal');
const store = createStockReceiveRetryStore({ directory });
const actor = 'account:isolated-fixture';
const { epoch } = await store.getScope(actor);
const retry = { actor, store,
    operationKey: `${epoch}:${randomBytes(16).toString('hex')}` };
const payload = { doNo: 'ISOLATED-RETRY-ONLY', outDate: '2026-11-24',
    receiveDate: '2026-11-24', items: [{ masterId, quantity: 10 }] };
const [first, duplicate] = await Promise.all([
    createDeliveryOrder('ws', payload, retry),
    createDeliveryOrder('ws', payload, retry)
]);
assert.deepEqual(duplicate, first);
const total = async () => Number((await database.query(
    'SELECT SUM(quantity) AS quantity FROM kumon.stock_receive WHERE stock_do_id=$1',
    [first.doId])).rows[0].quantity);
assert.equal(await total(), 10);
const restarted = createStockReceiveRetryStore({ directory });
assert.deepEqual(await createDeliveryOrder('ws', payload,
    { ...retry, store: restarted }), first);
assert.equal(await total(), 10);
await createDeliveryOrder('ws', payload, { ...retry, store: restarted,
    operationKey: `${epoch}:${randomBytes(16).toString('hex')}` });
assert.equal(await total(), 20);
await assert.rejects(createDeliveryOrder('ws', { ...payload, items: [
    { masterId, quantity: 10 }, { masterId: 2147483647, quantity: 1 }
] }, { ...retry, operationKey: `${epoch}:${randomBytes(16).toString('hex')}` }),
{ statusCode: 400, stockReceiveRetrySafe: true });
assert.equal(await total(), 20); // valid first line rolled back too
```

Repeat with `cd` and its fixture master ID. The parent owns cleanup through the
existing disposable cluster/root. This snippet is supplied for integration;
this work does not edit the shared integration file.
