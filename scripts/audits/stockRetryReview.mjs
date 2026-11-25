import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// No import of config/db.js: replace that dependency before evaluating the
// actual service. This avoids both dotenv loading and production Pool creation.
const serviceUrl = new URL('../../services/stockReceiveService.js', import.meta.url);
const evidenceUrl = new URL('../../test/reviews/2026-11-24/stock-evidence.json', import.meta.url);
const compact = sql => sql.replace(/\s+/g, ' ').trim();
const SQL = {
    types: 'SELECT stock_type_code, stock_type_id FROM kumon.stock_type_master',
    begin: 'BEGIN',
    header: 'SELECT stock_do_id, is_stock_processed FROM kumon.stock_do WHERE do_no = $1 FOR UPDATE',
    create: 'INSERT INTO kumon.stock_do ( do_no, out_date, receive_date, receive_month, receive_year, is_stock_processed ) VALUES ($1, $2, $3, $4, $5, FALSE) RETURNING stock_do_id',
    existingType: 'SELECT MIN(stm.stock_type_code) AS stock_type_code FROM kumon.stock_receive r JOIN kumon.stock_type_master stm ON stm.stock_type_id = r.stock_type_id WHERE r.stock_do_id = $1',
    master: 'SELECT 1 FROM kumon.worksheet_master WHERE worksheet_master_id = $1',
    add: 'UPDATE kumon.stock_receive SET quantity = quantity + $1 WHERE stock_do_id = $2 AND stock_type_id = $3 AND master_id = $4',
    line: 'INSERT INTO kumon.stock_receive (stock_do_id, stock_type_id, master_id, quantity) VALUES ($1, $2, $3, $4)',
    commit: 'COMMIT',
    rollback: 'ROLLBACK'
};
const fixture = Object.freeze({ doId: 701, masterId: 901, stockTypeId: 1, doNo: 'SYNTHETIC-STOCK-RETRY-REVIEW' });

function makeMock() {
    const state = { header: null, line: null, commits: 0, releases: 0, connections: 0 };
    const issuedSql = [];
    let invocation = 0;
    const result = (rows = [], rowCount = rows.length) => ({ rows, rowCount });
    function record(target, sql, parameters) {
        assert.equal(typeof sql, 'string', 'Only explicit SQL strings are supported');
        assert.ok(Array.isArray(parameters));
        issuedSql.push({ invocation, target, sql, parameters: structuredClone(parameters) });
        return compact(sql);
    }
    const pool = {
        async query(sql, parameters = []) {
            const text = record('pool.query', sql, parameters);
            if (text !== SQL.types) throw new Error('Unsupported SQL on mock pool.query');
            assert.deepEqual(parameters, []);
            return result([{ stock_type_code: 'WS', stock_type_id: 1 }, { stock_type_code: 'CD', stock_type_id: 2 }]);
        },
        async connect(...args) {
            assert.deepEqual(args, [], 'Mock connect accepts no connection options');
            state.connections++;
            let released = false, transaction = false, snapshot;
            let steps = [];
            return {
                async query(sql, parameters = []) {
                    assert.equal(released, false, 'Query after release');
                    const text = record('client.query', sql, parameters);
                    if (!Object.values(SQL).includes(text) || text === SQL.types) {
                        throw new Error('Unsupported SQL on mock client.query');
                    }
                    if (text === SQL.begin) {
                        assert.equal(transaction, false);
                        assert.deepEqual(parameters, []);
                        snapshot = structuredClone({ header: state.header, line: state.line });
                        transaction = true;
                        steps = state.header
                            ? [SQL.header, SQL.existingType, SQL.master, SQL.add, SQL.commit]
                            : [SQL.header, SQL.create, SQL.master, SQL.add, SQL.line, SQL.commit];
                        return result();
                    }
                    assert.equal(transaction, true, 'SQL outside mock transaction');
                    if (text === SQL.rollback) {
                        assert.deepEqual(parameters, []);
                        Object.assign(state, snapshot);
                        transaction = false;
                        return result();
                    }
                    assert.equal(text, steps.shift(), 'Unexpected SQL order');
                    switch (text) {
                        case SQL.header:
                            assert.deepEqual(parameters, [fixture.doNo]);
                            return result(state.header ? [structuredClone(state.header)] : []);
                        case SQL.create:
                            assert.deepEqual(parameters, [fixture.doNo, '2026-11-24', '2026-11-24', 12, 2026]);
                            assert.equal(state.header, null);
                            state.header = { stock_do_id: fixture.doId, is_stock_processed: false };
                            return result([{ stock_do_id: fixture.doId }]);
                        case SQL.existingType:
                            assert.deepEqual(parameters, [fixture.doId]);
                            return result([{ stock_type_code: 'WS' }]);
                        case SQL.master:
                            assert.deepEqual(parameters, [fixture.masterId]);
                            return result([{ exists: 1 }]);
                        case SQL.add:
                            assert.deepEqual(parameters, [10, fixture.doId, fixture.stockTypeId, fixture.masterId]);
                            if (!state.line) return result([], 0);
                            // Interpret the service-issued additive UPDATE; never assign
                            // a preselected expected total to manufacture the result.
                            state.line.quantity += parameters[0];
                            return result([], 1);
                        case SQL.line:
                            assert.deepEqual(parameters, [fixture.doId, fixture.stockTypeId, fixture.masterId, 10]);
                            assert.equal(state.line, null);
                            state.line = { quantity: parameters[3] };
                            return result([], 1);
                        case SQL.commit:
                            assert.deepEqual(parameters, []);
                            assert.equal(steps.length, 0);
                            transaction = false;
                            state.commits++;
                            return result();
                        default:
                            throw new Error('Unhandled SQL on mock client.query');
                    }
                },
                release() {
                    assert.equal(transaction, false, 'Released an open transaction');
                    assert.equal(released, false, 'Double release');
                    released = true;
                    state.releases++;
                }
            };
        }
    };
    return { pool, state, issuedSql, setInvocation(value) { invocation = value; } };
}

async function checkFailClosed() {
    const mock = makeMock();
    await assert.rejects(mock.pool.query('SELECT unexpected_review_sql'), /Unsupported SQL/);
    const client = await mock.pool.connect();
    await assert.rejects(client.query('SELECT unexpected_review_sql'), /Unsupported SQL/);
    client.release();
    return { unknownPoolSqlRejected: true, unknownClientSqlRejected: true };
}

async function importActualService(pool) {
    const key = `stock-retry-review-${randomUUID()}`;
    const isolatedUrl = new URL(serviceUrl);
    isolatedUrl.searchParams.set('review', key);
    const mockUrl = `data:text/javascript,${encodeURIComponent(`export default globalThis[${JSON.stringify(key)}];`)}`;
    const allowedHelpers = new Set(['./stockTypeResolver.js', './dateHelpers.js', './httpError.js']);
    let dbImportsIntercepted = 0;
    globalThis[key] = pool;
    const hooks = registerHooks({
        resolve(specifier, context, nextResolve) {
            if (context.parentURL === isolatedUrl.href) {
                if (specifier === '../config/db.js') {
                    dbImportsIntercepted++;
                    return { url: mockUrl, shortCircuit: true };
                }
                if (!allowedHelpers.has(specifier)) throw new Error('Unexpected service dependency; review aborted');
            }
            return nextResolve(specifier, context);
        }
    });
    try {
        const service = await import(isolatedUrl.href);
        assert.equal(dbImportsIntercepted, 1, 'Database module must be replaced before evaluation');
        return { createDeliveryOrder: service.createDeliveryOrder, dbImportsIntercepted };
    } finally {
        hooks.deregister();
        delete globalThis[key];
    }
}

// Importing this script writes nothing. Only direct CLI execution writes evidence.
export async function runStockRetryReview() {
    const guards = await checkFailClosed();
    const mock = makeMock();
    const { createDeliveryOrder, dbImportsIntercepted } = await importActualService(mock.pool);
    const request = {
        doNo: fixture.doNo, outDate: '2026-11-24', receiveDate: '2026-11-24',
        items: [{ masterId: fixture.masterId, quantity: 10 }]
    };
    const invocations = [];
    for (let attempt = 1; attempt <= 2; attempt++) {
        mock.setInvocation(attempt);
        const quantityBefore = mock.state.line?.quantity ?? 0;
        const returned = await createDeliveryOrder('ws', structuredClone(request));
        assert.deepEqual(returned, { type: 'ws', doId: fixture.doId, doNo: fixture.doNo, appended: attempt === 2 });
        assert.equal(mock.state.line.quantity, attempt * 10);
        assert.equal(mock.state.header.is_stock_processed, false);
        invocations.push({ attempt, quantityBefore, quantityAfter: mock.state.line.quantity, isStockProcessed: false, returned });
    }
    assert.equal(mock.state.commits, 2);
    assert.equal(mock.state.connections, 2);
    assert.equal(mock.state.releases, 2);
    assert.equal(mock.issuedSql.filter(entry => compact(entry.sql) === SQL.add).length, 2);
    assert.equal(mock.issuedSql.filter(entry => compact(entry.sql) === SQL.line).length, 1);
    return {
        review: 'stock-retry-service-additivity', status: 'passed',
        service: 'services/stockReceiveService.js#createDeliveryOrder',
        scope: 'Actual service invoked twice with the identical synthetic WS quantity-10 request; first creates a pending DO, second appends to that same pending DO.',
        conclusion: 'The identical service request is additive: quantity after the first call is 10 and after the second is 20. The DO remains pending; stock processing is not invoked.',
        limitation: 'This proves repeated-service-call additivity using an in-memory SQL mock. It does NOT prove an end-to-end lost-response UI scenario, browser behavior, or real PostgreSQL execution.',
        isolation: { databaseModuleReplacedBeforeEvaluation: true, dbImportsIntercepted, productionPoolCreated: false, realDatabaseConnections: 0, envFilesRead: false, ...guards },
        request: { type: 'ws', ...request }, invocations,
        quantities: invocations.map(entry => entry.quantityAfter),
        transactions: { commits: mock.state.commits, connections: mock.state.connections, releases: mock.state.releases },
        issuedSql: mock.issuedSql
    };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        const evidence = await runStockRetryReview();
        await mkdir(new URL('./', evidenceUrl), { recursive: true });
        await writeFile(evidenceUrl, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
        console.log(`PASS: actual createDeliveryOrder quantity 10 -> 20; evidence: ${fileURLToPath(evidenceUrl)}`);
        console.log('Service-only evidence; no end-to-end lost-response UI verification.');
    } catch (error) {
        console.error(`Stock retry review failed: ${error.message}`);
        process.exitCode = 1;
    }
}
